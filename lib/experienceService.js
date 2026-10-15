import { randomBytes, createHash } from 'node:crypto';
import { calculateSajuGrap, toLegacyApiData } from '../src/engine/SajuGrapEngine.js';
import { buildReading, selectedReading, PHASES, DOMAINS } from './waveReading.js';

export const SESSION_COLLECTION = process.env.VERCEL_ENV === 'preview' ? 'saju_experience_sessions_preview_v1' : 'saju_experience_sessions_v1';
export const BUDGET_COLLECTION = process.env.VERCEL_ENV === 'preview' ? 'saju_experience_budgets_preview_v1' : 'saju_experience_budgets_v1';
const DAY = 86400000;
export const hash = value => createHash('sha256').update(String(value)).digest('hex');
export class ExperienceError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function assertRequest(req) {
  if (req.method !== 'POST') throw new ExperienceError(405, 'POST 요청만 지원합니다.');
  const origin = req.headers?.origin;
  if (origin && new URL(origin).host !== req.headers?.host) throw new ExperienceError(403, '이 앱에서 다시 시도해 주세요.');
  if (!String(req.headers?.['content-type'] || '').startsWith('application/json')) throw new ExperienceError(415, 'JSON 요청이 필요합니다.');
  if (Buffer.byteLength(JSON.stringify(req.body || {})) > 120000) throw new ExperienceError(413, '요청이 너무 깁니다.');
}
export function cleanProfile(raw = {}) {
  const p = {};
  for (const key of ['year', 'month', 'day', 'hour', 'minute', 'gender', 'calendarType', 'isLeapMonth', 'dayBoundary']) if (raw[key] !== undefined) p[key] = raw[key];
  p.name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 30) : '';
  p.timezone = 'Asia/Seoul';
  p.unknownTime = raw.unknownTime === true;
  if (p.unknownTime) { p.hour = null; p.minute = null; }
  if (![1, 2].includes(Number(p.gender))) throw new ExperienceError(400, '대운 계산 기준을 선택해 주세요.');
  return p;
}
export function computeExperience(profile, referenceDateTime = new Date().toISOString()) {
  if (profile.unknownTime) {
    // Compare possible hours; never expose a made-up noon chart as this person's chart.
    const variants = Array.from({ length: 25 }, (_, hour) => calculateSajuGrap({ ...profile, hour: Math.min(hour, 23), minute: hour === 24 ? 59 : 0, referenceDateTime }));
    const natal = {};
    for (const key of ['year', 'month', 'day']) {
      const first = variants[0].natal[key];
      natal[key] = variants.every(f => f.natal[key].ganzhi === first.ganzhi) ? { ganzhi: first.ganzhi, stem: first.stemKo || first.stem, branch: first.branchKo || first.branch } : null;
    }
    return { reading: { limited: true, natal, timelines: {}, today: null, referenceDate: referenceDateTime.slice(0, 10), message: '태어난 시간을 몰라 시주와 시간에 영향을 받는 파동·종합 해설은 계산하지 않았어요. 확정할 수 있는 기둥만 보여드려요.' }, data: null };
  }
  const facts = calculateSajuGrap({ ...profile, referenceDateTime });
  return { reading: buildReading(facts), data: { ...toLegacyApiData(facts), engineFacts: facts } };
}
export async function getSession(db, req, res, { create = false, allowExpired = false, now = Date.now() } = {}) {
  const cookie = String(req.headers?.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sg_session='))?.slice(11);
  if (/^[a-f0-9]{64}$/.test(cookie || '')) {
    const ref = db.collection(SESSION_COLLECTION).doc(hash(cookie));
    const snap = await ref.get();
    if (snap.exists && (allowExpired || (snap.data().expiresAt > now && snap.data().status !== 'deleting'))) return { ref, value: snap.data() };
  }
  if (!create) throw new ExperienceError(401, '연결이 만료됐어요. 내 사주에서 다시 열어주세요.');
  const token = randomBytes(32).toString('hex');
  const ref = db.collection(SESSION_COLLECTION).doc(hash(token));
  const value = { createdAt: now, expiresAt: now + 30 * DAY };
  res.setHeader('Set-Cookie', `sg_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${30 * 86400}`);
  return { ref, value, fresh: true };
}
export function validateId(value) {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(value || '')) throw new ExperienceError(400, '요청 식별자가 올바르지 않습니다.');
  return value;
}
export async function getAnalysis(session, id) {
  const snap = await session.ref.collection('analyses').doc(validateId(id)).get();
  if (!snap.exists) throw new ExperienceError(404, '이 연결에 저장된 사주를 찾지 못했어요. 다시 열어주세요.');
  return snap.data();
}
export function chatContext(analysis, cycleId, domain = 'all') {
  const calculated = computeExperience(analysis.profile, analysis.referenceDateTime);
  if (calculated.reading.limited) throw new ExperienceError(422, '시간을 입력하면 파동 상담을 이어갈 수 있어요.');
  const selected = selectedReading(calculated.reading, cycleId);
  if (!selected || !DOMAINS[domain]) throw new ExperienceError(400, '해설의 날짜와 분야를 다시 선택해 주세요.');
  return { ...calculated, selected, context: { referenceDate: calculated.reading.referenceDate, selected, phase: PHASES[selected.mode].label, meaning: PHASES[selected.mode].description, action: DOMAINS[domain][selected.mode], domain: DOMAINS[domain].label } };
}
// Fixed-window quotas are transactional across instances. Only counters are stored here.
export async function consumeBudget(db, session, req, type, now = Date.now()) {
  const date = new Date(now).toISOString().slice(0, 10);
  const ip = req.headers?.['x-vercel-forwarded-for'] || req.headers?.['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  const limits = type === 'chat' ? [20, 60] : type === 'archive' ? [200, 500] : [20, 80];
  const ids = [`${session.ref.id}_${date}_${type}`, `${hash(ip)}_${date}_${type}`];
  const refs = ids.map(id => db.collection(BUDGET_COLLECTION).doc(id));
  await db.runTransaction(async tx => {
    const snaps = await Promise.all(refs.map(ref => tx.get(ref)));
    snaps.forEach((s, i) => { if ((s.data()?.count || 0) >= limits[i]) throw new ExperienceError(429, '오늘 이용 가능한 횟수를 모두 사용했어요. 저장한 해설은 계속 볼 수 있어요.'); });
    refs.forEach((ref, i) => tx.set(ref, { count: (snaps[i].data()?.count || 0) + 1, expiresAt: new Date(now + 2 * DAY) }));
  });
}
export function groundMemory(state, messages) {
  if (!state) return null;
  const byId = new Map(messages.filter(m => m.role === 'user').map(m => [m.id, m.text]));
  const result = structuredClone(state);
  // Facts held for later turns retain the user's exact words, not model-invented paraphrases.
  for (const key of ['observations', 'goals', 'constraints', 'attempts', 'corrections']) {
    result[key] = (result[key] || []).flatMap(item => {
      const text = (item.sourceMessageIds || []).map(id => byId.get(id)).filter(Boolean).join(' ');
      return text ? [{ ...item, text: text.slice(0, 800), kind: 'user_statement' }] : [];
    });
  }
  return result;
}
