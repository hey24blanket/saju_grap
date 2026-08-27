// lib/ragManagerCore.js
// SajuGrap RAG Manager core
// -----------------------------------------------------------------------------
// Browser/Admin API and CLI should share this layer.
// It owns version metadata, JSONL validation/diff, resumable embedding jobs,
// promote/rollback, and quick vector smoke tests.
// It does NOT calculate Engine Facts.
// -----------------------------------------------------------------------------

import crypto from 'node:crypto';
import {
  FieldValue
} from '@google-cloud/firestore';

import {
  RAG_KNOWLEDGE_LAYERS,
  buildRagEmbeddingText,
  validateRagDocument
} from './ragDocumentSchema.js';

import {
  attachEmbeddingsToRagDocuments,
  embedQuery,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_DIMENSIONS
} from './embeddingProvider.js';

import {
  DEFAULT_DISTANCE_MEASURE,
  DEFAULT_RAG_COLLECTION,
  DEFAULT_VECTOR_FIELD,
  getFirestoreClient
} from './ragRetriever.js';

export const RAG_MANAGER_VERSION = 'rag_manager_mvp_v1';
export const RAG_MANAGER_COLLECTION =
  process.env.RAG_MANAGER_COLLECTION || 'sajugrap_rag_manager';
export const RAG_VERSION_COLLECTION =
  process.env.RAG_VERSION_COLLECTION || 'sajugrap_rag_versions';
export const RAG_RUNTIME_DOC = 'runtime';

const MAX_JSONL_DOCUMENTS = Number(process.env.RAG_MANAGER_MAX_DOCUMENTS || 3000);
const DEFAULT_EMBED_BATCH_SIZE = Number(process.env.RAG_MANAGER_EMBED_BATCH_SIZE || 12);
const MAX_EMBED_BATCH_SIZE = 32;
const STALE_PROCESSING_MS = 10 * 60 * 1000;

const VERSION_STATUS = Object.freeze({
  PREPARING: 'PREPARING',
  EMBEDDING: 'EMBEDDING',
  READY: 'READY',
  PRODUCTION: 'PRODUCTION',
  ARCHIVED: 'ARCHIVED',
  FAILED: 'FAILED'
});

const DIFF_STATE = Object.freeze({
  UNCHANGED: 'UNCHANGED',
  METADATA_MODIFIED: 'METADATA_MODIFIED',
  EMBEDDING_INPUT_MODIFIED: 'EMBEDDING_INPUT_MODIFIED',
  ADDED: 'ADDED'
});

function cleanText(value, max = 5000) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, max);
}

function nowIso() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        const item = value[key];
        if (item !== undefined) acc[key] = canonicalize(item);
        return acc;
      }, {});
  }

  return value;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function withoutRuntimeFields(document) {
  const source = { ...document };
  delete source.ragVersion;
  delete source.documentHash;
  delete source.embeddingHash;
  delete source.embeddingVector;
  delete source.managerMeta;
  delete source.firestoreMeta;
  delete source.__vectorDistance;
  delete source.createdAt;
  delete source.updatedAt;

  // Embedding provider/model/vector are runtime artifacts, not authored content.
  // documentHash should stay stable whether the JSONL is pre-embedded or not.
  delete source.embedding;

  return source;
}

export function documentHashFor(document) {
  return sha256(JSON.stringify(canonicalize(withoutRuntimeFields(document))));
}

export function embeddingHashFor(document) {
  return sha256(cleanText(document?.embeddingText, 20000));
}

function safeVersionId(value) {
  const version = cleanText(value, 120)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!version || version.length < 2) {
    throw Object.assign(new Error('RAG version 이름이 올바르지 않습니다.'), {
      code: 'SG-RAG-MANAGER-VERSION-001'
    });
  }

  return version;
}

