import crypto from 'node:crypto';
import { requireRagAdmin } from '../../lib/ragAdminAuth.js';
import { getFirestoreClient } from '../../lib/ragRetriever.js';
import {
  REVIEWER_PROMPT_COLLECTION,
  ensureDefaultReviewerPrompt,
  getReviewerPrompt,
  listReviewerPrompts,
  saveReviewerPrompt,
} from '../../lib/chunkingReviewerPolicy.js';

const PROJECT_ID = 'saju-grap';
const SCHEMA = 'ce_knowledge_pool_v1';
const COLLECTIONS = Object.freeze({
  pools: 'ce_knowledge_pools',
  sources: 'ce_sources',
  units: 'ce_knowledge_units',
  reviews: 'ce_reviews',
  runs: 'ce_pipeline_runs',
  deliveries: 'ce_deliveries',
  reviewerPrompts: REVIEWER_PROMPT_COLLECTION,
  dispatchBatches: 'ce_dispatch_batches',
  dispatchItems: 'ce_dispatch_items'
});
const META_ID = '_meta';
const MAX_BATCH = 100;
const MAX_SOURCE_TEXT = 850000;

function clean(value, max = 4000) {
  return value === null || value === undefined ? '' : String(value).trim().slice(0, max);
}

function send(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(payload);
}

function fail(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = status;
  throw error;
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  try { return JSON.parse(body); } catch { return {}; }
}

function safeId(value, label = 'ID') {
  const id = clean(value, 200);
  if (!id || !/^[A-Za-z0-9:_-]{1,200}$/.test(id)) fail('SG-CE-POOL-ID-001', `${label} 형식을 확인해 주세요.`);
  return id;
}

function now() { return new Date().toISOString(); }
function jsonSize(value) { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }

function sanitizeSource(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('SG-CE-POOL-SOURCE-001', '자료 형식을 확인해 주세요.');
  const id = clean(raw.id, 128);
  if (!/^[a-f0-9]{64}$/.test(id)) fail('SG-CE-POOL-SOURCE-002', '자료 ID가 올바르지 않습니다.');
  const title = clean(raw.title, 1000);
  if (!title) fail('SG-CE-POOL-SOURCE-003', '자료 제목이 없습니다.');
  const text = raw.text === null || raw.text === undefined ? '' : String(raw.text);
  const abstract = raw.abstract === null || raw.abstract === undefined ? '' : String(raw.abstract);
  if (text.length > MAX_SOURCE_TEXT || abstract.length > 50000) fail('SG-CE-POOL-SOURCE-004', '자료 본문이 중앙 지식 풀 저장 한도를 넘었습니다.', 413);
  const source = {
    id, title,
    categories: Array.isArray(raw.categories) ? [...new Set(raw.categories.map((item) => clean(item, 80)).filter(Boolean))].slice(0, 20) : [],
    provider: clean(raw.provider, 80), externalId: clean(raw.externalId, 300), url: clean(raw.url, 2000),
    authors: clean(raw.authors, 3000), year: clean(raw.year, 20), abstract, text,
    format: clean(raw.format, 80), status: clean(raw.status, 80), license: clean(raw.license, 3000),
    warning: clean(raw.warning, 1000), acquiredAt: clean(raw.acquiredAt, 80)
  };
  if (jsonSize(source) > 950000) fail('SG-CE-POOL-SOURCE-005', '자료가 Firestore 문서 한도에 가까워 저장할 수 없습니다.', 413);
  return source;
}

