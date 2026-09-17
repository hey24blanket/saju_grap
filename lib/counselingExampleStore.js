import crypto from 'node:crypto';
import { FieldValue } from '@google-cloud/firestore';
import { embedBatch, embedQuery } from './embeddingProvider.js';
import { getFirestoreClient } from './ragRetriever.js';

export const COUNSELING_EXAMPLE_COLLECTION =
  process.env.COUNSELING_EXAMPLE_COLLECTION || 'sajugrap_counseling_examples';

export const COUNSELING_EXAMPLE_SCHEMA_VERSION = 'counseling_example_v1';
export const COUNSELING_EXAMPLE_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2';
export const COUNSELING_EXAMPLE_EMBEDDING_DIMENSIONS = Number(
  process.env.RAG_EMBEDDING_DIMENSIONS || 768
);

const ALLOWED_SPLITS = new Set(['train', 'validation', 'holdout']);
const MAX_BATCH = 32;

function fail(code, message, httpStatus = 400, detail = null) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  error.detail = detail;
  throw error;
}

function cleanText(value, max = 20000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function textPart(content) {
  return safeArray(content?.parts)
    .map((part) => cleanText(part?.text, 30000))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function stripSyntheticContext(text) {
  const marker = '[CURRENT USER MESSAGE]';
  const index = text.indexOf(marker);
  return index >= 0 ? cleanText(text.slice(index + marker.length), 12000) : cleanText(text, 12000);
}

function normalizeState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    facts: safeArray(source.facts).map((item) => cleanText(item, 1000)).filter(Boolean).slice(0, 30),
    constraints: safeArray(source.constraints).map((item) => cleanText(item, 1000)).filter(Boolean).slice(0, 30),
    attempts: safeArray(source.attempts).map((item) => cleanText(item, 1000)).filter(Boolean).slice(0, 30),
    corrections: safeArray(source.corrections).map((item) => cleanText(item, 1000)).filter(Boolean).slice(0, 30)
  };
}

export function normalizeGoldenCounselingExample(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    fail('SG-CE-EXAMPLE-INPUT-001', '상담 예시 한 줄은 JSON 객체여야 합니다.');
  }

  const exampleId = cleanText(row.id, 160);
  const split = cleanText(row.split, 30);
  const category = cleanText(row.category, 80);
  const scenarioId = cleanText(row.scenario_id, 80);
  const scenarioTitle = cleanText(row.scenario_title, 300);
  const variationName = cleanText(row.variation_name, 120);
  const skills = safeArray(row.skills).map((item) => cleanText(item, 120)).filter(Boolean).slice(0, 30);
  const state = normalizeState(row.state);
  const contents = safeArray(row.vertex?.contents);

  if (!/^[A-Za-z0-9._:-]{3,160}$/.test(exampleId)) {
    fail('SG-CE-EXAMPLE-INPUT-002', '상담 예시 id 형식이 올바르지 않습니다.', 400, exampleId);
  }
  if (!ALLOWED_SPLITS.has(split) || !category || !scenarioTitle || contents.length < 2) {
    fail('SG-CE-EXAMPLE-INPUT-003', 'split/category/scenario/대화 내용이 누락되었습니다.', 400, exampleId);
  }

  const dialogue = [];
  const userTurns = [];
  const modelTurns = [];
  for (const item of contents) {
    const role = item?.role === 'model' ? 'model' : item?.role === 'user' ? 'user' : '';
    if (!role) continue;
    let text = textPart(item);
    if (!text) continue;
    if (role === 'user' && userTurns.length === 0) text = stripSyntheticContext(text);
    dialogue.push({ role, text });
    if (role === 'user') userTurns.push(text);
    else modelTurns.push(text);
  }
  if (!userTurns.length || !modelTurns.length) {
    fail('SG-CE-EXAMPLE-INPUT-004', 'user/model 대화가 모두 필요합니다.', 400, exampleId);
  }

  const goldResponse = modelTurns[modelTurns.length - 1];
  const retrievalText = [
    `category: ${category}`,
    `scenario: ${scenarioTitle}`,
    variationName ? `variation: ${variationName}` : '',
    skills.length ? `skills: ${skills.join(', ')}` : '',
    ...userTurns.map((text, index) => `user${index + 1}: ${text}`)
  ].filter(Boolean).join('\n');

  const normalized = {
    schemaVersion: COUNSELING_EXAMPLE_SCHEMA_VERSION,
    exampleId,
    split,
    category,
    scenarioId,
    scenarioTitle,
    variationName,
    skills,
    state,
    dialogue,
    userTurns,
    goldResponse,
    retrievalText,
    source: 'sajugrap_golden_dataset_v1'
  };

  return {
    ...normalized,
    contentHash: sha256(JSON.stringify(normalized))
  };
}

