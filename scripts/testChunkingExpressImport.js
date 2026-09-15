import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createChunkingExpressInactiveChunk,
  validateChunkingExpressInactiveDraft
} from '../lib/chunkingExpressImport.js';

const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

function draft() {
  const content = '사주 해석 지식의 연결 시험 내용이다.';
  return {
    schemaVersion: 'rag_document_v1',
    schemaImplementationVersion: '1.0.0',
    chunkId: 'a'.repeat(64),
    corpus: 'production',
    status: 'inactive',
    locale: 'ko-KR',
    source: {
      sourceId: 'source-1',
      sourceVersion: '1.0',
      title: '연결 시험 원문',
      sourceType: 'chunking_express_v1',
      sourceUri: 'https://example.com/source',
      section: '시험',
      subsection: '시험',
      pageStart: 1,
      pageEnd: 1
    },
    title: '연결 시험',
    content,
    domain: 'all',
    cycleType: 'shared',
    factType: 'general',
    metadata: { keywords: ['chunking-express-v1'], aliases: ['unit-1'] },
    interpretationPolicy: {
      factMeaning: false,
      strengthStateMeaning: false,
      combinationMeaning: false,
      timeAxisMeaning: false,
      actionStrategy: false,
      domainStrategy: false,
      prohibitedInterpretation: false,
      uncertaintyExpression: false,
      mayRecalculateEngineFacts: false,
      mayOverrideEngineFacts: false,
      mayInferMissingEngineFacts: false
    },
    chunking: {
      strategy: 'chunking_express_v1',
      chunkIndex: 0,
      chunkTotal: 1,
      estimatedTokens: 120,
      overlapGroup: 'unit-1'
    },
    embeddingText: content,
    reviewedManifest: {
      knowledgeId: 'unit-1',
      documentId: 'source-1',
      documentName: '연결 시험 원문',
      category: 'symbolic',
      priority: 50,
      chunkMode: 'semantic',
      sourceBasis: 'chunking_express_v1',
      sourcePdf: 'https://example.com/source',
      sourcePage: 1,
      version: '1.0',
      embeddingDimension: 768,
      embeddingModel: 'gemini-embedding-2',
      relatedKnowledgeIds: [],
      charCount: content.length,
      contentHash: sha256(content),
      isActive: false,
      isNegative: false,
      retrievalAllowed: false,
      interpretationLayer: null,
      importedFromRow: 1
    }
  };
}

function fakeFirestore(initial = null) {
  let value = initial;
  const calls = [];
  return {
    calls,
    collection(name) {
      calls.push(`collection:${name}`);
      return {
        doc(id) {
          calls.push(`doc:${id}`);
          return {
            async get() {
              calls.push('get');
              return { exists: value !== null, id, data: () => value };
            },
            async create(next) {
              calls.push('create');
              if (value !== null) throw Object.assign(new Error('exists'), { code: 6 });
              value = next;
            }
          };
        }
      };
    }
  };
}

const vector = Array.from({ length: 768 }, (_, index) => (index + 1) / 768);
const vectorValue = (values) => ({ toArray: () => [...values] });
const embedDocuments = async (documents) =>
  documents.map((document) => ({
    ...document,
    embedding: {
      provider: 'gemini',
      model: 'gemini-embedding-2',
      dimensions: 768,
      vector,
      embeddedAt: 'ignored'
    }
  }));

assert.equal(validateChunkingExpressInactiveDraft(draft()).status, 'inactive');

{
  const firestore = fakeFirestore();
  const result = await createChunkingExpressInactiveChunk(draft(), {
    firestore,
    firestoreAuth: { projectId: 'saju-grap' },
    embedDocuments,
    vectorValue,
    now: () => '2026-09-15T10:00:00.000Z'
  });
  assert.deepEqual(result, {
    created: true,
    verified: true,
    documentId: 'a'.repeat(64),
    status: 'inactive',
    provider: 'gemini',
    model: 'gemini-embedding-2',
    dimensions: 768,
    storedAt: '2026-09-15T10:00:00.000Z'
  });
  assert.equal(firestore.calls.filter((call) => call === 'create').length, 1);
  assert.equal(firestore.calls.filter((call) => call === 'get').length, 2);
}

{
  const firestore = fakeFirestore();
  let embeds = 0;
  await createChunkingExpressInactiveChunk(draft(), {
    firestore,
    firestoreAuth: { projectId: 'saju-grap' },
    embedDocuments,
    vectorValue,
    now: () => '2026-09-15T10:00:00.000Z'
  });
  const result = await createChunkingExpressInactiveChunk(draft(), {
    firestore,
    firestoreAuth: { projectId: 'saju-grap' },
    embedDocuments: async (documents) => {
      embeds += 1;
      return embedDocuments(documents);
    },
    vectorValue,
    now: () => '2026-09-15T11:00:00.000Z'
  });
  assert.equal(result.created, false);
  assert.equal(result.verified, true);
  assert.equal(embeds, 0);
}

{
  const original = draft();
  const firestore = fakeFirestore();
  await createChunkingExpressInactiveChunk(original, {
    firestore,
    firestoreAuth: { projectId: 'saju-grap' },
    embedDocuments,
    vectorValue,
    now: () => '2026-09-15T10:00:00.000Z'
  });
  await assert.rejects(
    () =>
      createChunkingExpressInactiveChunk(
        { ...original, title: '같은 ID에 다른 제목' },
        {
          firestore,
          firestoreAuth: { projectId: 'saju-grap' },
          embedDocuments,
          vectorValue
        }
      ),
    /내용 또는 벡터가 다릅니다/
  );
}

assert.throws(
  () => validateChunkingExpressInactiveDraft({ ...draft(), status: 'active' }),
  /비활성 청크 계약/
);
await assert.rejects(
  () =>
    createChunkingExpressInactiveChunk(draft(), {
      firestore: fakeFirestore(),
      firestoreAuth: { projectId: 'wrong-project' },
      embedDocuments,
      vectorValue
    }),
  /saju-grap 프로젝트/
);

console.log('ChunkingExpress inactive import tests passed');