function sanitizeUnit(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('SG-CE-POOL-UNIT-001', '지식 카드 형식을 확인해 주세요.');
  const id = safeId(raw.id, '지식 ID');
  const unit = {
    id,
    revision: Number(raw.revision) || 1,
    title: clean(raw.title, 300), claim: clean(raw.claim, 6000), explanation: clean(raw.explanation, 12000),
    application: clean(raw.application, 6000), limitations: clean(raw.limitations, 6000),
    evidence: Array.isArray(raw.evidence) ? raw.evidence.slice(0, 30).map((item) => ({
      sourceId: clean(item?.sourceId, 128), scope: item?.scope === 'abstract' ? 'abstract' : 'body',
      start: Math.max(0, Number(item?.start) || 0), end: Math.max(0, Number(item?.end) || 0),
      quote: clean(item?.quote, 30000), label: clean(item?.label, 200)
    })) : [],
    status: raw.status === 'approved' ? 'approved' : 'draft',
    updatedAt: clean(raw.updatedAt, 80) || now(), reviewedAt: raw.reviewedAt ? clean(raw.reviewedAt, 80) : null,
    reviewer: raw.reviewer ? clean(raw.reviewer, 80) : null,
    generationSessionId: raw.generationSessionId ? clean(raw.generationSessionId, 160) : null,
    poolIds: Array.isArray(raw.poolIds) ? [...new Set(raw.poolIds.map((item) => clean(item, 160)).filter(Boolean))].slice(0, 20) : []
  };
  if (![unit.title, unit.claim, unit.explanation, unit.application, unit.limitations].every(Boolean)) fail('SG-CE-POOL-UNIT-002', '지식 카드 필수 내용이 비어 있습니다.');
  if (!unit.evidence.length) fail('SG-CE-POOL-UNIT-003', '지식 카드에는 원문 근거가 필요합니다.');
  return unit;
}

function sanitizePool(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('SG-CE-POOL-DEF-001', '지식 풀 형식을 확인해 주세요.');
  return {
    id: safeId(raw.id, '지식 풀 ID'), name: clean(raw.name, 120), description: clean(raw.description, 1000), direction: clean(raw.direction, 2000),
    domainIds: Array.isArray(raw.domainIds) ? raw.domainIds.map((v) => clean(v, 80)).filter(Boolean).slice(0, 20) : [],
    providerIds: Array.isArray(raw.providerIds) ? raw.providerIds.map((v) => clean(v, 80)).filter(Boolean).slice(0, 100) : [],
    kind: raw.kind === 'custom' ? 'custom' : 'starter'
  };
}

function sanitizeReview(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('SG-CE-POOL-REVIEW-001', '검수 결과 형식을 확인해 주세요.');
  return {
    id: safeId(raw.id || crypto.randomUUID(), '검수 ID'), unitId: safeId(raw.unitId, '지식 ID'), action: clean(raw.action, 40),
    confidence: clean(raw.confidence, 40), evidenceFit: clean(raw.evidenceFit, 40), generalizability: clean(raw.generalizability, 40),
    duplicateRisk: clean(raw.duplicateRisk, 40), reason: clean(raw.reason, 6000), model: clean(raw.model, 160),
    reviewerPromptId: raw.reviewerPromptId ? safeId(raw.reviewerPromptId, 'Reviewer 프롬프트 ID') : null,
    revised: raw.revised && typeof raw.revised === 'object' ? {
      title: clean(raw.revised.title, 300), claim: clean(raw.revised.claim, 6000), explanation: clean(raw.revised.explanation, 12000),
      application: clean(raw.revised.application, 6000), limitations: clean(raw.revised.limitations, 6000)
    } : null,
    reviewedAt: clean(raw.reviewedAt, 80) || now()
  };
}

function sanitizeDispatchBatch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('SG-CE-DISPATCH-001', '배송 묶음 형식을 확인해 주세요.');
  const status = ['waiting', 'sending', 'done', 'partial', 'failed'].includes(raw.status) ? raw.status : 'waiting';
  return {
    id: safeId(raw.id || `dispatch-${crypto.randomUUID()}`, '배송 묶음 ID'),
    runId: raw.runId ? safeId(raw.runId, '실행 ID') : null,
    name: clean(raw.name, 240) || 'ChunkingExpress 배송 묶음',
    sourceMode: raw.sourceMode === 'manual' ? 'manual' : 'auto',
    destination: clean(raw.destination, 120) || 'sajugrap',
    status,
    poolIds: Array.isArray(raw.poolIds) ? raw.poolIds.map((v) => clean(v, 160)).filter(Boolean).slice(0, 30) : [],
    reviewerPromptId: raw.reviewerPromptId ? safeId(raw.reviewerPromptId, 'Reviewer 프롬프트 ID') : null,
    unitCount: Math.max(0, Number(raw.unitCount) || 0), chunkCount: Math.max(0, Number(raw.chunkCount) || 0),
    preparedAt: clean(raw.preparedAt, 80) || now(), deliveredAt: raw.deliveredAt ? clean(raw.deliveredAt, 80) : null,
    createdCount: Math.max(0, Number(raw.createdCount) || 0), existingCount: Math.max(0, Number(raw.existingCount) || 0),
    failedCount: Math.max(0, Number(raw.failedCount) || 0),
  };
}

function sanitizeDispatchItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('SG-CE-DISPATCH-ITEM-001', '배송 항목 형식을 확인해 주세요.');
  const unit = sanitizeUnit(raw.unit);
  const chunks = Array.isArray(raw.chunks) ? JSON.parse(JSON.stringify(raw.chunks.slice(0, 80))) : [];
  if (!chunks.length) fail('SG-CE-DISPATCH-ITEM-002', '배송 항목에 청크가 없습니다.');
  const item = {
    id: safeId(raw.id || `${raw.batchId}:${unit.id}`, '배송 항목 ID'),
    batchId: safeId(raw.batchId, '배송 묶음 ID'), unitId: unit.id,
    title: clean(raw.title || unit.title, 300), claim: clean(raw.claim || unit.claim, 6000),
    status: ['waiting', 'sending', 'done', 'partial', 'failed'].includes(raw.status) ? raw.status : 'waiting',
    reviewer: raw.reviewer && typeof raw.reviewer === 'object' ? JSON.parse(JSON.stringify(raw.reviewer)) : null,
    unit, chunks,
    preparedAt: clean(raw.preparedAt, 80) || now(), deliveredAt: raw.deliveredAt ? clean(raw.deliveredAt, 80) : null,
  };
  if (jsonSize(item) > 930000) fail('SG-CE-DISPATCH-ITEM-003', `“${item.title}” 배송 항목이 Firestore 문서 한도를 넘습니다.`, 413);
  return item;
}

async function database() {
  const connection = await getFirestoreClient();
  if (connection.auth?.projectId !== PROJECT_ID) fail('SG-CE-POOL-TARGET-001', 'Knowledge Pool 저장 대상이 saju-grap 프로젝트가 아닙니다.', 503);
  return connection.db;
}

async function ensureCollections(db, uid) {
  const timestamp = now();
  const batch = db.batch();
  for (const [purpose, name] of Object.entries(COLLECTIONS)) {
    batch.set(db.collection(name).doc(META_ID), {
      schemaVersion: SCHEMA, purpose, collection: name, temporaryHostProject: PROJECT_ID, portable: true,
      createdBy: 'chunking-express', updatedAt: timestamp, lastAdminUid: uid
    }, { merge: true });
  }
  await batch.commit();
  await ensureDefaultReviewerPrompt(db, uid);
}

async function batchUpsert(db, collectionName, items, idOf, uid) {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_BATCH) fail('SG-CE-POOL-BATCH-001', `한 번에 1~${MAX_BATCH}개까지 저장할 수 있습니다.`);
  const timestamp = now();
  const batch = db.batch();
  for (const item of items) {
    const id = idOf(item);
    batch.set(db.collection(collectionName).doc(id), { ...item, schemaVersion: SCHEMA, ownerUid: uid, syncedAt: timestamp }, { merge: true });
  }
  await batch.commit();
  return { saved: items.length, collection: collectionName, syncedAt: timestamp };
}