export function validateGoldenCounselingExamples(rows) {
  const input = safeArray(rows);
  const errors = [];
  const normalized = [];
  const seen = new Set();

  input.forEach((row, index) => {
    try {
      const item = normalizeGoldenCounselingExample(row);
      if (seen.has(item.exampleId)) {
        errors.push({ index, id: item.exampleId, code: 'DUPLICATE_ID', message: '같은 example id가 중복되었습니다.' });
        return;
      }
      seen.add(item.exampleId);
      normalized.push(item);
    } catch (error) {
      errors.push({
        index,
        id: cleanText(row?.id, 160) || null,
        code: error.code || 'INVALID_EXAMPLE',
        message: error.message
      });
    }
  });

  return {
    valid: input.length > 0 && errors.length === 0,
    summary: {
      total: input.length,
      valid: normalized.length,
      invalid: errors.length,
      categories: [...new Set(normalized.map((item) => item.category))].sort(),
      splits: [...new Set(normalized.map((item) => item.split))].sort()
    },
    errors,
    normalized
  };
}

async function checkedFirestore() {
  const connection = await getFirestoreClient();
  if (connection.auth?.projectId && connection.auth.projectId !== 'saju-grap') {
    fail('SG-CE-EXAMPLE-TARGET-001', '상담 예시는 saju-grap Firestore에만 저장할 수 있습니다.', 503);
  }
  return connection.db;
}

export async function importCounselingExampleBatch({
  rows,
  sourceFileName = null,
  adminUid = null
} = {}) {
  const input = safeArray(rows);
  if (!input.length || input.length > MAX_BATCH) {
    fail('SG-CE-EXAMPLE-BATCH-001', `한 번에 1~${MAX_BATCH}개 상담 예시만 업로드할 수 있습니다.`);
  }
  const validation = validateGoldenCounselingExamples(input);
  if (!validation.valid) {
    const error = new Error('상담 Golden Dataset 검증에 실패했습니다.');
    error.code = 'SG-CE-EXAMPLE-BATCH-002';
    error.httpStatus = 400;
    error.detail = validation.errors.slice(0, 20);
    throw error;
  }

  const db = await checkedFirestore();
  const now = new Date().toISOString();
  const embeddings = await embedBatch(
    validation.normalized.map((item) => ({ text: item.retrievalText, title: item.scenarioTitle })),
    {
      model: COUNSELING_EXAMPLE_EMBEDDING_MODEL,
      dimensions: COUNSELING_EXAMPLE_EMBEDDING_DIMENSIONS,
      batchSize: Math.min(MAX_BATCH, validation.normalized.length)
    }
  );

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const ids = [];

  for (let index = 0; index < validation.normalized.length; index += 1) {
    const item = validation.normalized[index];
    const embedding = embeddings[index];
    if (!Array.isArray(embedding?.vector) || embedding.vector.length !== COUNSELING_EXAMPLE_EMBEDDING_DIMENSIONS) {
      fail('SG-CE-EXAMPLE-EMBED-001', '상담 예시 embedding 결과가 올바르지 않습니다.', 503, item.exampleId);
    }

    const reference = db.collection(COUNSELING_EXAMPLE_COLLECTION).doc(item.exampleId);
    const existing = await reference.get();
    const existingData = existing.exists ? existing.data() : null;
    if (existingData?.contentHash === item.contentHash) {
      unchanged += 1;
      ids.push(item.exampleId);
      continue;
    }

    const document = {
      ...item,
      status: 'inactive',
      retrievalAllowed: false,
      sourceFileName: cleanText(sourceFileName, 500) || null,
      embedding: {
        provider: 'gemini',
        model: COUNSELING_EXAMPLE_EMBEDDING_MODEL,
        dimensions: COUNSELING_EXAMPLE_EMBEDDING_DIMENSIONS,
        embeddedAt: now
      },
      embeddingVector: FieldValue.vector([...embedding.vector]),
      importedBy: cleanText(adminUid, 200) || null,
      createdAt: existingData?.createdAt || now,
      updatedAt: now,
      activatedAt: null
    };

    await reference.set(document, { merge: false });
    if (existing.exists) updated += 1;
    else created += 1;
    ids.push(item.exampleId);
  }

  return {
    collection: COUNSELING_EXAMPLE_COLLECTION,
    total: validation.normalized.length,
    created,
    updated,
    unchanged,
    ids,
    status: 'inactive',
    retrievalAllowed: false
  };
}

