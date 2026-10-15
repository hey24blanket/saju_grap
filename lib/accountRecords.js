import { randomUUID } from 'node:crypto';
import { hash, validateId, cleanProfile, computeExperience, ExperienceError } from './experienceService.js';
import { PHASES, DOMAINS } from './waveReading.js';

export const ACCOUNT_COLLECTION = process.env.VERCEL_ENV === 'preview' ? 'saju_experience_accounts_preview_v1' : 'saju_experience_accounts_v1';
export const ACCOUNT_RETENTION = 365 * 86400000;
export const ARCHIVE_LIMIT = 40;

// Every mutation reads the parent in the SAME transaction. A cleanup/delete
// locks the parent first, so an in-flight request cannot recreate orphan data.
export async function assertOwnerActive(tx, owner, now = Date.now()) {
  const snap = await tx.get(owner.ref), value = snap.data();
  if (!snap.exists || value.status === 'deleting' || value.expiresAt <= now || value.generation !== owner.value.generation || value.createdAt !== owner.value.createdAt) throw new ExperienceError(409, '기록의 연결이 바뀌었어요. 보관함을 다시 열어주세요.');
  return value;
}

export async function getAccount(db, identity, { create = false, allowExpired = false, now = Date.now() } = {}) {
  const ref = db.collection(ACCOUNT_COLLECTION).doc(hash(identity.uid));
  let value, expired;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref); value = snap.data();
    if (!allowExpired && (value?.status === 'deleting' || (value && value.expiresAt <= now))) {
      if (create) { expired = { ref, value }; return; }
      throw new ExperienceError(409, '이전 기록을 정리하고 있어요. 잠시 후 다시 열어주세요.');
    }
    if (!value) {
      if (!create) throw new ExperienceError(401, '계정 보관함을 먼저 열어주세요.');
      value = { createdAt: now, expiresAt: now + ACCOUNT_RETENTION, generation: randomUUID(), archiveCount: 0, status: 'active' };
      tx.set(ref, value);
    } else if (create && value.expiresAt < now + ACCOUNT_RETENTION - 86400000) {
      value = { ...value, expiresAt: now + ACCOUNT_RETENTION }; tx.set(ref, value);
    }
  });
  if (expired) {
    const { deleteOwner } = await import('./experienceCleanup.js');
    await deleteOwner(db, expired, { expiredBefore: now });
    return getAccount(db, identity, { create, now: Date.now() });
  }
  return { ref, value, account: true };
}

export async function accountSnapshot(owner) {
  const [root, records] = await Promise.all([owner.ref.get(), owner.ref.collection('archive').where('deleted', '==', false).limit(ARCHIVE_LIMIT).get()]);
  const value = root.data();
  if (!value || value.status === 'deleting' || value.generation !== owner.value.generation) throw new ExperienceError(409, '기록의 연결이 바뀌었어요. 다시 열어주세요.');
  let current = null;
  if (value.latestAnalysisId) {
    const snap = await owner.ref.collection('analyses').doc(value.latestAnalysisId).get();
    if (snap.exists) {
      const a = snap.data();
      current = { analysisId: value.latestAnalysisId, profile: a.profile, reading: a.reading || computeExperience(a.profile, a.referenceDateTime).reading, sessionExpiresAt: value.expiresAt };
    }
  }
  const archive = records.docs.map(s => s.data().item).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return { current, archive, expiresAt: value.expiresAt };
}

function cleanNote(value) { return typeof value === 'string' ? value.trim().slice(0, 500) : ''; }
function dateTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value) || !Number.isFinite(Date.parse(value))) throw new ExperienceError(400, '저장한 날짜를 확인해 주세요.');
  return new Date(value).toISOString();
}

