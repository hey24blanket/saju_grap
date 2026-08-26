#!/usr/bin/env node
// scripts/testRagIntegration.js
// SajuGrap Engine Facts -> RAG Query Builder -> Firestore Retriever Integration Test
// -----------------------------------------------------------------------------
// 목적
// 1. SajuGrapEngine으로 실제 Engine Facts v1 생성
// 2. ragQueryBuilder로 정식 rag_query_v1 생성
// 3. Gemini RETRIEVAL_QUERY embedding 생성
// 4. Firestore Vector Search 실행
// 5. Top-K RAG chunk 확인
//
// 이 스크립트는 테스트용 고정 생년월일을 사용한다.
// 실제 사용자 개인정보가 필요하지 않다.
// -----------------------------------------------------------------------------

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';


const SCRIPT_VERSION =
  '1.0.0';

const __filename =
  fileURLToPath(
    import.meta.url
  );

const __dirname =
  path.dirname(
    __filename
  );

const PROJECT_ROOT =
  path.resolve(
    __dirname,
    '..'
  );


const DEFAULT_QUESTION =
  '용신과 기신을 단순한 길흉이 아니라 현재 구조의 균형과 행동 전략으로 어떻게 해석해야 하나?';

const DEFAULT_DOMAIN =
  'all';

const DEFAULT_CYCLE_TYPE =
  null;

const DEFAULT_CYCLE_INDEX =
  null;


// ============================================================================
// Fixed non-user test input
// ----------------------------------------------------------------------------
// 실제 사용자 개인정보가 아닌 통합 테스트 전용 값.
// referenceDateTime도 고정하여 테스트 재현성을 높인다.
// ============================================================================

const TEST_INPUT =
  Object.freeze({
    name:
      'RAG-INTEGRATION-TEST',

    year:
      1990,

    month:
      5,

    day:
      17,

    hour:
      10,

    minute:
      30,

    second:
      0,

    gender:
      'male',

    calendarType:
      'solar',

    timezone:
      'Asia/Seoul',

    referenceDateTime:
      '2026-08-26T12:00:00+09:00'
  });


// ============================================================================
// Helpers
// ============================================================================

function cleanText(
  value,
  maxLength = 20000
) {
  if (
    typeof value !==
      'string'
  ) {
    return '';
  }

  return value
    .trim()
    .slice(
      0,
      maxLength
    );
}


function safeArray(
  value
) {
  return Array.isArray(
    value
  )
    ? value
    : [];
}


