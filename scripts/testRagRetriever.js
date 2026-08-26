#!/usr/bin/env node
// scripts/testRagRetriever.js
// SajuGrap Firestore Vector Retriever Smoke Test v1
// -----------------------------------------------------------------------------
// 목적
// - .env.local / .env를 읽는다.
// - Gemini RETRIEVAL_QUERY embedding 생성이 되는지 확인한다.
// - Firestore vector index 검색이 되는지 확인한다.
// - 검색된 Top-K RAG chunk를 사람이 확인할 수 있게 출력한다.
//
// 이 테스트에서는 사주 계산을 하지 않는다.
// Engine Facts 통합 테스트는 다음 단계에서 별도로 진행한다.
// -----------------------------------------------------------------------------

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_VERSION = '1.0.0';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const DEFAULT_QUESTION =
  '용신과 기신을 단순히 좋은 운과 나쁜 운으로 보면 안 되는 이유는 무엇인가?';

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

function parseEnvLine(line) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const normalized =
    trimmed.startsWith('export ')
      ? trimmed.slice(7)
      : trimmed;

  const equalIndex = normalized.indexOf('=');

  if (equalIndex <= 0) {
    return null;
  }

  const key = normalized.slice(0, equalIndex).trim();
  let value = normalized.slice(equalIndex + 1).trim();

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

async function loadEnvFile(filePath) {
  if (!(await pathExists(filePath))) {
    return false;
  }

  const text = await fs.readFile(filePath, 'utf8');

  for (const line of text.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;

    if (process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }

  return true;
}

async function loadLocalEnvironment() {
  const localLoaded = await loadEnvFile(
    path.join(PROJECT_ROOT, '.env.local')
  );

  const envLoaded = await loadEnvFile(
    path.join(PROJECT_ROOT, '.env')
  );

  return { localLoaded, envLoaded };
}

function parseArgs(argv) {
  let question = '';
  let targetResults = 6;
  let candidateLimit = 80;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help') {
      console.log(`
SajuGrap RAG Retriever Smoke Test v${SCRIPT_VERSION}

Usage:
  node scripts/testRagRetriever.js
  node scripts/testRagRetriever.js "질문 내용"

Options:
  --top <number>
      최종 출력 chunk 수
      기본: 6

  --candidates <number>
      Firestore vector candidate 수
      기본: 80

Example:
  node scripts/testRagRetriever.js "신강을 성공으로 해석하면 안 되는 이유는?"
`);
      process.exit(0);
    }

    if (arg === '--top') {
      const next = Number(argv[index + 1]);

      if (!Number.isInteger(next) || next < 1 || next > 10) {
        throw new Error('--top 값은 1~10 정수여야 합니다.');
      }

      targetResults = next;
      index += 1;
      continue;
    }

    if (arg === '--candidates') {
      const next = Number(argv[index + 1]);

      if (!Number.isInteger(next) || next < 1 || next > 200) {
        throw new Error('--candidates 값은 1~200 정수여야 합니다.');
      }

      candidateLimit = next;
      index += 1;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`알 수 없는 옵션입니다: ${arg}`);
    }

    question = [question, arg]
      .filter(Boolean)
      .join(' ');
  }

  return {
    question: cleanText(question, 10000) || DEFAULT_QUESTION,
    targetResults,
    candidateLimit
  };
}

function buildSmokeTestQueryPacket(question) {
  return {
    schemaVersion: 'rag_query_v1',
    builderVersion: '1.0.0',

    source: {
      schemaVersion: 'engine_facts_v1',
      engineVersion: 'smoke-test',
      factAuthority: 'SajuGrapEngine'
    },

    context: {
      domain: 'all',
      cycleType: null,
      cycleIndex: null,
      userQuery: question
    },

    facts: {},

    query: {
      semanticQuery: question,

      tokens: [
        `userQuestion=${question}`
      ],

      metadata: {
        domain: 'all'
      },

      hardFilters: [],
      softFilters: [],

      rankingPolicy: {
        semanticWeight: 1.0,
        metadataBoostEnabled: false,
        minimumResults: 1,
        targetResults: 6,
        maximumResults: 10
      }
    },

    policy: {
      recalculateEngineFacts: false,
      includeEngineDiagnostics: false,
      inferMissingFacts: false,
      databaseNeutral: true
    }
  };
}

function separator() {
  console.log(
    '------------------------------------------------------------'
  );
}