function chunkDocId(version, chunkId) {
  const safeChunk = cleanText(chunkId, 800).replace(/\//g, '_');
  return `${version}__${safeChunk}`;
}

function normalizeKnowledgeLayer(value) {
  const layer = cleanText(value, 60) || 'myeongri';
  if (!RAG_KNOWLEDGE_LAYERS.includes(layer)) {
    throw Object.assign(
      new Error(`지원하지 않는 knowledgeLayer입니다: ${layer}`),
      { code: 'SG-RAG-MANAGER-LAYER-001' }
    );
  }
  return layer;
}

function parseJsonl(jsonlText) {
  const text = String(jsonlText || '').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  const documents = [];
  const parseErrors = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (documents.length >= MAX_JSONL_DOCUMENTS) {
      parseErrors.push({
        line: index + 1,
        message: `최대 ${MAX_JSONL_DOCUMENTS}개 chunk를 초과했습니다.`
      });
      return;
    }

    try {
      documents.push({
        line: index + 1,
        value: JSON.parse(trimmed)
      });
    } catch (error) {
      parseErrors.push({
        line: index + 1,
        message: error.message
      });
    }
  });

  return { documents, parseErrors };
}

function normalizeIncomingDocument(raw) {
  const source = cloneJson(raw);

  delete source.ragVersion;
  delete source.documentHash;
  delete source.embeddingHash;
  delete source.embeddingVector;
  delete source.managerMeta;
  delete source.firestoreMeta;
  delete source.__vectorDistance;

  source.knowledgeLayer = normalizeKnowledgeLayer(source.knowledgeLayer);

  if (!source.embedding || typeof source.embedding !== 'object') {
    source.embedding = {};
  } else {
    source.embedding = { ...source.embedding };
    delete source.embedding.vector;
  }

  // Never trust stale client embeddingText; rebuild with the same production schema helper.
  source.embeddingText = buildRagEmbeddingText(source);

  return source;
}

export function validateJsonlCorpus(jsonlText) {
  const { documents, parseErrors } = parseJsonl(jsonlText);
  const seen = new Map();
  const normalized = [];
  const errors = parseErrors.map((item) => ({
    type: 'json_parse',
    ...item
  }));
  const warnings = [];

  for (const entry of documents) {
    let document;
    try {
      document = normalizeIncomingDocument(entry.value);
    } catch (error) {
      errors.push({
        type: 'normalize',
        line: entry.line,
        chunkId: entry.value?.chunkId || null,
        message: error.message
      });
      continue;
    }

    const chunkId = cleanText(document.chunkId, 180);
    if (chunkId) {
      if (seen.has(chunkId)) {
        errors.push({
          type: 'duplicate_chunk_id',
          line: entry.line,
          chunkId,
          message: `chunkId 중복: ${chunkId} (첫 등장 line ${seen.get(chunkId)})`
        });
        continue;
      }
      seen.set(chunkId, entry.line);
    }

    const validation = validateRagDocument(document);
    if (!validation.valid) {
      for (const item of validation.errors) {
        errors.push({
          type: 'schema',
          line: entry.line,
          chunkId: chunkId || null,
          field: item.field,
          message: item.message
        });
      }
      continue;
    }

    for (const item of validation.warnings) {
      warnings.push({
        line: entry.line,
        chunkId: chunkId || null,
        field: item.field,
        message: item.message
      });
    }

    const documentHash = documentHashFor(document);
    const embeddingHash = embeddingHashFor(document);

    normalized.push({
      ...document,
      documentHash,
      embeddingHash
    });
  }

  const layers = normalized.reduce((acc, document) => {
    acc[document.knowledgeLayer] = (acc[document.knowledgeLayer] || 0) + 1;
    return acc;
  }, {});

  return {
    valid: errors.length === 0 && normalized.length > 0,
    summary: {
      total: normalized.length,
      errorCount: errors.length,
      warningCount: warnings.length,
      knowledgeLayers: layers
    },
    documents: normalized,
    errors,
    warnings
  };
}

async function getDb() {
  const { db, auth } = await getFirestoreClient();
  return { db, auth };
}

function runtimeRef(db) {
  return db.collection(RAG_MANAGER_COLLECTION).doc(RAG_RUNTIME_DOC);
}

