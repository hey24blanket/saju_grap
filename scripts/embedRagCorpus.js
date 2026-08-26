#!/usr/bin/env node
// scripts/embedRagCorpus.js
// SajuGrap Reviewed Production Corpus Embedding Builder v1
// -----------------------------------------------------------------------------
// 역할
// - data/rag-corpus.reviewed.production.jsonl 을 읽는다.
// - production + active + retrievalAllowed 문서만 embedding 대상으로 선택한다.
// - lib/embeddingProvider.js 를 통해 RETRIEVAL_DOCUMENT embedding을 생성한다.
// - 중간 실패에 대비해 batch 단위 checkpoint를 저장한다.
// - 동일 model/dimensions/inputHash의 기존 embedding은 resume 시 재사용한다.
// - 최종 embedded JSONL + manifest를 생성한다.
//
// 하지 않는 것
// - 사주 계산
// - RAG metadata 재분류
// - 본문 해석
// - Firestore 업로드
//
// Firestore 업로드는 다음 단계의 별도 스크립트가 담당한다.
// -----------------------------------------------------------------------------

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  validateRagDocument,
  RAG_CORPUS,
  RAG_DOCUMENT_STATUS
} from '../lib/ragDocumentSchema.js';

import {
  attachEmbeddingsToRagDocuments
} from '../lib/embeddingProvider.js';


const SCRIPT_VERSION = '1.0.0';

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


const DEFAULT_INPUT =
  path.join(
    PROJECT_ROOT,
    'data',
    'rag-corpus.reviewed.production.jsonl'
  );

const DEFAULT_OUTPUT =
  path.join(
    PROJECT_ROOT,
    'data',
    'rag-corpus.embedded.production.jsonl'
  );

const DEFAULT_MANIFEST =
  path.join(
    PROJECT_ROOT,
    'data',
    'rag-corpus.embedded.production.manifest.json'
  );


// ============================================================================
// Error
// ============================================================================

class RagCorpusEmbeddingError extends Error {
  constructor({
    code,
    stage,
    message,
    detail = null,
    cause = null
  }) {
    super(message);

    this.name =
      'RagCorpusEmbeddingError';

    this.code =
      code;

    this.stage =
      stage;

    this.detail =
      detail;

    if (cause) {
      this.cause =
        cause;
    }
  }
}


// ============================================================================
// Small utilities
// ============================================================================

function cleanText(
  value
) {
  return String(
    value ??
    ''
  ).trim();
}


function sha256(
  text
) {
  return crypto
    .createHash(
      'sha256'
    )
    .update(
      String(
        text ??
        ''
      ),
      'utf8'
    )
    .digest(
      'hex'
    );
}


function isFiniteVector(
  value
) {
  return (
    Array.isArray(
      value
    ) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item ===
          'number' &&
        Number.isFinite(
          item
        )
    )
  );
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


async function ensureParent(
  filePath
) {
  await fs.mkdir(
    path.dirname(
      filePath
    ),
    {
      recursive:
        true
    }
  );
}


function positiveInteger(
  value,
  fallback,
  {
    min = 1,
    max = 100000
  } = {}
) {
  const parsed =
    Number(
      value
    );

  if (
    !Number.isInteger(
      parsed
    ) ||
    parsed < min ||
    parsed > max
  ) {
    return fallback;
  }

  return parsed;
}