function preview(text, maxLength = 450) {
  const cleaned = cleanText(text, maxLength + 100)
    .replace(/\s+/g, ' ');

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, maxLength)}...`;
}

function printResult(item, index) {
  const source = item.source || {};

  console.log('');
  console.log(`[${index + 1}] ${item.title || '(no title)'}`);
  console.log(`chunkId       : ${item.chunkId || '-'}`);
  console.log(`knowledgeId   : ${item.knowledgeId || '-'}`);
  console.log(`sourcePdf     : ${source.sourcePdf || '-'}`);
  console.log(`sourcePage    : ${source.sourcePage ?? '-'}`);
  console.log(
    `vectorDistance: ${item.retrieval?.vectorDistance ?? '-'}`
  );
  console.log(
    `semanticScore : ${item.retrieval?.semanticScore ?? '-'}`
  );
  console.log(
    `finalScore    : ${item.retrieval?.finalScore ?? '-'}`
  );
  console.log(
    `text          : ${preview(item.content)}`
  );
}

function safeError(error) {
  return {
    code: error?.code || 'SG-RAG-TEST-001',
    stage: error?.stage || 'RAG_RETRIEVER_SMOKE_TEST',
    message: error?.message || String(error),
    detail: error?.detail || null
  };
}

async function main() {
  const envStatus = await loadLocalEnvironment();

  const {
    question,
    targetResults,
    candidateLimit
  } = parseArgs(
    process.argv.slice(2)
  );

  console.log('');
  console.log(
    '============================================================'
  );
  console.log(
    ' SajuGrap RAG Retriever Smoke Test'
  );
  console.log(
    '============================================================'
  );
  console.log(
    `env.local : ${envStatus.localLoaded ? 'FOUND' : 'NOT FOUND'}`
  );
  console.log(`question  : ${question}`);
  console.log(`top       : ${targetResults}`);
  console.log(`candidates: ${candidateLimit}`);
  console.log(
    '============================================================'
  );
  console.log('');

  // .env.local을 읽은 뒤 dynamic import한다.
  const {
    retrieveRag,
    buildRetrievedRagContext,
    getRagRetrieverRuntimeInfo
  } = await import(
    '../lib/ragRetriever.js'
  );

  const runtime =
    getRagRetrieverRuntimeInfo();

  console.log('[RUNTIME]');
  console.log(`collection : ${runtime.collection}`);
  console.log(`vectorField: ${runtime.vectorField}`);
  console.log(`distance   : ${runtime.distanceMeasure}`);
  console.log(`model      : ${runtime.embeddingModel}`);
  console.log(`dimensions : ${runtime.embeddingDimensions}`);
  console.log('');

  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY가 없습니다. .env.local을 확인하세요.'
    );
  }

  if (
    !process.env.GOOGLE_APPLICATION_CREDENTIALS &&
    !process.env.FIREBASE_SERVICE_ACCOUNT_JSON &&
    !(
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
    )
  ) {
    console.log(
      '[WARN] 명시적인 Firebase 인증 환경변수를 찾지 못했습니다.'
    );
    console.log(
      'Application Default Credentials를 시도합니다.'
    );
    console.log('');
  }

  const packet =
    buildSmokeTestQueryPacket(
      question
    );

  console.log(
    '[1/3] Query packet ready.'
  );

  console.log(
    '[2/3] Creating Gemini query embedding and searching Firestore...'
  );

  const result =
    await retrieveRag(
      packet,
      {
        targetResults,
        maximumResults: targetResults,
        candidateLimit
      }
    );

  console.log(
    '[3/3] Retrieval complete.'
  );

  console.log('');

  separator();
  console.log(
    ' SEARCH SUMMARY'
  );
  separator();

  console.log(
    `auth mode         : ${result.source.authMode}`
  );
  console.log(
    `project           : ${result.source.projectId || 'auto'}`
  );
  console.log(
    `collection        : ${result.source.collection}`
  );
  console.log(
    `vector field      : ${result.source.vectorField}`
  );
  console.log(
    `embedding model   : ${result.source.embeddingModel}`
  );
  console.log(
    `dimensions        : ${result.source.embeddingDimensions}`
  );
  console.log(
    `candidates        : ${result.stats.candidatesReturned}`
  );
  console.log(
    `hard-filter reject: ${result.stats.rejectedByHardFilter}`
  );
  console.log(
    `returned          : ${result.stats.returned}`
  );
  console.log(
    `elapsed           : ${result.stats.elapsedMs} ms`
  );

  if (result.results.length === 0) {
    console.log('');
    console.log(
      '[FAIL] Vector search는 실행됐지만 검색 결과가 0개입니다.'
    );

    process.exitCode = 2;
    return;
  }

  console.log('');
  separator();
  console.log(
    ' TOP RAG RESULTS'
  );
  separator();

  result.results.forEach(
    printResult
  );

  console.log('');
  separator();
  console.log(
    ' LLM CONTEXT PREVIEW'
  );
  separator();

  const llmContext =
    buildRetrievedRagContext(
      result,
      {
        maxChunks:
          Math.min(
            3,
            result.results.length
          ),

        maxCharsPerChunk:
          800
      }
    );

  console.log(
    llmContext
  );

  console.log('');
  console.log(
    '============================================================'
  );
  console.log(
    ' PASS: Gemini Query Embedding -> Firestore Vector Search'
  );
  console.log(
    '============================================================'
  );
  console.log('');
}

main()
  .catch(
    (error) => {
      const info =
        safeError(
          error
        );

      console.error('');
      console.error(
        '============================================================'
      );
      console.error(` ${info.code}`);
      console.error(` stage  : ${info.stage}`);
      console.error(` message: ${info.message}`);

      if (info.detail) {
        console.error(
          ` detail : ${info.detail}`
        );
      }

      console.error(
        '============================================================'
      );

      const lower =
        `${info.message} ${info.detail || ''}`
          .toLowerCase();

      if (
        lower.includes('index') ||
        lower.includes('failed_precondition')
      ) {
        console.error('');
        console.error(
          '[HINT] Firestore Vector Index가 아직 Building 상태인지 확인하세요.'
        );
        console.error(
          'Collection=sajugrap_rag_chunks / Field=embeddingVector / Dimensions=768'
        );
      }

      if (
        lower.includes('credential') ||
        lower.includes('authentication') ||
        lower.includes('permission')
      ) {
        console.error('');
        console.error(
          '[HINT] .env.local의 Firebase service account 경로와 권한을 확인하세요.'
        );
      }

      if (
        lower.includes('quota') ||
        lower.includes('429')
      ) {
        console.error('');
        console.error(
          '[HINT] Gemini embedding quota에 걸렸을 수 있습니다. 잠시 후 다시 실행하세요.'
        );
      }

      console.error('');

      process.exitCode = 1;
    }
  );