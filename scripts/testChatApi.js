#!/usr/bin/env node
// scripts/testChatApi.js
// SajuGrap /api/chat End-to-End Local Test
// -----------------------------------------------------------------------------
// 실제 흐름:
// TEST INPUT
//   -> SajuGrapEngine
//   -> Engine Facts v1
//   -> api/chat.js
//   -> ragQueryBuilder
//   -> Gemini query embedding
//   -> Firestore Vector Search
//   -> Retrieved RAG Context
//   -> Gemini/OpenAI generation
//   -> Final API response
//
// 실제 Vercel HTTP 서버를 띄우지 않고 handler(req, res)를 직접 호출한다.
// -----------------------------------------------------------------------------

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_VERSION = '1.0.0';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const DEFAULT_PROVIDER = 'gemini';

const DEFAULT_QUESTION =
  '용신과 기신을 단순한 길흉이 아니라 현재 구조의 균형과 행동 전략으로 설명해줘.';

const TEST_INPUT = Object.freeze({
  name: 'CHAT-API-E2E-TEST',
  year: 1990,
  month: 5,
  day: 17,
  hour: 10,
  minute: 30,
  second: 0,
  gender: 'male',
  calendarType: 'solar',
  timezone: 'Asia/Seoul',
  referenceDateTime: '2026-08-26T12:00:00+09:00'
});


// ============================================================================
// Helpers
// ============================================================================

function cleanText(value, maxLength = 20000) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function separator() {
  console.log(
    '------------------------------------------------------------'
  );
}


// ============================================================================
// Dependency-free .env loader
// ----------------------------------------------------------------------------
// chat.js / ragRetriever.js / embeddingProvider.js가 import 시점에 환경변수를
// 읽을 수 있으므로 반드시 dynamic import 전에 .env.local을 먼저 로드한다.
// ============================================================================

function parseEnvLine(line) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const normalized =
    trimmed.startsWith('export ')
      ? trimmed.slice(7)
      : trimmed;

  const equalIndex =
    normalized.indexOf('=');

  if (equalIndex <= 0) {
    return null;
  }

  const key =
    normalized
      .slice(0, equalIndex)
      .trim();

  let value =
    normalized
      .slice(equalIndex + 1)
      .trim();

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }

  if (
    (
      value.startsWith('"') &&
      value.endsWith('"')
    ) ||
    (
      value.startsWith("'") &&
      value.endsWith("'")
    )
  ) {
    value =
      value.slice(1, -1);
  }

  return {
    key,
    value
  };
}

async function loadEnvFile(filePath) {
  if (!(await pathExists(filePath))) {
    return false;
  }

  const text =
    await fs.readFile(
      filePath,
      'utf8'
    );

  for (const line of text.split(/\r?\n/)) {
    const parsed =
      parseEnvLine(line);

    if (!parsed) {
      continue;
    }

    if (
      process.env[parsed.key] ===
      undefined
    ) {
      process.env[parsed.key] =
        parsed.value;
    }
  }

  return true;
}

async function loadLocalEnvironment() {
  const localLoaded =
    await loadEnvFile(
      path.join(
        PROJECT_ROOT,
        '.env.local'
      )
    );

  const envLoaded =
    await loadEnvFile(
      path.join(
        PROJECT_ROOT,
        '.env'
      )
    );

  return {
    localLoaded,
    envLoaded
  };
}


// ============================================================================
// CLI
// ============================================================================