// ============================================================================
// .env loader
// ----------------------------------------------------------------------------
// 외부 dotenv dependency를 추가하지 않는다.
//
// 우선순위:
// 1. 이미 process.env에 있는 값
// 2. .env.local
// 3. .env
//
// 기존 process.env는 절대 덮어쓰지 않는다.
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
      ? trimmed.slice(7)
      : trimmed;

  const equalIndex =
    normalized.indexOf(
      '='
    );

  if (
    equalIndex <= 0
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
      value.startsWith('"') &&
      value.endsWith('"')
    ) ||
    (
      value.startsWith("'") &&
      value.endsWith("'")
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

    if (!parsed) {
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
  await loadEnvFile(
    path.join(
      PROJECT_ROOT,
      '.env.local'
    )
  );

  await loadEnvFile(
    path.join(
      PROJECT_ROOT,
      '.env'
    )
  );
}


// ============================================================================
// Runtime defaults
// ============================================================================

function getRuntimeDefaults() {
  return {
    input:
      DEFAULT_INPUT,

    output:
      DEFAULT_OUTPUT,

    manifest:
      DEFAULT_MANIFEST,

    model:
      cleanText(
        process.env
          .GEMINI_EMBEDDING_MODEL
      ) ||
      'gemini-embedding-2',

    dimensions:
      positiveInteger(
        process.env
          .RAG_EMBEDDING_DIMENSIONS,
        768,
        {
          min: 128,
          max: 2048
        }
      ),

    batchSize:
      positiveInteger(
        process.env
          .RAG_EMBEDDING_BATCH_SIZE,
        32,
        {
          min: 1,
          max: 100
        }
      ),

    timeoutMs:
      positiveInteger(
        process.env
          .RAG_EMBEDDING_TIMEOUT_MS,
        30000,
        {
          min: 1000,
          max: 120000
        }
      ),

    maxRetries:
      positiveInteger(
        process.env
          .RAG_EMBEDDING_MAX_RETRIES,
        3,
        {
          min: 1,
          max: 8
        }
      ),

    resume:
      true,

    force:
      false,

    dryRun:
      false,

    limit:
      null
  };
}


// ============================================================================
// CLI
// ============================================================================

function printHelp() {
  console.log(`
SajuGrap RAG Corpus Embedder v${SCRIPT_VERSION}

사용법:
  node scripts/embedRagCorpus.js [options]

옵션:
  --input <jsonl>
      입력 production corpus
      기본: data/rag-corpus.reviewed.production.jsonl

  --output <jsonl>
      embedding 완료 corpus
      기본: data/rag-corpus.embedded.production.jsonl

  --manifest <json>
      embedding build manifest

  --model <model>
      기본: GEMINI_EMBEDDING_MODEL 또는 gemini-embedding-2

  --dimensions <number>
      기본: RAG_EMBEDDING_DIMENSIONS 또는 768

  --batch-size <number>
      기본: RAG_EMBEDDING_BATCH_SIZE 또는 32

  --timeout-ms <number>
      기본: 30000

  --max-retries <number>
      기본: 3

  --limit <number>
      이번 실행에서 새로 embedding할 최대 chunk 수
      테스트 시 유용

  --force
      기존 embedding이 있어도 다시 생성

  --no-resume
      기존 output checkpoint를 재사용하지 않음

  --dry-run
      API를 호출하지 않고 검증/예상 작업량만 출력

  --help
      도움말

예:
  node scripts/embedRagCorpus.js --dry-run

  node scripts/embedRagCorpus.js --limit 5

  node scripts/embedRagCorpus.js
`);
}


function parseArgs(
  argv
) {
  const config =
    getRuntimeDefaults();


  const requireValue = (
    index,
    flag
  ) => {
    const value =
      argv[
        index + 1
      ];

    if (
      value ===
        undefined ||
      value.startsWith(
        '--'
      )
    ) {
      throw new RagCorpusEmbeddingError({
        code:
          'SG-RAG-EMBED-CLI-001',

        stage:
          'PARSE_ARGS',

        message:
          `${flag} 뒤에 값이 필요합니다.`
      });
    }

    return value;
  };


  for (
    let index = 0;
    index <
      argv.length;
    index += 1
  ) {
    const arg =
      argv[index];


    switch (
      arg
    ) {
      case '--help':
        printHelp();

        process.exit(
          0
        );
        break;


      case '--dry-run':
        config.dryRun =
          true;
        break;


      case '--force':
        config.force =
          true;
        break;


      case '--no-resume':
        config.resume =
          false;
        break;


      case '--input':
        config.input =
          path.resolve(
            PROJECT_ROOT,
            requireValue(
              index,
              arg
            )
          );

        index += 1;
        break;


      case '--output':
        config.output =
          path.resolve(
            PROJECT_ROOT,
            requireValue(
              index,
              arg
            )
          );

        index += 1;
        break;


      case '--manifest':
        config.manifest =
          path.resolve(
            PROJECT_ROOT,
            requireValue(
              index,
              arg
            )
          );

        index += 1;
        break;


      case '--model':
        config.model =
          cleanText(
            requireValue(
              index,
              arg
            )
          );

        index += 1;
        break;


      case '--dimensions':
        config.dimensions =
          positiveInteger(
            requireValue(
              index,
              arg
            ),
            -1,
            {
              min: 128,
              max: 2048
            }
          );

        index += 1;
        break;


      case '--batch-size':
        config.batchSize =
          positiveInteger(
            requireValue(
              index,
              arg
            ),
            -1,
            {
              min: 1,
              max: 100
            }
          );

        index += 1;
        break;


      case '--timeout-ms':
        config.timeoutMs =
          positiveInteger(
            requireValue(
              index,
              arg
            ),
            -1,
            {
              min: 1000,
              max: 120000
            }
          );

        index += 1;
        break;


      case '--max-retries':
        config.maxRetries =
          positiveInteger(
            requireValue(
              index,
              arg
            ),
            -1,
            {
              min: 1,
              max: 8
            }
          );

        index += 1;
        break;


      case '--limit':
        config.limit =
          positiveInteger(
            requireValue(
              index,
              arg
            ),
            -1,
            {
              min: 1,
              max: 100000
            }
          );

        index += 1;
        break;


      default:
        throw new RagCorpusEmbeddingError({
          code:
            'SG-RAG-EMBED-CLI-002',

          stage:
            'PARSE_ARGS',

          message:
            `알 수 없는 옵션입니다: ${arg}`
        });
    }
  }


  if (
    !config.model
  ) {
    throw new RagCorpusEmbeddingError({
      code:
        'SG-RAG-EMBED-CONFIG-001',

      stage:
        'VALIDATE_CONFIG',

      message:
        'Embedding model이 비어 있습니다.'
    });
  }


  if (
    config.dimensions <
      128 ||
    config.dimensions >
      2048
  ) {
    throw new RagCorpusEmbeddingError({
      code:
        'SG-RAG-EMBED-CONFIG-002',

      stage:
        'VALIDATE_CONFIG',

      message:
        `Embedding dimensions가 올바르지 않습니다: ${config.dimensions}`,

      detail:
        'Firestore vector 저장을 위해 128~2048 범위를 사용합니다.'
    });
  }


  if (
    config.batchSize <
      1
  ) {
    throw new RagCorpusEmbeddingError({
      code:
        'SG-RAG-EMBED-CONFIG-003',

      stage:
        'VALIDATE_CONFIG',

      message:
        'batchSize가 올바르지 않습니다.'
    });
  }


  return config;
}


// ============================================================================
// JSONL
// ============================================================================

async function readJsonl(
  filePath
) {
  if (
    !(await pathExists(
      filePath
    ))
  ) {
    throw new RagCorpusEmbeddingError({
      code:
        'SG-RAG-EMBED-INPUT-001',

      stage:
        'READ_INPUT',

      message:
        `입력 JSONL 파일이 없습니다: ${filePath}`
    });
  }


  const raw =
    await fs.readFile(
      filePath,
      'utf8'
    );


  const documents = [];


  const lines =
    raw.split(
      /\r?\n/
    );


  for (
    let index = 0;
    index <
      lines.length;
    index += 1
  ) {
    const line =
      lines[index]
        .trim();


    if (
      !line
    ) {
      continue;
    }


    try {
      const document =
        JSON.parse(
          line
        );

      documents.push(
        document
      );

    } catch (error) {

      throw new RagCorpusEmbeddingError({
        code:
          'SG-RAG-EMBED-INPUT-002',

        stage:
          'READ_INPUT',

        message:
          `JSONL 파싱 실패: line ${index + 1}`,

        detail:
          error.message,

        cause:
          error
      });
    }
  }


  return documents;
}


// ============================================================================
// Production eligibility
// ============================================================================

function productionEligibility(
  document
) {
  if (
    !document ||
    typeof document !==
      'object' ||
    Array.isArray(
      document
    )
  ) {
    return {
      eligible:
        false,

      reason:
        'invalid_document'
    };
  }


  if (
    document.corpus !==
      RAG_CORPUS
        .PRODUCTION
  ) {
    return {
      eligible:
        false,

      reason:
        'not_production'
    };
  }


  if (
    document.status !==
      RAG_DOCUMENT_STATUS
        .ACTIVE
  ) {
    return {
      eligible:
        false,

      reason:
        'inactive'
    };
  }


  if (
    document
      .reviewedManifest
      ?.isNegative ===
      true
  ) {
    return {
      eligible:
        false,

      reason:
        'negative'
    };
  }


  if (
    document
      .reviewedManifest
      ?.retrievalAllowed ===
      false
  ) {
    return {
      eligible:
        false,

      reason:
        'retrieval_disallowed'
    };
  }


  const validation =
    validateRagDocument(
      document
    );


  if (
    !validation.valid
  ) {
    return {
      eligible:
        false,

      reason:
        'schema_invalid',

      errors:
        validation.errors
    };
  }


  if (
    !cleanText(
      document
        .embeddingText
    )
  ) {
    return {
      eligible:
        false,

      reason:
        'embedding_text_missing'
    };
  }


  return {
    eligible:
      true,

    reason:
      null
  };
}


// ============================================================================
// Existing embedding reuse
// ============================================================================

function embeddingInputHash(
  document
) {
  return sha256(
    document
      .embeddingText
  );
}


function hasReusableEmbedding(
  embeddedDocument,
  sourceDocument,
  config
) {
  if (
    !embeddedDocument ||
    typeof embeddedDocument !==
      'object'
  ) {
    return false;
  }


  const embedding =
    embeddedDocument
      .embedding;


  if (
    !embedding ||
    embedding.provider !==
      'gemini'
  ) {
    return false;
  }


  if (
    embedding.model !==
      config.model
  ) {
    return false;
  }


  if (
    embedding.dimensions !==
      config.dimensions
  ) {
    return false;
  }


  if (
    !isFiniteVector(
      embedding.vector
    ) ||
    embedding.vector.length !==
      config.dimensions
  ) {
    return false;
  }


  const expectedHash =
    embeddingInputHash(
      sourceDocument
    );


  if (
    embeddedDocument
      .embeddingBuild
      ?.inputHash !==
      expectedHash
  ) {
    return false;
  }


  return true;
}


// ============================================================================
// Checkpoint
// ============================================================================

async function writeCheckpoint({
  outputPath,
  inputOrder,
  completedMap
}) {
  await ensureParent(
    outputPath
  );


  const completed =
    inputOrder
      .map(
        (document) =>
          completedMap.get(
            document.chunkId
          )
      )
      .filter(
        Boolean
      );


  const jsonl =
    completed
      .map(
        (document) =>
          JSON.stringify(
            document
          )
      )
      .join(
        '\n'
      ) +
    (
      completed.length >
        0
        ? '\n'
        : ''
    );


  const tempPath =
    `${outputPath}.tmp`;


  await fs.writeFile(
    tempPath,
    jsonl,
    'utf8'
  );


  if (
    await pathExists(
      outputPath
    )
  ) {
    await fs.rm(
      outputPath,
      {
        force:
          true
      }
    );
  }


  await fs.rename(
    tempPath,
    outputPath
  );
}


// ============================================================================
// Manifest
// ============================================================================

function countReasons(
  skipped
) {
  const result =
    {};


  for (
    const item of
    skipped
  ) {
    result[
      item.reason
    ] =
      (
        result[
          item.reason
        ] ||
        0
      ) + 1;
  }


  return result;
}


function buildManifest({
  config,
  inputCount,
  eligibleCount,
  reusedCount,
  newlyEmbeddedCount,
  remainingCount,
  skipped,
  completedDocuments,
  startedAt,
  finishedAt,
  limited
}) {
  return {
    schemaVersion:
      'rag_embedding_manifest_v1',

    scriptVersion:
      SCRIPT_VERSION,

    startedAt,
    finishedAt,

    inputFile:
      path.relative(
        PROJECT_ROOT,
        config.input
      ),

    outputFile:
      path.relative(
        PROJECT_ROOT,
        config.output
      ),

    embedding: {
      provider:
        'gemini',

      model:
        config.model,

      dimensions:
        config.dimensions,

      taskType:
        'RETRIEVAL_DOCUMENT',

      batchSize:
        config.batchSize,

      timeoutMs:
        config.timeoutMs,

      maxRetries:
        config.maxRetries
    },

    counts: {
      input:
        inputCount,

      eligible:
        eligibleCount,

      reused:
        reusedCount,

      newlyEmbedded:
        newlyEmbeddedCount,

      completed:
        completedDocuments.length,

      remaining:
        remainingCount,

      skipped:
        skipped.length
    },

    skippedByReason:
      countReasons(
        skipped
      ),

    run: {
      resume:
        config.resume,

      force:
        config.force,

      dryRun:
        config.dryRun,

      limit:
        config.limit,

      limited,

      complete:
        (
          remainingCount ===
          0
        )
    },

    policy: {
      productionOnly:
        true,

      activeOnly:
        true,

      retrievalAllowedOnly:
        true,

      negativeExcluded:
        true,

      metadataReclassification:
        false,

      engineFactRecalculation:
        false,

      checkpointEnabled:
        true
    }
  };
}


// ============================================================================
// Console summary
// ============================================================================

function printHeader(
  config
) {
  console.log('');
  console.log(
    '=============================================='
  );

  console.log(
    ' SajuGrap RAG Corpus Embedding'
  );

  console.log(
    '=============================================='
  );

  console.log(
    `model       : ${config.model}`
  );

  console.log(
    `dimensions  : ${config.dimensions}`
  );

  console.log(
    `batch size  : ${config.batchSize}`
  );

  console.log(
    `resume      : ${config.resume ? 'YES' : 'NO'}`
  );

  console.log(
    `force       : ${config.force ? 'YES' : 'NO'}`
  );

  console.log(
    `dry run     : ${config.dryRun ? 'YES' : 'NO'}`
  );

  console.log(
    '=============================================='
  );

  console.log('');
}


function printPlan({
  inputCount,
  eligibleCount,
  reusedCount,
  pendingCount,
  selectedPendingCount,
  skippedCount,
  config
}) {
  console.log(
    `[PLAN] input=${inputCount}`
  );

  console.log(
    `[PLAN] eligible=${eligibleCount}`
  );

  console.log(
    `[PLAN] reusable=${reusedCount}`
  );

  console.log(
    `[PLAN] pending=${pendingCount}`
  );

  console.log(
    `[PLAN] selected this run=${selectedPendingCount}`
  );

  console.log(
    `[PLAN] skipped=${skippedCount}`
  );


  const estimatedBatchCalls =
    selectedPendingCount >
      0
      ? Math.ceil(
          selectedPendingCount /
          config.batchSize
        )
      : 0;


  console.log(
    `[PLAN] estimated batch API calls=${estimatedBatchCalls}`
  );

  console.log('');
}


// ============================================================================
// Main
// ============================================================================

async function main() {
  await loadLocalEnvironment();


  const config =
    parseArgs(
      process.argv
        .slice(2)
    );


  const startedAt =
    new Date()
      .toISOString();


  printHeader(
    config
  );


  const inputDocuments =
    await readJsonl(
      config.input
    );


  if (
    inputDocuments.length ===
    0
  ) {
    throw new RagCorpusEmbeddingError({
      code:
        'SG-RAG-EMBED-INPUT-003',

      stage:
        'READ_INPUT',

      message:
        '입력 corpus가 비어 있습니다.'
    });
  }


  const skipped = [];
  const eligible = [];


  const seenChunkIds =
    new Set();


  for (
    const document of
    inputDocuments
  ) {
    const chunkId =
      cleanText(
        document
          ?.chunkId
      );


    if (!chunkId) {
      throw new RagCorpusEmbeddingError({
        code:
          'SG-RAG-EMBED-INPUT-004',

        stage:
          'VALIDATE_INPUT',

        message:
          'chunkId가 없는 문서가 있습니다.'
      });
    }


    if (
      seenChunkIds.has(
        chunkId
      )
    ) {
      throw new RagCorpusEmbeddingError({
        code:
          'SG-RAG-EMBED-INPUT-005',

        stage:
          'VALIDATE_INPUT',

        message:
          `중복 chunkId가 있습니다: ${chunkId}`
      });
    }


    seenChunkIds.add(
      chunkId
    );


    const eligibility =
      productionEligibility(
        document
      );


    if (
      eligibility.eligible
    ) {
      eligible.push(
        document
      );
    } else {
      skipped.push({
        chunkId,
        reason:
          eligibility.reason,

        errors:
          eligibility.errors ||
          null
      });
    }
  }


  // --------------------------------------------------------------------------
  // Existing checkpoint
  // --------------------------------------------------------------------------

  const existingMap =
    new Map();


  if (
    config.resume &&
    !config.force &&
    await pathExists(
      config.output
    )
  ) {
    const existingDocuments =
      await readJsonl(
        config.output
      );


    for (
      const document of
      existingDocuments
    ) {
      const chunkId =
        cleanText(
          document
            ?.chunkId
        );


      if (
        chunkId
      ) {
        existingMap.set(
          chunkId,
          document
        );
      }
    }
  }


  const completedMap =
    new Map();

  const pending = [];


  let reusedCount =
    0;


  for (
    const document of
    eligible
  ) {
    const existing =
      existingMap.get(
        document.chunkId
      );


    if (
      !config.force &&
      hasReusableEmbedding(
        existing,
        document,
        config
      )
    ) {
      completedMap.set(
        document.chunkId,
        existing
      );

      reusedCount +=
        1;

      continue;
    }


    pending.push(
      document
    );
  }


  const selectedPending =
    config.limit
      ? pending.slice(
          0,
          config.limit
        )
      : pending;


  printPlan({
    inputCount:
      inputDocuments.length,

    eligibleCount:
      eligible.length,

    reusedCount,

    pendingCount:
      pending.length,

    selectedPendingCount:
      selectedPending.length,

    skippedCount:
      skipped.length,

    config
  });


  // --------------------------------------------------------------------------
  // Dry run
  // --------------------------------------------------------------------------

  if (
    config.dryRun
  ) {
    const finishedAt =
      new Date()
        .toISOString();


    const manifest =
      buildManifest({
        config,

        inputCount:
          inputDocuments.length,

        eligibleCount:
          eligible.length,

        reusedCount,

        newlyEmbeddedCount:
          0,

        remainingCount:
          pending.length,

        skipped,

        completedDocuments:
          [
            ...completedMap.values()
          ],

        startedAt,
        finishedAt,

        limited:
          Boolean(
            config.limit &&
            pending.length >
              config.limit
          )
      });


    console.log(
      '[DRY RUN] Gemini API는 호출하지 않았습니다.'
    );

    console.log(
      JSON.stringify(
        manifest,
        null,
        2
      )
    );

    return;
  }


  // --------------------------------------------------------------------------
  // Environment key check
  // --------------------------------------------------------------------------

  if (
    !cleanText(
      process.env
        .GEMINI_API_KEY
    )
  ) {
    throw new RagCorpusEmbeddingError({
      code:
        'SG-RAG-EMBED-ENV-001',

      stage:
        'VALIDATE_ENV',

      message:
        'GEMINI_API_KEY가 현재 실행 환경에 없습니다.',

      detail:
        '.env.local, .env 또는 현재 shell 환경변수에 GEMINI_API_KEY를 설정하세요.'
    });
  }


  // --------------------------------------------------------------------------
  // If --no-resume or --force, start a fresh checkpoint.
  // --------------------------------------------------------------------------

  if (
    (
      !config.resume ||
      config.force
    ) &&
    await pathExists(
      config.output
    )
  ) {
    await fs.rm(
      config.output,
      {
        force:
          true
      }
    );
  }


  let newlyEmbeddedCount =
    0;


  // --------------------------------------------------------------------------
  // Embed batch by batch
  // --------------------------------------------------------------------------

  for (
    let start = 0;
    start <
      selectedPending.length;
    start +=
      config.batchSize
  ) {
    const batch =
      selectedPending.slice(
        start,
        start +
          config.batchSize
      );


    const batchNumber =
      Math.floor(
        start /
        config.batchSize
      ) + 1;


    const totalBatches =
      Math.ceil(
        selectedPending.length /
        config.batchSize
      );


    console.log(
      `[EMBED] batch ${batchNumber}/${totalBatches} · ${batch.length} chunk(s)`
    );


    let embeddedBatch;


    try {
      embeddedBatch =
        await attachEmbeddingsToRagDocuments(
          batch,
          {
            model:
              config.model,

            dimensions:
              config.dimensions,

            batchSize:
              config.batchSize,

            timeoutMs:
              config.timeoutMs,

            maxRetries:
              config.maxRetries
          }
        );

    } catch (error) {

      throw new RagCorpusEmbeddingError({
        code:
          error?.code ||
          'SG-RAG-EMBED-API-001',

        stage:
          error?.stage ||
          'EMBED_BATCH',

        message:
          `Embedding batch ${batchNumber} 실패: ${error?.message || String(error)}`,

        detail:
          error?.detail ||
          null,

        cause:
          error
      });
    }


    for (
      let index = 0;
      index <
        embeddedBatch.length;
      index += 1
    ) {
      const embeddedDocument =
        embeddedBatch[
          index
        ];

      const sourceDocument =
        batch[
          index
        ];


      if (
        !isFiniteVector(
          embeddedDocument
            .embedding
            ?.vector
        ) ||
        embeddedDocument
          .embedding
          .vector
          .length !==
          config.dimensions
      ) {
        throw new RagCorpusEmbeddingError({
          code:
            'SG-RAG-EMBED-OUTPUT-001',

          stage:
            'VALIDATE_EMBEDDED_DOCUMENT',

          message:
            `유효하지 않은 embedding vector입니다: ${sourceDocument.chunkId}`
        });
      }


      const withBuildMetadata = {
        ...embeddedDocument,

        embeddingBuild: {
          schemaVersion:
            'rag_embedding_build_v1',

          scriptVersion:
            SCRIPT_VERSION,

          inputField:
            'embeddingText',

          inputHash:
            embeddingInputHash(
              sourceDocument
            ),

          provider:
            'gemini',

          model:
            config.model,

          dimensions:
            config.dimensions,

          embeddedAt:
            embeddedDocument
              .embedding
              ?.embeddedAt ||
            new Date()
              .toISOString()
        }
      };


      completedMap.set(
        sourceDocument
          .chunkId,
        withBuildMetadata
      );


      newlyEmbeddedCount +=
        1;
    }


    // batch가 성공할 때마다 checkpoint 저장.
    await writeCheckpoint({
      outputPath:
        config.output,

      inputOrder:
        eligible,

      completedMap
    });


    console.log(
      `[CHECKPOINT] ${completedMap.size}/${eligible.length} completed`
    );
  }


  // --------------------------------------------------------------------------
  // Final manifest
  // --------------------------------------------------------------------------

  const completedDocuments =
    eligible
      .map(
        (document) =>
          completedMap.get(
            document.chunkId
          )
      )
      .filter(
        Boolean
      );


  const remainingCount =
    eligible.length -
    completedDocuments.length;


  const finishedAt =
    new Date()
      .toISOString();


  const manifest =
    buildManifest({
      config,

      inputCount:
        inputDocuments.length,

      eligibleCount:
        eligible.length,

      reusedCount,

      newlyEmbeddedCount,

      remainingCount,

      skipped,

      completedDocuments,

      startedAt,
      finishedAt,

      limited:
        Boolean(
          config.limit &&
          pending.length >
            selectedPending.length
        )
    });


  await ensureParent(
    config.manifest
  );


  await fs.writeFile(
    config.manifest,

    JSON.stringify(
      manifest,
      null,
      2
    ) +
    '\n',

    'utf8'
  );


  console.log('');
  console.log(
    '=============================================='
  );

  console.log(
    ' Embedding Build Complete'
  );

  console.log(
    '=============================================='
  );

  console.log(
    `eligible     : ${eligible.length}`
  );

  console.log(
    `reused       : ${reusedCount}`
  );

  console.log(
    `new embedded : ${newlyEmbeddedCount}`
  );

  console.log(
    `completed    : ${completedDocuments.length}`
  );

  console.log(
    `remaining    : ${remainingCount}`
  );

  console.log(
    `skipped      : ${skipped.length}`
  );

  console.log(
    `output       : ${config.output}`
  );

  console.log(
    `manifest     : ${config.manifest}`
  );

  console.log(
    '=============================================='
  );

  console.log('');


  if (
    remainingCount >
    0
  ) {
    console.log(
      '일부 chunk만 처리되었습니다.'
    );

    console.log(
      '같은 명령을 다시 실행하면 checkpoint에서 이어서 진행합니다.'
    );

    console.log('');
  }
}


// ============================================================================
// Error boundary
// ============================================================================

main()
  .catch(
    (error) => {
      console.error('');
      console.error(
        '=============================================='
      );

      console.error(
        ` ${error?.code || 'SG-RAG-EMBED-001'}`
      );

      console.error(
        ` stage: ${error?.stage || 'EMBED_RAG_CORPUS'}`
      );

      console.error(
        ` message: ${error?.message || String(error)}`
      );


      if (
        error?.detail
      ) {
        console.error(
          ` detail: ${error.detail}`
        );
      }


      console.error(
        '=============================================='
      );


      if (
        error?.stack
      ) {
        console.error(
          error.stack
        );
      }


      process.exitCode =
        1;
    }
  );