function versionRef(db, version) {
  return db.collection(RAG_VERSION_COLLECTION).doc(version);
}

export async function getActiveRagVersion(db = null) {
  const firestore = db || (await getDb()).db;
  const snapshot = await runtimeRef(firestore).get();
  return snapshot.exists ? cleanText(snapshot.data()?.activeRagVersion, 120) || null : null;
}

async function loadVersionDocuments(db, version) {
  const snapshot = await db
    .collection(DEFAULT_RAG_COLLECTION)
    .where('ragVersion', '==', version)
    .get();

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ref: doc.ref,
    data: doc.data()
  }));
}

async function loadLegacyDocuments(db) {
  const snapshot = await db.collection(DEFAULT_RAG_COLLECTION).get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ref: doc.ref, data: doc.data() }))
    .filter((item) => !cleanText(item.data?.ragVersion, 120));
}

function embeddingReusable(previous) {
  return Boolean(
    previous?.embeddingVector &&
    previous?.embedding?.provider === 'gemini' &&
    previous?.embedding?.model === DEFAULT_EMBEDDING_MODEL &&
    Number(previous?.embedding?.dimensions) === Number(DEFAULT_EMBEDDING_DIMENSIONS)
  );
}

function classifyDiff(next, previous) {
  if (!previous) {
    return DIFF_STATE.ADDED;
  }

  const prevDocHash = previous.documentHash || documentHashFor(previous);
  const prevEmbeddingHash = previous.embeddingHash || embeddingHashFor(previous);

  if (
    next.documentHash === prevDocHash &&
    next.embeddingHash === prevEmbeddingHash &&
    embeddingReusable(previous)
  ) {
    return DIFF_STATE.UNCHANGED;
  }

  if (next.embeddingHash === prevEmbeddingHash && embeddingReusable(previous)) {
    return DIFF_STATE.METADATA_MODIFIED;
  }

  return DIFF_STATE.EMBEDDING_INPUT_MODIFIED;
}

async function commitInBatches(db, operations, batchLimit = 400) {
  for (let start = 0; start < operations.length; start += batchLimit) {
    const batch = db.batch();
    const slice = operations.slice(start, start + batchLimit);
    for (const operation of slice) {
      if (operation.type === 'set') {
        batch.set(operation.ref, operation.data, operation.options || {});
      } else if (operation.type === 'update') {
        batch.update(operation.ref, operation.data);
      } else if (operation.type === 'delete') {
        batch.delete(operation.ref);
      }
    }
    await batch.commit();
  }
}