function parseArgs(argv) {
  let provider =
    DEFAULT_PROVIDER;

  let question =
    DEFAULT_QUESTION;

  let domain =
    '총운';

  let cycle =
    '대운';

  let cycleIndex =
    0;

  for (
    let index = 0;
    index < argv.length;
    index += 1
  ) {
    const arg =
      argv[index];

    if (arg === '--help') {
      console.log(`
SajuGrap Chat API E2E Test v${SCRIPT_VERSION}

Usage:
  node scripts/testChatApi.js

Options:
  --provider gemini|openai
  --question "질문"
  --domain 총운|사업운|재물운|심신운|연애운
  --cycle 대운|연운|월운|일운|시운
  --cycle-index <0 이상의 정수>

Examples:
  node scripts/testChatApi.js

  node scripts/testChatApi.js --provider gemini --question "현재 구조에서 무엇을 우선해야 해?"

  node scripts/testChatApi.js --provider openai --domain 사업운 --question "사업 전략을 설명해줘."
`);

      process.exit(0);
    }

    if (arg === '--provider') {
      const value =
        cleanText(
          argv[index + 1],
          20
        ).toLowerCase();

      if (
        ![
          'gemini',
          'openai'
        ].includes(value)
      ) {
        throw new Error(
          '--provider는 gemini 또는 openai여야 합니다.'
        );
      }

      provider =
        value;

      index += 1;
      continue;
    }

    if (arg === '--question') {
      const value =
        cleanText(
          argv[index + 1],
          5000
        );

      if (!value) {
        throw new Error(
          '--question 뒤에 질문을 입력하세요.'
        );
      }

      question =
        value;

      index += 1;
      continue;
    }

    if (arg === '--domain') {
      const value =
        cleanText(
          argv[index + 1],
          80
        );

      if (
        ![
          '총운',
          '사업운',
          '재물운',
          '심신운',
          '연애운'
        ].includes(value)
      ) {
        throw new Error(
          '지원하지 않는 --domain 값입니다.'
        );
      }

      domain =
        value;

      index += 1;
      continue;
    }

    if (arg === '--cycle') {
      const value =
        cleanText(
          argv[index + 1],
          80
        );

      if (
        ![
          '대운',
          '연운',
          '월운',
          '일운',
          '시운'
        ].includes(value)
      ) {
        throw new Error(
          '지원하지 않는 --cycle 값입니다.'
        );
      }

      cycle =
        value;

      index += 1;
      continue;
    }

    if (arg === '--cycle-index') {
      const value =
        Number(
          argv[index + 1]
        );

      if (
        !Number.isInteger(value) ||
        value < 0
      ) {
        throw new Error(
          '--cycle-index는 0 이상의 정수여야 합니다.'
        );
      }

      cycleIndex =
        value;

      index += 1;
      continue;
    }

    throw new Error(
      `알 수 없는 옵션입니다: ${arg}`
    );
  }

  return {
    provider,
    question,
    domain,
    cycle,
    cycleIndex
  };
}


// ============================================================================
// Mock Vercel req/res
// ============================================================================

function createMockResponse() {
  const headers =
    new Map();

  let statusCode =
    200;

  let jsonBody =
    null;

  let ended =
    false;

  const res = {
    setHeader(name, value) {
      headers.set(
        String(name).toLowerCase(),
        value
      );

      return res;
    },

    getHeader(name) {
      return headers.get(
        String(name).toLowerCase()
      );
    },

    status(code) {
      statusCode =
        Number(code);

      return res;
    },

    json(value) {
      jsonBody =
        value;

      ended =
        true;

      return value;
    },

    end(value = null) {
      if (
        value !== null &&
        value !== undefined
      ) {
        jsonBody =
          value;
      }

      ended =
        true;

      return value;
    }
  };

  return {
    res,

    snapshot() {
      return {
        statusCode,
        headers:
          Object.fromEntries(
            headers.entries()
          ),
        jsonBody,
        ended
      };
    }
  };
}


// ============================================================================
// Engine summary
// ============================================================================

function summarizeEngineFacts(engineFacts) {
  const useful =
    engineFacts
      ?.usefulGodProfile ||
    {};

  return {
    schemaVersion:
      engineFacts
        ?.schemaVersion ??
      null,

    engineVersion:
      engineFacts
        ?.engineVersion ??
      null,

    dayMaster:
      engineFacts
        ?.natal
        ?.dayMaster
        ?.stem ??
      engineFacts
        ?.natal
        ?.dayMaster ??
      null,

    strengthBand:
      engineFacts
        ?.strength
        ?.band ??
      null,

    dominantImbalance:
      useful
        ?.dominantImbalance ??
      null,

    yongsin:
      useful?.yongsin
        ? {
            element:
              useful
                .yongsin
                .element ??
              null,

            tenGodGroup:
              useful
                .yongsin
                .tenGodGroup ??
              null,

            mechanisms:
              Array.isArray(
                useful
                  .yongsin
                  .mechanisms
              )
                ? useful
                    .yongsin
                    .mechanisms
                : [],

            need:
              useful
                .yongsin
                .need ??
              null,

            currentAvailability:
              useful
                .yongsin
                .currentAvailability ??
              null
          }
        : null,

    detectedStars:
      Array.isArray(
        engineFacts
          ?.stars
      )
        ? engineFacts
            .stars
            .filter(
              (item) =>
                item?.detected
            )
            .map(
              (item) =>
                item.starId
            )
        : [],

    relationCount:
      Array.isArray(
        engineFacts
          ?.relations
          ?.items
      )
        ? engineFacts
            .relations
            .items
            .length
        : 0
  };
}