// Normal saves are built from server-owned analyses and conversations. Imported
// device snapshots are explicitly read-only and NEVER become model history.
export async function buildRecord(owner, body, { importing = false } = {}) {
  const raw = body.item || {};
  if (!['reading', 'chat'].includes(raw.kind) || !DOMAINS[raw.domain || 'all']) throw new ExperienceError(400, '보관할 기록을 확인해 주세요.');
  const domain = raw.domain || 'all';
  let experience, messages = [], conversationId;
  if (importing) {
    const profile = cleanProfile(raw.experience?.profile);
    const refDate = dateTime(raw.experience?.reading?.referenceDate).slice(0, 10);
    let reading;
    try { reading = computeExperience(profile, `${refDate}T12:00:00+09:00`).reading; } catch { throw new ExperienceError(400, '기기에 저장한 생년월일을 확인해 주세요.'); }
    experience = { analysisId: `device_${hash(raw.id).slice(0, 32)}`, profile, reading, sessionExpiresAt: 0 };
    if (raw.kind === 'chat') {
      if (!Array.isArray(raw.chat?.messages) || raw.chat.messages.length > 40) throw new ExperienceError(400, '기기에 저장한 대화를 확인해 주세요.');
      messages = raw.chat.messages.map((m, i) => {
        if (!['user', 'assistant'].includes(m.role) || typeof m.text !== 'string' || !m.text.trim() || m.text.length > 10000) throw new ExperienceError(400, '기기에 저장한 대화가 너무 길거나 올바르지 않아요.');
        return { id: `imported_${i}`, role: m.role, text: m.text };
      });
    }
  } else {
    const analysisId = validateId(raw.experience?.analysisId);
    const snap = await owner.ref.collection('analyses').doc(analysisId).get();
    if (!snap.exists) throw new ExperienceError(404, '해설을 다시 연 뒤 저장해 주세요.');
    const a = snap.data();
    experience = { analysisId, profile: a.profile, reading: a.reading || computeExperience(a.profile, a.referenceDateTime).reading, sessionExpiresAt: owner.value.expiresAt };
    if (raw.kind === 'chat') {
      conversationId = validateId(raw.id);
      const c = (await owner.ref.collection('conversations').doc(conversationId).get()).data();
      if (!c || c.analysisId !== analysisId || c.cycleId !== raw.pointId || c.domain !== domain || c.busyUntil > Date.now()) throw new ExperienceError(409, '대화가 준비된 뒤 다시 저장해 주세요.');
      messages = c.messages;
    }
  }
  const point = Object.values(experience.reading.timelines).flat().find(p => p.id === raw.pointId);
  if (!point || (raw.kind === 'chat' && !messages.some(m => m.role === 'assistant'))) throw new ExperienceError(400, '저장할 해설 또는 답변이 없어요.');
  const id = importing ? `device_${hash(validateId(raw.id)).slice(0, 40)}` : validateId(raw.id);
  const action = raw.kind === 'reading' ? DOMAINS[domain][point.mode] : cleanNote(raw.action) || DOMAINS[domain][point.mode];
  const item = { id, kind: raw.kind, title: `${point.label} · ${raw.kind === 'chat' ? '나의 상담' : PHASES[point.mode].label}`, action, pointId: point.id, domain, experience, savedAt: importing ? dateTime(raw.savedAt) : new Date().toISOString(), source: importing ? 'device' : 'account' };
  if (raw.kind === 'chat') item.chat = { id: conversationId || id, analysisId: experience.analysisId, pointId: point.id, domain, messages, experience, action, readOnly: importing };
  if (Buffer.byteLength(JSON.stringify(item)) > 85000) throw new ExperienceError(413, '기록이 너무 길어요. 먼저 내보내기로 보관해 주세요.');
  return item;
}

export async function putRecord(db, owner, body, importing = false) {
  const item = await buildRecord(owner, body, { importing });
  const ref = owner.ref.collection('archive').doc(item.id);
  const operationId = validateId(body.operationId);
  let saved;
  await db.runTransaction(async tx => {
    const root = await assertOwnerActive(tx, owner);
    const old = (await tx.get(ref)).data();
    if (old?.operationId === operationId || (importing && old)) { saved = old.deleted ? null : old.item; return; }
    if (old?.deleted || (old?.revision || 0) !== (body.revision || 0)) throw new ExperienceError(409, '다른 기기에서 이 기록이 바뀌었어요. 보관함을 새로 연 뒤 확인해 주세요.');
    if (!old && root.archiveCount >= ARCHIVE_LIMIT) throw new ExperienceError(409, '계정에는 40개까지 보관할 수 있어요. 일부 기록을 정리한 뒤 다시 시도해 주세요.');
    const revision = (old?.revision || 0) + 1;
    saved = { ...item, revision };
    tx.set(ref, { deleted: false, item: saved, revision, operationId });
    tx.update(owner.ref, { archiveCount: (root.archiveCount || 0) + (old ? 0 : 1) });
  });
  return saved;
}

export async function removeRecord(db, owner, body) {
  const ref = owner.ref.collection('archive').doc(validateId(body.id));
  await db.runTransaction(async tx => {
    const root = await assertOwnerActive(tx, owner), old = (await tx.get(ref)).data();
    if (!old || old.deleted) return;
    if (old.revision !== body.revision) throw new ExperienceError(409, '다른 기기에서 바뀐 기록이에요. 보관함을 새로 연 뒤 삭제해 주세요.');
    // A tombstone rejects stale saves, including delayed offline imports.
    tx.set(ref, { deleted: true, revision: old.revision + 1 });
    tx.update(owner.ref, { archiveCount: Math.max(0, (root.archiveCount || 0) - 1) });
  });
}
