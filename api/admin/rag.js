// api/admin/rag.js
// Authenticated SajuGrap RAG Manager API.

import {
  requireRagAdmin
} from '../../lib/ragAdminAuth.js';

import {
  createDraftVersion,
  embedDraftBatch,
  getManagerStatus,
  getVersionDetail,
  listRagVersions,
  promoteRagVersion,
  quickVectorSearch,
  rollbackRagVersion,
  validateJsonlCorpus
} from '../../lib/ragManagerCore.js';

import {
  retrieveRagForEngineFacts
} from '../../lib/ragRetriever.js';

import chatHandler from '../chat.js';

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function send(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(payload);
}

function createMockResponse() {
  let statusCode = 200;
  let jsonBody = null;
  const headers = {};

  const res = {
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
      return this;
    },
    status(code) {
      statusCode = Number(code) || 500;
      return this;
    },
    json(value) {
      jsonBody = value;
      return this;
    },
    end() {
      return this;
    }
  };

  return {
    res,
    snapshot() {
      return { statusCode, jsonBody, headers };
    }
  };
}

function normalizeCycle(value) {
  const cycle = String(value || '').trim();
  return cycle || '대운';
}

function normalizeDomain(value) {
  const domain = String(value || '').trim();
  return domain || 'all';
}


async function assertTestableVersion(version) {
  const detail = await getVersionDetail(version);
  if (!detail) {
    throw new Error(`RAG version을 찾을 수 없습니다: ${version || '(empty)'}`);
  }
  if (!['READY', 'PRODUCTION', 'ARCHIVED'].includes(detail.status)) {
    throw new Error(
      `테스트는 READY/PRODUCTION/ARCHIVED 버전에서만 가능합니다. 현재=${detail.status}`
    );
  }
  return detail;
}

async function runRealRetrieval(body) {
  await assertTestableVersion(body.version);
  const engineFacts = body.engineFacts;
  if (!engineFacts || typeof engineFacts !== 'object') {
    throw new Error('Real App Test에는 engineFacts JSON이 필요합니다.');
  }

  const userQuery = String(body.query || body.userMessage || '').trim();
  if (!userQuery) {
    throw new Error('검색 질문을 입력해 주세요.');
  }

  return retrieveRagForEngineFacts(engineFacts, {
    domain: normalizeDomain(body.domain),
    cycleType: body.cycleType || null,
    cycleIndex: Number.isInteger(body.cycleIndex) ? body.cycleIndex : null,
    userQuery,
    ragVersion: body.version || null,
    targetResults: Number(body.limit || 6),
    maximumResults: Number(body.limit || 6),
    candidateLimit: Number(body.candidateLimit || 100)
  });
}

async function runLlmTest(body) {
  await assertTestableVersion(body.version);
  const engineFacts = body.engineFacts;
  if (!engineFacts || typeof engineFacts !== 'object') {
    throw new Error('LLM Test에는 engineFacts JSON이 필요합니다.');
  }

  const userMessage = String(body.query || body.userMessage || '').trim();
  if (!userMessage) {
    throw new Error('LLM 테스트 질문을 입력해 주세요.');
  }

  const provider = String(body.provider || 'gemini').trim().toLowerCase();
  if (!['gemini', 'openai'].includes(provider)) {
    throw new Error('provider는 gemini 또는 openai여야 합니다.');
  }

  const mock = createMockResponse();
  const req = {
    method: 'POST',
    headers: {},
    body: {
      mode: 'chat',
      provider,
      role: '',
      domain: normalizeDomain(body.domain),
      cycle: normalizeCycle(body.cycle),
      score: 0,
      cycleScores: null,
      cycleIndex: Number.isInteger(body.cycleIndex) ? body.cycleIndex : null,
      sajuContext: {
        name: 'RAG Manager Test',
        engineFacts
      },
      userMessage,
      history: []
    }
  };

  await chatHandler(req, mock.res, {
    ragVersion: body.version || null,
    knowledgeLayer: body.knowledgeLayer && body.knowledgeLayer !== 'all'
      ? body.knowledgeLayer
      : null
  });

  return mock.snapshot();
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!['GET', 'POST'].includes(req.method)) {
    return send(res, 405, {
      success: false,
      error: { code: 'SG-RAG-ADMIN-405', message: 'GET/POST만 허용됩니다.' }
    });
  }

  let admin;
  try {
    admin = await requireRagAdmin(req);
  } catch (error) {
    return send(res, error.httpStatus || 401, {
      success: false,
      error: {
        code: error.code || 'SG-RAG-ADMIN-AUTH-999',
        message: error.message
      }
    });
  }

  const body = parseBody(req.body);
  const action = String(
    body.action || req.query?.action || (req.method === 'GET' ? 'status' : '')
  ).trim();

  try {
    let data;

    switch (action) {
      case 'status':
        data = await getManagerStatus();
        break;

      case 'versions':
        data = await listRagVersions({ limit: body.limit || 30 });
        break;

      case 'version':
        data = await getVersionDetail(body.version);
        break;

      case 'validate': {
        const validation = validateJsonlCorpus(body.jsonlText || '');
        data = {
          valid: validation.valid,
          summary: validation.summary,
          errors: validation.errors.slice(0, 100),
          warnings: validation.warnings.slice(0, 100)
        };
        break;
      }

      case 'createDraft':
        data = await createDraftVersion({
          version: body.version,
          jsonlText: body.jsonlText || '',
          sourceFileName: body.sourceFileName || null,
          adminUid: admin.uid
        });
        break;

      case 'embedBatch':
        data = await embedDraftBatch({
          version: body.version,
          batchSize: body.batchSize
        });
        break;

      case 'quickSearch':
        data = await quickVectorSearch({
          version: body.version,
          query: body.query,
          knowledgeLayer: body.knowledgeLayer || null,
          limit: body.limit || 5
        });
        break;

      case 'realRetrieval':
        data = await runRealRetrieval(body);
        break;

      case 'llmTest':
        data = await runLlmTest(body);
        break;

      case 'promote':
        data = await promoteRagVersion({
          version: body.version,
          adminUid: admin.uid
        });
        break;

      case 'rollback':
        data = await rollbackRagVersion({
          version: body.version,
          adminUid: admin.uid
        });
        break;

      default:
        return send(res, 400, {
          success: false,
          error: {
            code: 'SG-RAG-ADMIN-ACTION-001',
            message: `지원하지 않는 action입니다: ${action || '(empty)'}`
          }
        });
    }

    return send(res, 200, {
      success: true,
      admin: {
        uid: admin.uid,
        email: admin.email
      },
      data
    });
  } catch (error) {
    const validation = error?.validation
      ? {
          valid: error.validation.valid,
          summary: error.validation.summary,
          errors: error.validation.errors.slice(0, 100),
          warnings: error.validation.warnings.slice(0, 100)
        }
      : null;

    return send(res, 500, {
      success: false,
      error: {
        code: error.code || 'SG-RAG-ADMIN-500',
        message: error.message || 'RAG Manager 처리 중 오류가 발생했습니다.',
        detail: error.detail || null,
        validation
      }
    });
  }
}