async function pathExists(
  targetPath
) {
  try {
    await fs.access(
      targetPath
    );

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


function preview(
  text,
  maxLength = 420
) {
  const normalized =
    cleanText(
      text,
      maxLength + 100
    )
      .replace(
        /\s+/g,
        ' '
      );

  if (
    normalized.length <=
      maxLength
  ) {
    return normalized;
  }

  return `${normalized.slice(
    0,
    maxLength
  )}...`;
}


// ============================================================================
// .env loader
// ----------------------------------------------------------------------------
// dynamic import 전에 환경변수를 먼저 읽는다.
// ============================================================================

function parseEnvLine(
  line
) {
  const trimmed =
    line.trim();

  if (
    !trimmed ||
    trimmed.startsWith(
      '#'
    )
  ) {
    return null;
  }


  const normalized =
    trimmed.startsWith(
      'export '
    )
      ? trimmed.slice(
          7
        )
      : trimmed;


  const equalIndex =
    normalized.indexOf(
      '='
    );


  if (
    equalIndex <=
      0
  ) {
    return null;
  }


  const key =
    normalized
      .slice(
        0,
        equalIndex
      )
      .trim();


  let value =
    normalized
      .slice(
        equalIndex + 1
      )
      .trim();


  if (
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(
      key
    )
  ) {
    return null;
  }


  if (
    (
      value.startsWith(
        '"'
      ) &&
      value.endsWith(
        '"'
      )
    ) ||
    (
      value.startsWith(
        "'"
      ) &&
      value.endsWith(
        "'"
      )
    )
  ) {
    value =
      value.slice(
        1,
        -1
      );
  }


  return {
    key,
    value
  };
}


async function loadEnvFile(
  filePath
) {
  if (
    !(await pathExists(
      filePath
    ))
  ) {
    return false;
  }


  const text =
    await fs.readFile(
      filePath,
      'utf8'
    );


  for (
    const line of
    text.split(
      /\r?\n/
    )
  ) {
    const parsed =
      parseEnvLine(
        line
      );


    if (
      !parsed
    ) {
      continue;
    }


    if (
      process.env[
        parsed.key
      ] ===
      undefined
    ) {
      process.env[
        parsed.key
      ] =
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

function parseArgs(
  argv
) {
  let question =
    DEFAULT_QUESTION;

  let domain =
    DEFAULT_DOMAIN;

  let cycleType =
    DEFAULT_CYCLE_TYPE;

  let cycleIndex =
    DEFAULT_CYCLE_INDEX;


  for (
    let index = 0;
    index <
      argv.length;
    index += 1
  ) {
    const arg =
      argv[
        index
      ];


    if (
      arg ===
        '--help'
    ) {
      console.log(`
SajuGrap RAG Integration Test v${SCRIPT_VERSION}

Usage:

  node scripts/testRagIntegration.js

Options:

  --question "질문"
  --domain all|career|wealth|mental|love
  --cycle daewoon|year|month|day|hour
  --cycle-index <number>

Examples:

  node scripts/testRagIntegration.js

  node scripts/testRagIntegration.js --domain career --question "사업운에서 지금 어떤 기능을 조절해야 하나?"

  node scripts/testRagIntegration.js --cycle daewoon --cycle-index 0 --question "이 대운을 어떻게 활용해야 하나?"
`);

      process.exit(
        0
      );
    }


    if (
      arg ===
        '--question'
    ) {
      const value =
        argv[
          index + 1
        ];

      if (
        !value
      ) {
        throw new Error(
          '--question 뒤에 질문을 입력하세요.'
        );
      }

      question =
        cleanText(
          value,
          10000
        );

      index +=
        1;

      continue;
    }


    if (
      arg ===
        '--domain'
    ) {
      const value =
        cleanText(
          argv[
            index + 1
          ],
          40
        );

      const allowed = [
        'all',
        'career',
        'wealth',
        'mental',
        'love'
      ];


      if (
        !allowed.includes(
          value
        )
      ) {
        throw new Error(
          `지원하지 않는 domain입니다: ${value}`
        );
      }


      domain =
        value;

      index +=
        1;

      continue;
    }


    if (
      arg ===
        '--cycle'
    ) {
      const value =
        cleanText(
          argv[
            index + 1
          ],
          40
        );


      const allowed = [
        'daewoon',
        'year',
        'month',
        'day',
        'hour'
      ];


      if (
        !allowed.includes(
          value
        )
      ) {
        throw new Error(
          `지원하지 않는 cycle입니다: ${value}`
        );
      }


      cycleType =
        value;

      index +=
        1;

      continue;
    }


    if (
      arg ===
        '--cycle-index'
    ) {
      const value =
        Number(
          argv[
            index + 1
          ]
        );


      if (
        !Number.isInteger(
          value
        ) ||
        value <
          0
      ) {
        throw new Error(
          '--cycle-index는 0 이상의 정수여야 합니다.'
        );
      }


      cycleIndex =
        value;

      index +=
        1;

      continue;
    }


    throw new Error(
      `알 수 없는 옵션입니다: ${arg}`
    );
  }


  if (
    cycleType &&
    cycleIndex ===
      null
  ) {
    cycleIndex =
      0;
  }


  if (
    !cycleType
  ) {
    cycleIndex =
      null;
  }


  return {
    question,
    domain,
    cycleType,
    cycleIndex
  };
}


// ============================================================================
// Engine summary
// ============================================================================

function firstUsefulGodRole(
  value
) {
  if (
    Array.isArray(
      value
    )
  ) {
    return value[
      0
    ] ||
    null;
  }

  if (
    value &&
    typeof value ===
      'object'
  ) {
    return value;
  }

  return null;
}


function engineSummary(
  facts
) {
  const natal =
    facts
      ?.natal ||
    {};

  const dayMaster =
    natal
      ?.dayMaster ||
    {};

  const yongsin =
    firstUsefulGodRole(
      facts
        ?.usefulGodProfile
        ?.yongsin
    );


  const detectedStars =
    safeArray(
      facts
        ?.stars
    )
      .filter(
        (item) =>
          item
            ?.detected
      )
      .map(
        (item) =>
          item.starId
      )
      .filter(
        Boolean
      );


  const cycleCounts =
    {};


  for (
    const key of
    [
      'daewoon',
      'year',
      'month',
      'day',
      'hour'
    ]
  ) {
    cycleCounts[
      key
    ] =
      safeArray(
        facts
          ?.cycles
          ?.[key]
      ).length;
  }


  return {
    schemaVersion:
      facts
        ?.schemaVersion,

    engineVersion:
      facts
        ?.engineVersion,

    dayMaster:
      dayMaster
        ?.stem ||
      null,

    strengthBand:
      facts
        ?.strength
        ?.band ||
      null,

    yongsinElement:
      yongsin
        ?.element ||
      null,

    yongsinMechanisms:
      safeArray(
        yongsin
          ?.mechanisms
      ),

    detectedStars,

    relationCount:
      safeArray(
        facts
          ?.relations
          ?.items
      ).length,

    cycleCounts,

    warningCount:
      safeArray(
        facts
          ?.diagnostics
          ?.warnings
      ).length
  };
}


// ============================================================================
// Output
// ============================================================================

function printRetrievedResult(
  item,
  index
) {
  console.log('');
  console.log(
    `[${index + 1}] ${item.title || '(no title)'}`
  );

  console.log(
    `chunkId       : ${item.chunkId || '-'}`
  );

  console.log(
    `sourcePdf     : ${item.source?.sourcePdf || '-'}`
  );

  console.log(
    `sourcePage    : ${item.source?.sourcePage ?? '-'}`
  );

  console.log(
    `semanticScore : ${item.retrieval?.semanticScore ?? '-'}`
  );

  console.log(
    `metadataScore : ${item.retrieval?.metadataScore ?? '-'}`
  );

  console.log(
    `finalScore    : ${item.retrieval?.finalScore ?? '-'}`
  );

  console.log(
    `text          : ${preview(item.content)}`
  );
}


// ============================================================================
// Diagnostic fallback
// ----------------------------------------------------------------------------
// 실제 Builder hard filter 때문에 결과가 0개일 경우,
// 같은 semanticQuery를 filter 없이 한 번만 재검색해
// Vector 문제인지 metadata 문제인지 구분한다.
// ============================================================================

async function diagnoseZeroResults({
  queryPacket,
  retrieveRag
}) {
  console.log('');
  separator();

  console.log(
    ' ZERO-RESULT DIAGNOSTIC'
  );

  separator();


  const diagnosticPacket =
    structuredClone(
      queryPacket
    );


  diagnosticPacket
    .query
    .hardFilters =
    [];


  diagnosticPacket
    .query
    .softFilters =
    [];


  const fallback =
    await retrieveRag(
      diagnosticPacket,
      {
        targetResults:
          3,

        maximumResults:
          3,

        candidateLimit:
          80
      }
    );


  console.log(
    `without filters returned: ${fallback.stats.returned}`
  );


  if (
    fallback.stats.returned >
      0
  ) {
    console.log(
      '[DIAGNOSIS] Vector Search는 정상이며 metadata/hard-filter 매핑을 점검해야 합니다.'
    );


    fallback
      .results
      .forEach(
        printRetrievedResult
      );
  } else {
    console.log(
      '[DIAGNOSIS] Filter를 제거해도 결과가 없습니다. Vector Index / collection / embedding을 점검해야 합니다.'
    );
  }
}


// ============================================================================
// Main
// ============================================================================

async function main() {
  const envStatus =
    await loadLocalEnvironment();


  const config =
    parseArgs(
      process.argv
        .slice(
          2
        )
    );


  console.log('');
  console.log(
    '============================================================'
  );

  console.log(
    ' SajuGrap Engine -> RAG Integration Test'
  );

  console.log(
    '============================================================'
  );

  console.log(
    `env.local : ${envStatus.localLoaded ? 'FOUND' : 'NOT FOUND'}`
  );

  console.log(
    `domain    : ${config.domain}`
  );

  console.log(
    `cycle     : ${config.cycleType ?? 'natal/general'}`
  );

  console.log(
    `cycleIndex: ${config.cycleIndex ?? '-'}`
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
      'GEMINI_API_KEY가 없습니다. .env.local을 확인하세요.'
    );
  }


  const {
    calculateSajuGrap
  } =
    await import(
      '../src/engine/SajuGrapEngine.js'
    );


  const {
    buildRagQuery,
    validateRagQuery,
    summarizeRagQuery
  } =
    await import(
      '../lib/ragQueryBuilder.js'
    );


  const {
    retrieveRag,
    buildRetrievedRagContext,
    summarizeRagRetrieval
  } =
    await import(
      '../lib/ragRetriever.js'
    );


  // --------------------------------------------------------------------------
  // 1. Engine
  // --------------------------------------------------------------------------

  console.log(
    '[1/4] Calculating Engine Facts...'
  );


  const engineFacts =
    calculateSajuGrap(
      TEST_INPUT
    );


  const summary =
    engineSummary(
      engineFacts
    );


  console.log(
    '[ENGINE]'
  );

  console.log(
    JSON.stringify(
      summary,
      null,
      2
    )
  );


  // --------------------------------------------------------------------------
  // 2. Query Builder
  // --------------------------------------------------------------------------

  console.log('');
  console.log(
    '[2/4] Building RAG Query Packet from Engine Facts...'
  );


  const queryPacket =
    buildRagQuery(
      engineFacts,
      {
        domain:
          config.domain,

        cycleType:
          config.cycleType,

        cycleIndex:
          config.cycleIndex,

        userQuery:
          config.question
      }
    );


  const queryValidation =
    validateRagQuery(
      queryPacket
    );


  if (
    !queryValidation.valid
  ) {
    throw new Error(
      `RAG Query Packet validation failed: ${queryValidation.errors.join(', ')}`
    );
  }


  console.log(
    '[QUERY PACKET]'
  );

  console.log(
    JSON.stringify(
      summarizeRagQuery(
        queryPacket
      ),
      null,
      2
    )
  );


  // --------------------------------------------------------------------------
  // 3. Retriever
  // --------------------------------------------------------------------------

  console.log('');
  console.log(
    '[3/4] Embedding query and searching Firestore...'
  );


  const retrieval =
    await retrieveRag(
      queryPacket,
      {
        targetResults:
          6,

        maximumResults:
          6,

        candidateLimit:
          100
      }
    );


  console.log(
    '[RETRIEVAL]'
  );

  console.log(
    JSON.stringify(
      summarizeRagRetrieval(
        retrieval
      ),
      null,
      2
    )
  );


  // --------------------------------------------------------------------------
  // 4. Human review
  // --------------------------------------------------------------------------

  console.log('');
  console.log(
    '[4/4] Reviewing retrieved knowledge...'
  );

  console.log('');
  separator();

  console.log(
    ' TOP RAG RESULTS'
  );

  separator();


  retrieval
    .results
    .forEach(
      printRetrievedResult
    );


  if (
    retrieval
      .results
      .length ===
      0
  ) {
    await diagnoseZeroResults({
      queryPacket,
      retrieveRag
    });


    throw new Error(
      'Engine-integrated retrieval returned 0 results.'
    );
  }


  console.log('');
  separator();

  console.log(
    ' LLM CONTEXT PREVIEW'
  );

  separator();


  const context =
    buildRetrievedRagContext(
      retrieval,
      {
        maxChunks:
          3,

        maxCharsPerChunk:
          700
      }
    );


  console.log(
    context
  );


  console.log('');
  console.log(
    '============================================================'
  );

  console.log(
    ' PASS: Engine Facts -> Query Builder -> Vector Retriever'
  );

  console.log(
    '============================================================'
  );

  console.log('');
}


// ============================================================================
// Error boundary
// ============================================================================

main()
  .catch(
    (error) => {
      console.error('');
      console.error(
        '============================================================'
      );

      console.error(
        ` ${error?.code || 'SG-RAG-INTEGRATION-TEST-001'}`
      );

      console.error(
        ` stage  : ${error?.stage || 'INTEGRATION_TEST'}`
      );

      console.error(
        ` message: ${error?.message || String(error)}`
      );


      if (
        error?.detail
      ) {
        console.error(
          ` detail : ${error.detail}`
        );
      }


      console.error(
        '============================================================'
      );

      console.error('');

      process.exitCode =
        1;
    }
  );