// ============================================================================
// Output
// ============================================================================

function printRagDiagnostic(rag) {
  if (!rag) {
    console.log(
      'rag diagnostic : MISSING'
    );

    return;
  }

  console.log(
    `rag status     : ${rag.status ?? '-'}`
  );

  console.log(
    `rag required   : ${rag.required ?? '-'}`
  );

  console.log(
    `fallback used  : ${rag.fallbackUsed ?? '-'}`
  );

  const retrieval =
    rag.retrieval ||
    {};

  const stats =
    retrieval.stats ||
    {};

  console.log(
    `rag candidates : ${stats.candidatesReturned ?? '-'}`
  );

  console.log(
    `rag returned   : ${stats.returned ?? '-'}`
  );

  console.log(
    `rag elapsed    : ${stats.elapsedMs ?? '-'} ms`
  );

  const ids =
    Array.isArray(
      retrieval.resultIds
    )
      ? retrieval.resultIds
      : [];

  console.log(
    `rag result IDs : ${
      ids.length > 0
        ? ids.join(', ')
        : '-'
    }`
  );
}


// ============================================================================
// Main
// ============================================================================

async function main() {
  const envStatus =
    await loadLocalEnvironment();

  const config =
    parseArgs(
      process.argv.slice(2)
    );

  console.log('');
  console.log(
    '============================================================'
  );

  console.log(
    ' SajuGrap /api/chat End-to-End Local Test'
  );

  console.log(
    '============================================================'
  );

  console.log(
    `env.local : ${
      envStatus.localLoaded
        ? 'FOUND'
        : 'NOT FOUND'
    }`
  );

  console.log(
    `provider  : ${config.provider}`
  );

  console.log(
    `domain    : ${config.domain}`
  );

  console.log(
    `cycle     : ${config.cycle}`
  );

  console.log(
    `cycleIndex: ${config.cycleIndex}`
  );

  console.log(
    `question  : ${config.question}`
  );

  console.log(
    '============================================================'
  );

  console.log('');

  if (
    !process.env
      .GEMINI_API_KEY
  ) {
    throw new Error(
      'GEMINI_API_KEY가 없습니다. Query embedding 때문에 반드시 필요합니다.'
    );
  }

  if (
    config.provider ===
      'openai' &&
    !process.env
      .OPENAI_API_KEY
  ) {
    throw new Error(
      'OPENAI_API_KEY가 없습니다. .env.local을 확인하세요.'
    );
  }

  // 환경변수 로딩 이후 dynamic import.
  const {
    calculateSajuGrap
  } =
    await import(
      '../src/engine/SajuGrapEngine.js'
    );

  const {
    default:
      chatHandler
  } =
    await import(
      '../api/chat.js'
    );


  // --------------------------------------------------------------------------
  // 1. Engine Facts
  // --------------------------------------------------------------------------

  console.log(
    '[1/4] Calculating Engine Facts...'
  );

  const engineFacts =
    calculateSajuGrap(
      TEST_INPUT
    );

  console.log(
    JSON.stringify(
      summarizeEngineFacts(
        engineFacts
      ),
      null,
      2
    )
  );


  // --------------------------------------------------------------------------
  // 2. Build API request
  // --------------------------------------------------------------------------

  console.log('');

  console.log(
    '[2/4] Building /api/chat request...'
  );

  const req = {
    method:
      'POST',

    body: {
      mode:
        'chat',

      provider:
        config.provider,

      role:
        '',

      domain:
        config.domain,

      cycle:
        config.cycle,

      score:
        0,

      cycleScores:
        null,

      cycleIndex:
        config.cycleIndex,

      sajuContext: {
        name:
          TEST_INPUT.name,

        engineFacts
      },

      userMessage:
        config.question,

      history:
        []
    }
  };

  console.log(
    '[OK] request ready.'
  );


  // --------------------------------------------------------------------------
  // 3. Invoke real chat handler
  // --------------------------------------------------------------------------

  console.log('');

  console.log(
    '[3/4] Calling real api/chat.js handler...'
  );

  console.log(
    '      Engine Facts -> RAG -> LLM까지 실제 호출합니다.'
  );

  const mock =
    createMockResponse();

  const startedAt =
    Date.now();

  await chatHandler(
    req,
    mock.res
  );

  const apiElapsedMs =
    Date.now() -
    startedAt;

  const response =
    mock.snapshot();


  // --------------------------------------------------------------------------
  // 4. Review
  // --------------------------------------------------------------------------

  console.log('');

  console.log(
    '[4/4] Reviewing API response...'
  );

  console.log('');

  separator();

  console.log(
    ' HTTP RESULT'
  );

  separator();

  console.log(
    `status      : ${response.statusCode}`
  );

  console.log(
    `elapsed     : ${apiElapsedMs} ms`
  );

  console.log(
    `request id  : ${
      response.headers[
        'x-sajugrap-request-id'
      ] ||
      '-'
    }`
  );

  console.log(
    `api version : ${
      response.headers[
        'x-sajugrap-api-version'
      ] ||
      '-'
    }`
  );

  const body =
    response.jsonBody;

  if (
    !body ||
    typeof body !==
      'object'
  ) {
    throw new Error(
      'api/chat.js가 JSON 객체를 반환하지 않았습니다.'
    );
  }

  if (
    !body.success
  ) {
    console.log('');

    separator();

    console.log(
      ' API ERROR'
    );

    separator();

    console.log(
      JSON.stringify(
        body,
        null,
        2
      )
    );

    process.exitCode =
      2;

    return;
  }

  console.log('');

  separator();

  console.log(
    ' RAG DIAGNOSTIC'
  );

  separator();

  printRagDiagnostic(
    body
      .diagnostic
      ?.rag
  );

  console.log('');

  separator();

  console.log(
    ' MODEL'
  );

  separator();

  console.log(
    `provider         : ${
      body
        .diagnostic
        ?.provider ??
      '-'
    }`
  );

  console.log(
    `model            : ${
      body
        .diagnostic
        ?.model ??
      '-'
    }`
  );

  console.log(
    `engineFactsStatus: ${
      body
        .diagnostic
        ?.engineFactsStatus ??
      '-'
    }`
  );

  console.log('');

  separator();

  console.log(
    ' FINAL LLM REPLY'
  );

  separator();

  console.log(
    body.reply ||
    '(empty reply)'
  );


  // --------------------------------------------------------------------------
  // Assertions
  // --------------------------------------------------------------------------

  const errors =
    [];

  if (
    body
      .diagnostic
      ?.engineFactsStatus !==
    'engine_facts_v1'
  ) {
    errors.push(
      'engineFactsStatus가 engine_facts_v1이 아닙니다.'
    );
  }

  if (
    body
      .diagnostic
      ?.rag
      ?.status !==
    'ok'
  ) {
    errors.push(
      `RAG status가 ok가 아닙니다: ${
        body
          .diagnostic
          ?.rag
          ?.status ??
        'missing'
      }`
    );
  }

  const returned =
    Number(
      body
        .diagnostic
        ?.rag
        ?.retrieval
        ?.stats
        ?.returned
    );

  if (
    !Number.isFinite(
      returned
    ) ||
    returned <= 0
  ) {
    errors.push(
      'RAG 검색 결과가 1개 이상 반환되지 않았습니다.'
    );
  }

  if (
    typeof body.reply !==
      'string' ||
    !body.reply.trim()
  ) {
    errors.push(
      '최종 LLM reply가 비어 있습니다.'
    );
  }

  console.log('');

  if (
    errors.length > 0
  ) {
    console.log(
      '============================================================'
    );

    console.log(
      ' FAIL: /api/chat End-to-End'
    );

    console.log(
      '============================================================'
    );

    for (
      const error of
      errors
    ) {
      console.log(
        `- ${error}`
      );
    }

    console.log('');

    process.exitCode =
      3;

    return;
  }

  console.log(
    '============================================================'
  );

  console.log(
    ' PASS: Engine -> RAG -> LLM -> /api/chat Response'
  );

  console.log(
    '============================================================'
  );

  console.log('');
}


main()
  .catch(
    (error) => {
      console.error('');

      console.error(
        '============================================================'
      );

      console.error(
        ' SG-CHAT-E2E-TEST-001'
      );

      console.error(
        ' stage  : LOCAL_E2E_TEST'
      );

      console.error(
        ` message: ${
          error?.message ||
          String(error)
        }`
      );

      console.error(
        '============================================================'
      );

      console.error('');

      process.exitCode =
        1;
    }
  );