async function listDocs(db, collectionName, filter = () => true, sortField = 'updatedAt', limit = 100) {
  const snapshot = await db.collection(collectionName).get();
  return snapshot.docs
    .filter((doc) => !doc.id.startsWith('_'))
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter(filter)
    .sort((a, b) => String(b[sortField] || '').localeCompare(String(a[sortField] || '')))
    .slice(0, limit);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { success: false, error: { code: 'SG-CE-POOL-405', message: 'GET/POST만 허용됩니다.' } });

  let admin;
  try { admin = await requireRagAdmin(req); }
  catch (error) { return send(res, error.httpStatus || 401, { success: false, error: { code: error.code || 'SG-CE-POOL-AUTH-001', message: error.message } }); }

  try {
    const body = parseBody(req.body);
    const action = clean(body.action || req.query?.action || 'status', 80);
    const db = await database();

    if (action === 'status') {
      await ensureCollections(db, admin.uid);
      return send(res, 200, { success: true, data: { projectId: PROJECT_ID, schemaVersion: SCHEMA, collections: COLLECTIONS, storage: 'temporary-central-pool', portable: true } });
    }
    if (action === 'upsertPools') return send(res, 200, { success: true, data: await batchUpsert(db, COLLECTIONS.pools, (Array.isArray(body.pools) ? body.pools : []).map(sanitizePool), (item) => item.id, admin.uid) });
    if (action === 'upsertSources') return send(res, 200, { success: true, data: await batchUpsert(db, COLLECTIONS.sources, (Array.isArray(body.sources) ? body.sources : []).map(sanitizeSource), (item) => item.id, admin.uid) });
    if (action === 'upsertUnits') return send(res, 200, { success: true, data: await batchUpsert(db, COLLECTIONS.units, (Array.isArray(body.units) ? body.units : []).map(sanitizeUnit), (item) => item.id, admin.uid) });
    if (action === 'writeReviews') return send(res, 200, { success: true, data: await batchUpsert(db, COLLECTIONS.reviews, (Array.isArray(body.reviews) ? body.reviews : []).map(sanitizeReview), (item) => item.id, admin.uid) });
    if (action === 'writeRuns') {
      const runs = (Array.isArray(body.runs) ? body.runs : []).map((raw) => ({ ...raw, id: safeId(raw?.id || crypto.randomUUID(), '실행 ID'), updatedAt: now() }));
      return send(res, 200, { success: true, data: await batchUpsert(db, COLLECTIONS.runs, runs, (item) => item.id, admin.uid) });
    }
    if (action === 'writeDeliveries') {
      const deliveries = (Array.isArray(body.deliveries) ? body.deliveries : []).map((raw) => ({ ...raw, id: safeId(raw?.id || crypto.randomUUID(), '전송 기록 ID'), destination: clean(raw?.destination, 120), updatedAt: now() }));
      return send(res, 200, { success: true, data: await batchUpsert(db, COLLECTIONS.deliveries, deliveries, (item) => item.id, admin.uid) });
    }
    if (action === 'getReviewerPrompt') return send(res, 200, { success: true, data: await getReviewerPrompt(db, body.promptId || req.query?.promptId || '', admin.uid) });
    if (action === 'listReviewerPrompts') return send(res, 200, { success: true, data: { prompts: await listReviewerPrompts(db, admin.uid) } });
    if (action === 'saveReviewerPrompt') return send(res, 200, { success: true, data: await saveReviewerPrompt(db, { prompt: body.prompt, name: body.name, uid: admin.uid }) });
    if (action === 'writeDispatchBatches') {
      const items = (Array.isArray(body.batches) ? body.batches : []).map(sanitizeDispatchBatch);
      return send(res, 200, { success: true, data: await batchUpsert(db, COLLECTIONS.dispatchBatches, items, (item) => item.id, admin.uid) });
    }
    if (action === 'writeDispatchItems') {
      const items = (Array.isArray(body.items) ? body.items : []).map(sanitizeDispatchItem);
      return send(res, 200, { success: true, data: await batchUpsert(db, COLLECTIONS.dispatchItems, items, (item) => item.id, admin.uid) });
    }
    if (action === 'listDispatchBatches') {
      const batches = await listDocs(db, COLLECTIONS.dispatchBatches, () => true, 'preparedAt', 100);
      return send(res, 200, { success: true, data: { batches } });
    }
    if (action === 'getDispatchItems') {
      const batchId = safeId(body.batchId || req.query?.batchId, '배송 묶음 ID');
      const items = await listDocs(db, COLLECTIONS.dispatchItems, (item) => item.batchId === batchId, 'preparedAt', 500);
      return send(res, 200, { success: true, data: { items } });
    }

    return send(res, 400, { success: false, error: { code: 'SG-CE-POOL-ACTION-001', message: '지원하지 않는 Knowledge Pool 작업입니다.' } });
  } catch (error) {
    return send(res, error.httpStatus || 500, { success: false, error: { code: error.code || 'SG-CE-POOL-500', message: error.message || 'Knowledge Pool 저장 중 오류가 발생했습니다.' } });
  }
}