export async function createDraftVersion({
  version,
  jsonlText,
  sourceFileName = null,
  adminUid = null
}) {
  const safeVersion = safeVersionId(version);
  const validation = validateJsonlCorpus(jsonlText);

  if (!validation.valid) {
    const error = new Error('JSONL 검증에 실패했습니다. Draft를 생성하지 않았습니다.');
    error.code = 'SG-RAG-MANAGER-VALIDATION-001';
    error.validation = validation;
    throw error;
  }

  const { db } = await getDb();
  const targetVersionRef = versionRef(db, safeVersion);
  const existingVersion = await targetVersionRef.get();
  if (existingVersion.exists) {
    const error = new Error(`이미 존재하는 RAG version입니다: ${safeVersion}`);
    error.code = 'SG-RAG-MANAGER-VERSION-002';
    throw error;
  }

  const activeVersion = await getActiveRagVersion(db);
  const baseItems = activeVersion
    ? await loadVersionDocuments(db, activeVersion)
    : await loadLegacyDocuments(db);

  const previousByChunkId = new Map(
    baseItems.map((item) => [cleanText(item.data?.chunkId, 180) || item.id, item.data])
  );

  const nextChunkIds = new Set(validation.documents.map((item) => item.chunkId));
  const deleted = [...previousByChunkId.keys()].filter((chunkId) => !nextChunkIds.has(chunkId));

  const counts = {
    total: validation.documents.length,
    unchanged: 0,
    metadataModified: 0,
    embeddingModified: 0,
    added: 0,
    deleted: deleted.length
  };

  const diffPreview = [];
  const operations = [];
  let embeddingRequired = 0;
  const createdAt = nowIso();

  for (const document of validation.documents) {
    const previous = previousByChunkId.get(document.chunkId) || null;
    const diffState = classifyDiff(document, previous);

    if (diffState === DIFF_STATE.UNCHANGED) counts.unchanged += 1;
    if (diffState === DIFF_STATE.METADATA_MODIFIED) counts.metadataModified += 1;
    if (diffState === DIFF_STATE.EMBEDDING_INPUT_MODIFIED) counts.embeddingModified += 1;
    if (diffState === DIFF_STATE.ADDED) counts.added += 1;

    const reuseVector =
      (diffState === DIFF_STATE.UNCHANGED || diffState === DIFF_STATE.METADATA_MODIFIED) &&
      embeddingReusable(previous);

    if (!reuseVector) embeddingRequired += 1;

    const storedEmbedding = reuseVector
      ? { ...previous.embedding }
      : {
          provider: null,
          model: DEFAULT_EMBEDDING_MODEL,
          dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
          embeddedAt: null
        };

    const stored = {
      ...document,
      embedding: storedEmbedding,
      ragVersion: safeVersion,
      knowledgeLayer: document.knowledgeLayer || 'myeongri',
      documentHash: document.documentHash,
      embeddingHash: document.embeddingHash,
      managerMeta: {
        managerVersion: RAG_MANAGER_VERSION,
        diffState,
        baseVersion: activeVersion || 'legacy',
        needsEmbedding: !reuseVector,
        embeddingStatus: reuseVector ? 'reused' : 'pending',
        processingStartedAt: null,
        lastEmbeddingError: null,
        createdAt,
        updatedAt: createdAt
      },
      createdAt: document.createdAt || createdAt,
      updatedAt: createdAt
    };

    if (reuseVector) {
      stored.embeddingVector = previous.embeddingVector;
    }

    operations.push({
      type: 'set',
      ref: db.collection(DEFAULT_RAG_COLLECTION).doc(chunkDocId(safeVersion, document.chunkId)),
      data: stored,
      options: { merge: false }
    });

    if (diffState !== DIFF_STATE.UNCHANGED && diffPreview.length < 100) {
      diffPreview.push({
        chunkId: document.chunkId,
        title: document.title,
        knowledgeLayer: document.knowledgeLayer,
        diffState,
        previousTitle: previous?.title || null
      });
    }
  }

  const initialStatus = embeddingRequired > 0
    ? VERSION_STATUS.EMBEDDING
    : VERSION_STATUS.READY;

  await targetVersionRef.set({
    managerVersion: RAG_MANAGER_VERSION,
    version: safeVersion,
    status: VERSION_STATUS.PREPARING,
    baseVersion: activeVersion || 'legacy',
    sourceFileName: cleanText(sourceFileName, 300) || null,
    createdBy: adminUid || null,
    createdAt,
    updatedAt: createdAt,
    counts,
    knowledgeLayers: validation.summary.knowledgeLayers,
    embedding: {
      model: DEFAULT_EMBEDDING_MODEL,
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
      required: embeddingRequired,
      completed: 0,
      failed: 0,
      pending: embeddingRequired
    },
    deletedChunkIdsPreview: deleted.slice(0, 100),
    diffPreview,
    validationWarnings: validation.warnings.slice(0, 100)
  });

  try {
    await commitInBatches(db, operations);
    await targetVersionRef.update({
      status: initialStatus,
      updatedAt: nowIso()
    });
  } catch (error) {
    await targetVersionRef.update({
      status: VERSION_STATUS.FAILED,
      updatedAt: nowIso(),
      lastError: cleanText(error.message, 2000)
    });
    throw error;
  }

  return getVersionDetail(safeVersion, db);
}

