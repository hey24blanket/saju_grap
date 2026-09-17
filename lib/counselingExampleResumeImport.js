import {
  COUNSELING_EXAMPLE_COLLECTION,
  importCounselingExampleBatch,
  validateGoldenCounselingExamples
} from './counselingExampleStore.js';
import { getFirestoreClient } from './ragRetriever.js';

function fail(code, message, httpStatus = 400, detail = null) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  error.detail = detail;
  throw error;
}

export async function importCounselingExampleBatchResumable({
  rows,
  sourceFileName = null,
  adminUid = null
} = {}) {
  const input = Array.isArray(rows) ? rows : [];
  const validation = validateGoldenCounselingExamples(input);
  if (!validation.valid) {
    fail(
      'SG-CE-EXAMPLE-RESUME-001',
      '상담 Golden Dataset 검증에 실패했습니다.',
      400,
      validation.errors.slice(0, 20)
    );
  }

  const connection = await getFirestoreClient();
  if (connection.auth?.projectId && connection.auth.projectId !== 'saju-grap') {
    fail('SG-CE-EXAMPLE-RESUME-002', '상담 예시는 saju-grap Firestore에만 저장할 수 있습니다.', 503);
  }

  const db = connection.db;
  const refs = validation.normalized.map((item) =>
    db.collection(COUNSELING_EXAMPLE_COLLECTION).doc(item.exampleId)
  );
  const snapshots = await Promise.all(refs.map((ref) => ref.get()));

  const changedRows = [];
  const unchangedIds = [];

  snapshots.forEach((snapshot, index) => {
    const normalized = validation.normalized[index];
    const existing = snapshot.exists ? snapshot.data() : null;
    if (existing?.contentHash === normalized.contentHash) {
      unchangedIds.push(normalized.exampleId);
    } else {
      changedRows.push(input[index]);
    }
  });

  if (!changedRows.length) {
    return {
      collection: COUNSELING_EXAMPLE_COLLECTION,
      total: input.length,
      created: 0,
      updated: 0,
      unchanged: unchangedIds.length,
      ids: validation.normalized.map((item) => item.exampleId),
      status: 'unchanged',
      retrievalAllowed: false
    };
  }

  const result = await importCounselingExampleBatch({
    rows: changedRows,
    sourceFileName,
    adminUid
  });

  return {
    ...result,
    total: input.length,
    unchanged: Number(result.unchanged || 0) + unchangedIds.length,
    ids: validation.normalized.map((item) => item.exampleId)
  };
}

export default importCounselingExampleBatchResumable;
