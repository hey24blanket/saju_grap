import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { FieldValue } from '@google-cloud/firestore';
import { attachEmbeddingsToRagDocuments } from './embeddingProvider.js';
import { validateRagDocument } from './ragDocumentSchema.js';
import { DEFAULT_RAG_COLLECTION, getFirestoreClient } from './ragRetriever.js';

export const CHUNKING_EXPRESS_PROJECT_ID = 'saju-grap';
export const CHUNKING_EXPRESS_DATABASE_ID = '(default)';
export const CHUNKING_EXPRESS_COLLECTION = 'sajugrap_rag_chunks';
export const CHUNKING_EXPRESS_EMBEDDING_MODEL = 'gemini-embedding-2';
export const CHUNKING_EXPRESS_EMBEDDING_DIMENSIONS = 768;

const INPUT_KEYS = [
  'chunkId',
  'chunking',
  'content',
  'corpus',
  'cycleType',
  'domain',
  'embeddingText',
  'factType',
  'interpretationPolicy',
  'locale',
  'metadata',
  'reviewedManifest',
  'schemaImplementationVersion',
  'schemaVersion',
  'source',
  'status',
  'title'
].sort();

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function fail(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = status;
  throw error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return isPlainObject(value) &&
    Object.keys(value).sort().length === keys.length &&
    Object.keys(value).sort().every((key, index) => key === keys[index]);
}