function processingIsStale(meta) {
  if (meta?.embeddingStatus !== 'processing') return false;
  const started = Date.parse(meta?.processingStartedAt || '');
  return !Number.isFinite(started) || (Date.now() - started > STALE_PROCESSING_MS);
}

async function summarizeEmbeddingProgress(db, version) {
  const items = await loadVersionDocuments(db, version);
  let completed = 0;
  let failed = 0;
  let pending = 0;
  let required = 0;

  for (const item of items) {
    const meta = item.data?.managerMeta || {};
    const state = meta.embeddingStatus;
    if (meta.needsEmbedding === true || ['done', 'failed', 'pending', 'processing'].includes(state)) {
      required += 1;
    }
    if (state === 'done') completed += 1;
    if (state === 'failed') failed += 1;
    if (state === 'pending' || state === 'processing') pending += 1;
  }

  return { totalChunks: items.length, required, completed, failed, pending };
}

export async function embedDraftBatch({ version, batchSize = DEFAULT_EMBED_BATCH_SIZE }) {
  const safeVersion = safeVersionId(version);
  const size = Math.min(
    Math.max(1, Number(batchSize) || DEFAULT_EMBED_BATCH_SIZE),
    MAX_EMBED_BATCH_SIZE
  );

  const { db } = await getDb();
  const ref = versionRef(db, safeVersion);
  const versionSnapshot = await ref.get();
  if (!versionSnapshot.exists) {
    throw Object.assign(new Error(`RAG version을 찾을 수 없습니다: ${safeVersion}`), {
      code: 'SG-RAG-MANAGER-VERSION-003'
    });
  }

  const versionData = versionSnapshot.data();
  if ([VERSION_STATUS.PRODUCTION, VERSION_STATUS.ARCHIVED].includes(versionData?.status)) {
    throw Object.assign(new Error('Production/Archived 버전에는 embedding 작업을 실행할 수 없습니다.'), {
      code: 'SG-RAG-MANAGER-EMBED-001'
    });
  }

  const items = await loadVersionDocuments(db, safeVersion);
  // Process fresh pending/stale work first. Failed chunks are retried only after
  // the remaining corpus has progressed, so one bad chunk cannot block the job.
  const pendingCandidates = items.filter((item) => {
    const meta = item.data?.managerMeta || {};
    return meta.embeddingStatus === 'pending' || processingIsStale(meta);
  });
  const failedCandidates = items.filter((item) =>
    item.data?.managerMeta?.embeddingStatus === 'failed'
  );
  const candidates = [...pendingCandidates, ...failedCandidates].slice(0, size);

  if (candidates.length === 0) {
    const progress = await summarizeEmbeddingProgress(db, safeVersion);
    const ready = progress.pending === 0 && progress.failed === 0;
    await ref.update({
      status: ready ? VERSION_STATUS.READY : VERSION_STATUS.EMBEDDING,
      embedding: {
        ...(versionData?.embedding || {}),
        required: progress.required,
        completed: progress.completed,
        failed: progress.failed,
        pending: progress.pending
      },
      updatedAt: nowIso()
    });
    return getVersionDetail(safeVersion, db);
  }

  const processingAt = nowIso();
  await commitInBatches(db, candidates.map((item) => ({
    type: 'update',
    ref: item.ref,
    data: {
      'managerMeta.embeddingStatus': 'processing',
      'managerMeta.processingStartedAt': processingAt,
      'managerMeta.updatedAt': processingAt,
      'managerMeta.lastEmbeddingError': null
    }
  })));

  try {
    const sourceDocuments = candidates.map((item) => {
      const data = { ...item.data };
      delete data.embeddingVector;
      return data;
    });

    const embedded = await attachEmbeddingsToRagDocuments(sourceDocuments, {
      model: DEFAULT_EMBEDDING_MODEL,
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
      batchSize: Math.min(size, 16)
    });

    const completedAt = nowIso();
    const operations = embedded.map((document, index) => {
      const vector = document?.embedding?.vector;
      if (!Array.isArray(vector) || vector.length !== Number(DEFAULT_EMBEDDING_DIMENSIONS)) {
        throw new Error(`Embedding vector 크기 오류: ${candidates[index].data?.chunkId}`);
      }

      const safeEmbedding = { ...document.embedding };
      delete safeEmbedding.vector;

      return {
        type: 'update',
        ref: candidates[index].ref,
        data: {
          embedding: safeEmbedding,
          embeddingVector: FieldValue.vector(vector),
          'managerMeta.needsEmbedding': false,
          'managerMeta.embeddingStatus': 'done',
          'managerMeta.processingStartedAt': null,
          'managerMeta.lastEmbeddingError': null,
          'managerMeta.updatedAt': completedAt,
          updatedAt: completedAt
        }
      };
    });

    await commitInBatches(db, operations);
  } catch (error) {
    const failedAt = nowIso();
    await commitInBatches(db, candidates.map((item) => ({
      type: 'update',
      ref: item.ref,
      data: {
        'managerMeta.embeddingStatus': 'failed',
        'managerMeta.processingStartedAt': null,
        'managerMeta.lastEmbeddingError': cleanText(error.message, 2000),
        'managerMeta.updatedAt': failedAt
      }
    })));
  }

  const progress = await summarizeEmbeddingProgress(db, safeVersion);
  const ready = progress.pending === 0 && progress.failed === 0;
  await ref.update({
    status: ready ? VERSION_STATUS.READY : VERSION_STATUS.EMBEDDING,
    embedding: {
      ...(versionData?.embedding || {}),
      required: progress.required,
      completed: progress.completed,
      failed: progress.failed,
      pending: progress.pending
    },
    updatedAt: nowIso()
  });

  return getVersionDetail(safeVersion, db);
}