export async function getCounselingExampleStatus() {
  const db = await checkedFirestore();
  const snapshot = await db.collection(COUNSELING_EXAMPLE_COLLECTION).limit(1000).get();
  let active = 0;
  let inactive = 0;
  const categories = {};
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.status === 'active' && data.retrievalAllowed === true) active += 1;
    else inactive += 1;
    const category = cleanText(data.category, 80) || 'unknown';
    categories[category] = (categories[category] || 0) + 1;
  }
  return {
    collection: COUNSELING_EXAMPLE_COLLECTION,
    total: snapshot.size,
    active,
    inactive,
    categories,
    embedding: {
      model: COUNSELING_EXAMPLE_EMBEDDING_MODEL,
      dimensions: COUNSELING_EXAMPLE_EMBEDDING_DIMENSIONS
    }
  };
}

export async function activateCounselingExamples({ ids = null, adminUid = null } = {}) {
  const db = await checkedFirestore();
  const requestedIds = safeArray(ids).map((item) => cleanText(item, 160)).filter(Boolean);
  const snapshot = requestedIds.length
    ? null
    : await db.collection(COUNSELING_EXAMPLE_COLLECTION).limit(1000).get();
  const refs = requestedIds.length
    ? requestedIds.map((id) => db.collection(COUNSELING_EXAMPLE_COLLECTION).doc(id))
    : snapshot.docs.map((doc) => doc.ref);
  const now = new Date().toISOString();
  let updated = 0;

  for (let start = 0; start < refs.length; start += 400) {
    const batch = db.batch();
    for (const ref of refs.slice(start, start + 400)) {
      batch.set(ref, {
        status: 'active',
        retrievalAllowed: true,
        activatedAt: now,
        activatedBy: cleanText(adminUid, 200) || null,
        updatedAt: now
      }, { merge: true });
      updated += 1;
    }
    await batch.commit();
  }

  return { collection: COUNSELING_EXAMPLE_COLLECTION, updated, status: 'active', retrievalAllowed: true };
}

export async function searchCounselingExamples({
  query,
  category = null,
  limit = 4,
  includeInactive = false
} = {}) {
  const text = cleanText(query, 5000);
  if (!text) fail('SG-CE-EXAMPLE-SEARCH-001', '검색 질문이 비어 있습니다.');
  const wantedCategory = cleanText(category, 80);
  const targetLimit = Math.max(1, Math.min(10, Number(limit) || 4));
  const embedding = await embedQuery(text, {
    model: COUNSELING_EXAMPLE_EMBEDDING_MODEL,
    dimensions: COUNSELING_EXAMPLE_EMBEDDING_DIMENSIONS
  });
  const db = await checkedFirestore();
  const vectorQuery = db.collection(COUNSELING_EXAMPLE_COLLECTION).findNearest({
    vectorField: 'embeddingVector',
    queryVector: embedding.vector,
    limit: Math.min(80, targetLimit * 12),
    distanceMeasure: 'COSINE',
    distanceResultField: '__distance'
  });
  const snapshot = await vectorQuery.get();
  const results = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!includeInactive && (data.status !== 'active' || data.retrievalAllowed !== true)) continue;
    if (wantedCategory && wantedCategory !== 'all' && data.category !== wantedCategory) continue;
    results.push({
      exampleId: data.exampleId || doc.id,
      category: data.category,
      scenarioTitle: data.scenarioTitle,
      variationName: data.variationName,
      skills: safeArray(data.skills),
      userTurns: safeArray(data.userTurns),
      goldResponse: data.goldResponse,
      status: data.status,
      retrievalAllowed: data.retrievalAllowed === true,
      distance: typeof data.__distance === 'number' ? data.__distance : null,
      semanticScore: typeof data.__distance === 'number' ? Math.max(0, 1 - data.__distance) : null
    });
    if (results.length >= targetLimit) break;
  }
  return { query: text, category: wantedCategory || null, includeInactive: Boolean(includeInactive), results };
}

export function buildCounselingExampleContext(results, { maxExamples = 3 } = {}) {
  return safeArray(results).slice(0, maxExamples).map((item, index) => {
    const users = safeArray(item.userTurns).map((text, i) => `USER ${i + 1}: ${cleanText(text, 3000)}`).join('\n');
    return [
      `[COUNSELING EXAMPLE ${index + 1}]`,
      `category=${cleanText(item.category, 80)}`,
      `skills=${safeArray(item.skills).join(', ')}`,
      users,
      `GOOD RESPONSE:\n${cleanText(item.goldResponse, 6000)}`,
      'Use the counseling behavior and boundaries only. Do not copy the example\'s real-world facts into the current user.'
    ].join('\n');
  }).join('\n\n');
}

export default Object.freeze({
  COUNSELING_EXAMPLE_COLLECTION,
  normalizeGoldenCounselingExample,
  validateGoldenCounselingExamples,
  importCounselingExampleBatch,
  getCounselingExampleStatus,
  activateCounselingExamples,
  searchCounselingExamples,
  buildCounselingExampleContext
});