function finiteVector(value) {
  return Array.isArray(value) &&
    value.length === CHUNKING_EXPRESS_EMBEDDING_DIMENSIONS &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function decodeVector(value) {
  if (!value || typeof value !== 'object' || typeof value.toArray !== 'function') return null;
  try {
    return value.toArray();
  } catch {
    return null;
  }
}

export function validateChunkingExpressInactiveDraft(input) {
  if (!exactKeys(input, INPUT_KEYS))
    fail('SG-CE-INPUT-001', 'ChunkingExpress 청크 필드 구성이 올바르지 않습니다.');
  if (
    input.schemaVersion !== 'rag_document_v1' ||
    input.schemaImplementationVersion !== '1.0.0' ||
    input.corpus !== 'production' ||
    input.status !== 'inactive' ||
    input.locale !== 'ko-KR' ||
    !/^[a-f0-9]{64}$/.test(String(input.chunkId || ''))
  )
    fail('SG-CE-INPUT-002', 'ChunkingExpress 비활성 청크 계약이 올바르지 않습니다.');
  if (
    !isPlainObject(input.source) ||
    !/^chunking_express_v[12]$/.test(String(input.source.sourceType || '')) ||
    !isPlainObject(input.reviewedManifest) ||
    input.reviewedManifest.sourceBasis !== input.source.sourceType ||
    input.reviewedManifest.contentHash !== sha256(input.content) ||
    input.reviewedManifest.charCount !== String(input.content).length ||
    input.reviewedManifest.embeddingModel !== CHUNKING_EXPRESS_EMBEDDING_MODEL ||
    input.reviewedManifest.embeddingDimension !== CHUNKING_EXPRESS_EMBEDDING_DIMENSIONS ||
    input.reviewedManifest.isActive !== false ||
    input.reviewedManifest.isNegative !== false ||
    input.reviewedManifest.retrievalAllowed !== false
  )
    fail('SG-CE-INPUT-003', 'ChunkingExpress 출처·검토 명세가 올바르지 않습니다.');
  if (
    !isPlainObject(input.interpretationPolicy) ||
    Object.values(input.interpretationPolicy).some((value) => value !== false)
  )
    fail('SG-CE-INPUT-004', '연결 청크는 해석 엔진 권한을 가질 수 없습니다.');
  const validation = validateRagDocument(input);
  if (!validation.valid)
    fail(
      'SG-CE-INPUT-005',
      `SajuGrap 문서 검증 실패: ${validation.errors.map((item) => item.field).join(', ')}`
    );
  return structuredClone(input);
}

function verifyStoredInactiveChunk(snapshot, draft) {
  if (!snapshot?.exists) fail('SG-CE-VERIFY-001', '저장 후 청크를 다시 찾지 못했습니다.', 503);
  const stored = snapshot.data();
  const vector = decodeVector(stored?.embeddingVector);
  const storedDraft = Object.fromEntries(INPUT_KEYS.map((key) => [key, stored?.[key]]));
  if (
    !isPlainObject(stored) ||
    !isDeepStrictEqual(storedDraft, draft) ||
    stored.status !== 'inactive' ||
    stored.reviewedManifest?.retrievalAllowed !== false ||
    stored.embedding?.provider !== 'gemini' ||
    stored.embedding?.model !== CHUNKING_EXPRESS_EMBEDDING_MODEL ||
    stored.embedding?.dimensions !== CHUNKING_EXPRESS_EMBEDDING_DIMENSIONS ||
    stored.embeddingBuild?.inputHash !== sha256(draft.embeddingText) ||
    !finiteVector(vector)
  )
    fail('SG-CE-VERIFY-002', '저장된 ChunkingExpress 청크의 내용 또는 벡터가 다릅니다.', 409);
  return {
    documentId: snapshot.id,
    status: 'inactive',
    provider: 'gemini',
    model: CHUNKING_EXPRESS_EMBEDDING_MODEL,
    dimensions: CHUNKING_EXPRESS_EMBEDDING_DIMENSIONS,
    storedAt: stored.createdAt
  };
}

export async function createChunkingExpressInactiveChunk(
  input,
  {
    firestore = null,
    firestoreAuth = null,
    embedDocuments = attachEmbeddingsToRagDocuments,
    vectorValue = (values) => FieldValue.vector(values),
    now = () => new Date().toISOString()
  } = {}
) {
  const draft = validateChunkingExpressInactiveDraft(input);
  let db = firestore;
  let auth = firestoreAuth;
  if (!db) {
    const connection = await getFirestoreClient();
    db = connection.db;
    auth = connection.auth;
  }
  if (auth?.projectId !== CHUNKING_EXPRESS_PROJECT_ID)
    fail('SG-CE-TARGET-001', 'Firestore 대상이 saju-grap 프로젝트가 아닙니다.', 503);
  if (DEFAULT_RAG_COLLECTION !== CHUNKING_EXPRESS_COLLECTION)
    fail('SG-CE-TARGET-002', 'Firestore 대상 컬렉션이 sajugrap_rag_chunks가 아닙니다.', 503);

  const reference = db.collection(DEFAULT_RAG_COLLECTION).doc(draft.chunkId);
  const existing = await reference.get();
  if (existing.exists)
    return { created: false, verified: true, ...verifyStoredInactiveChunk(existing, draft) };

  const [embedded] = await embedDocuments([draft], {
    model: CHUNKING_EXPRESS_EMBEDDING_MODEL,
    dimensions: CHUNKING_EXPRESS_EMBEDDING_DIMENSIONS,
    batchSize: 1
  });
  const vector = embedded?.embedding?.vector;
  if (!finiteVector(vector))
    fail('SG-CE-EMBED-001', 'Gemini가 올바른 768차원 벡터를 반환하지 않았습니다.', 503);
  const timestamp = now();
  const embedding = {
    provider: 'gemini',
    model: CHUNKING_EXPRESS_EMBEDDING_MODEL,
    dimensions: CHUNKING_EXPRESS_EMBEDDING_DIMENSIONS,
    embeddedAt: timestamp
  };
  const stored = {
    ...draft,
    embedding,
    embeddingBuild: {
      schemaVersion: 'rag_embedding_build_v1',
      scriptVersion: 'chunking-express-api-v1',
      inputField: 'embeddingText',
      inputHash: sha256(draft.embeddingText),
      ...embedding
    },
    firestoreMeta: {
      uploadedBy: 'api/admin/rag:createInactiveChunk',
      uploadScriptVersion: '1.0.0',
      uploadedAt: timestamp
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    embeddingVector: vectorValue([...vector])
  };

  let created = false;
  try {
    await reference.create(stored);
    created = true;
  } catch (error) {
    if (Number(error?.code) !== 6 && error?.code !== 'ALREADY_EXISTS') throw error;
  }
  const readBack = await reference.get();
  const verified = verifyStoredInactiveChunk(readBack, draft);
  const plainActual = { ...readBack.data() };
  delete plainActual.embeddingVector;
  const plainExpected = { ...stored };
  delete plainExpected.embeddingVector;
  if (created && !isDeepStrictEqual(plainActual, plainExpected))
    fail('SG-CE-VERIFY-003', '저장 후 전체 문서 검증에 실패했습니다.', 409);
  return { created, verified: true, ...verified };
}

export default Object.freeze({
  validateChunkingExpressInactiveDraft,
  createChunkingExpressInactiveChunk
});