export async function getVersionDetail(version, injectedDb = null) {
  const safeVersion = safeVersionId(version);
  const db = injectedDb || (await getDb()).db;
  const snapshot = await versionRef(db, safeVersion).get();
  if (!snapshot.exists) return null;
  return { id: snapshot.id, ...snapshot.data() };
}

export async function listRagVersions({ limit = 30 } = {}) {
  const { db } = await getDb();
  const snapshot = await db
    .collection(RAG_VERSION_COLLECTION)
    .orderBy('createdAt', 'desc')
    .limit(Math.min(Math.max(1, Number(limit) || 30), 100))
    .get();

  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function getManagerStatus() {
  const { db, auth } = await getDb();
  const activeRagVersion = await getActiveRagVersion(db);
  const versions = await listRagVersions({ limit: 20 });

  let legacyCount = null;
  if (!activeRagVersion) {
    legacyCount = (await loadLegacyDocuments(db)).length;
  }

  return {
    managerVersion: RAG_MANAGER_VERSION,
    activeRagVersion,
    legacyMode: !activeRagVersion,
    legacyCount,
    firestore: {
      projectId: auth.projectId,
      authMode: auth.mode,
      collection: DEFAULT_RAG_COLLECTION
    },
    embedding: {
      model: DEFAULT_EMBEDDING_MODEL,
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS
    },
    versions
  };
}

export async function promoteRagVersion({ version, adminUid = null }) {
  const safeVersion = safeVersionId(version);
  const { db } = await getDb();
  const targetRef = versionRef(db, safeVersion);

  await db.runTransaction(async (transaction) => {
    const runtime = runtimeRef(db);
    const [targetSnapshot, runtimeSnapshot] = await Promise.all([
      transaction.get(targetRef),
      transaction.get(runtime)
    ]);

    if (!targetSnapshot.exists) {
      throw new Error(`RAG version을 찾을 수 없습니다: ${safeVersion}`);
    }

    const target = targetSnapshot.data();
    if (![VERSION_STATUS.READY, VERSION_STATUS.ARCHIVED, VERSION_STATUS.PRODUCTION].includes(target?.status)) {
      throw new Error(`READY 상태의 버전만 Production으로 전환할 수 있습니다. 현재=${target?.status}`);
    }

    const previous = cleanText(runtimeSnapshot.data()?.activeRagVersion, 120) || null;
    const switchedAt = nowIso();

    transaction.set(runtime, {
      activeRagVersion: safeVersion,
      previousRagVersion: previous,
      promotedAt: switchedAt,
      promotedBy: adminUid || null,
      managerVersion: RAG_MANAGER_VERSION
    }, { merge: true });

    transaction.update(targetRef, {
      status: VERSION_STATUS.PRODUCTION,
      promotedAt: switchedAt,
      promotedBy: adminUid || null,
      updatedAt: switchedAt
    });

    if (previous && previous !== safeVersion) {
      transaction.update(versionRef(db, previous), {
        status: VERSION_STATUS.ARCHIVED,
        archivedAt: switchedAt,
        updatedAt: switchedAt
      });
    }
  });

  return getManagerStatus();
}

export async function rollbackRagVersion({ version, adminUid = null }) {
  return promoteRagVersion({ version, adminUid });
}

export async function quickVectorSearch({
  version,
  query,
  knowledgeLayer = null,
  limit = 5
}) {
  const text = cleanText(query, 5000);
  if (!text) throw new Error('검색 질문을 입력해 주세요.');

  const { db } = await getDb();
  const resolvedVersion = safeVersionId(version || await getActiveRagVersion(db));
  const versionDetail = await getVersionDetail(resolvedVersion, db);
  if (
    !versionDetail ||
    ![VERSION_STATUS.READY, VERSION_STATUS.PRODUCTION, VERSION_STATUS.ARCHIVED].includes(versionDetail.status)
  ) {
    throw new Error(
      `검색 테스트는 READY/PRODUCTION/ARCHIVED 버전에서만 가능합니다. 현재=${versionDetail?.status || 'NOT_FOUND'}`
    );
  }

  const queryEmbedding = await embedQuery(text, {
    model: DEFAULT_EMBEDDING_MODEL,
    dimensions: DEFAULT_EMBEDDING_DIMENSIONS
  });

  let baseQuery = db
    .collection(DEFAULT_RAG_COLLECTION)
    .where('ragVersion', '==', resolvedVersion);

  if (knowledgeLayer && knowledgeLayer !== 'all') {
    baseQuery = baseQuery.where('knowledgeLayer', '==', normalizeKnowledgeLayer(knowledgeLayer));
  }

  const vectorQuery = baseQuery.findNearest({
    vectorField: DEFAULT_VECTOR_FIELD,
    queryVector: queryEmbedding.vector,
    limit: Math.min(Math.max(1, Number(limit) || 5), 20),
    distanceMeasure: DEFAULT_DISTANCE_MEASURE,
    distanceResultField: '__vectorDistance'
  });

  const snapshot = await vectorQuery.get();
  const results = [];

  snapshot.forEach((doc) => {
    const data = doc.data();
    const distance = Number(data.__vectorDistance);
    results.push({
      id: doc.id,
      chunkId: data.chunkId || doc.id,
      title: data.title || '',
      content: data.content || '',
      domain: data.domain || null,
      cycleType: data.cycleType || null,
      factType: data.factType || null,
      knowledgeLayer: data.knowledgeLayer || 'myeongri',
      vectorDistance: Number.isFinite(distance) ? Number(distance.toFixed(8)) : null,
      semanticScore: Number.isFinite(distance)
        ? Number(Math.max(0, Math.min(1, 1 - distance / 2)).toFixed(6))
        : null
    });
  });

  return {
    mode: 'quick',
    version: resolvedVersion,
    knowledgeLayer: knowledgeLayer || 'all',
    query: text,
    results
  };
}

export { VERSION_STATUS, DIFF_STATE };

export default Object.freeze({
  validateJsonlCorpus,
  createDraftVersion,
  embedDraftBatch,
  getManagerStatus,
  getActiveRagVersion,
  getVersionDetail,
  listRagVersions,
  promoteRagVersion,
  rollbackRagVersion,
  quickVectorSearch,
  documentHashFor,
  embeddingHashFor
});
