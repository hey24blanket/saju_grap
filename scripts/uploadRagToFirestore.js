#!/usr/bin/env node
// scripts/uploadRagToFirestore.js
// SajuGrap Embedded RAG -> Firestore Uploader v1
// -----------------------------------------------------------------------------
// 역할
// - data/rag-corpus.embedded.production.jsonl 을 읽는다.
// - production + active + retrievalAllowed 문서만 허용한다.
// - embedding.vector를 Firestore Vector 타입으로 저장한다.
// - chunkId를 Firestore document ID로 사용해 재실행 시 안전하게 덮어쓴다.
// - evaluation / negative corpus는 업로드하지 않는다.
// - 업로드 결과 manifest를 로컬 data 폴더에 저장한다.
//
// 하지 않는 것
// - embedding 생성
// - RAG metadata 재분류
// - 사주 계산
// - Vector Index 생성
// - 기존 Firestore 문서 삭제
// -----------------------------------------------------------------------------

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  Firestore,
  FieldValue
} from '@google-cloud/firestore';


const SCRIPT_VERSION =
  '1.0.0';

const DEFAULT_COLLECTION =
  'sajugrap_rag_chunks';

const DEFAULT_BATCH_SIZE =
  100;

const EXPECTED_PROVIDER =
  'gemini';

const EXPECTED_DIMENSIONS =
  768;


// ============================================================================
// Paths
// ============================================================================

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
    'rag-corpus.embedded.production.jsonl'
  );

const DEFAULT_MANIFEST =
  path.join(
    PROJECT_ROOT,
    'data',
    'rag-corpus.firestore-upload.manifest.json'
  );


// ============================================================================
// Error
// ============================================================================

class RagFirestoreUploadError extends Error {
  constructor({
    code,
    stage,
    message,
    detail = null,
    cause = null
  }) {
    super(
      message
    );

    this.name =
      'RagFirestoreUploadError';

    this.code =
      code;

    this.stage =
      stage;

    this.detail =
      detail;

    if (
      cause
    ) {
      this.cause =
        cause;
    }
  }
}


// ============================================================================
// Helpers
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


function positiveInteger(
  value,
  fallback,
  {
    min = 1,
    max = 100000
  } = {}
) {
  const number =
    Number(
      value
    );

  if (
    !Number.isInteger(
      number
    ) ||
    number < min ||
    number > max
  ) {
    return fallback;
  }

  return number;
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
  targetPath
) {
  await fs.mkdir(
    path.dirname(
      targetPath
    ),
    {
      recursive:
        true
    }
  );
}


// ============================================================================
// Small .env loader
// ----------------------------------------------------------------------------
// dotenv dependency를 추가하지 않는다.
// process.env가 이미 가진 값은 덮어쓰지 않는다.
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
    return;
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
// CLI
// ============================================================================

function printHelp() {
  console.log(`
SajuGrap Firestore RAG Uploader v${SCRIPT_VERSION}

Usage:
  node scripts/uploadRagToFirestore.js [options]

Options:

  --input <path>
      Embedded production JSONL
      Default:
      data/rag-corpus.embedded.production.jsonl

  --collection <name>
      Firestore collection name
      Default:
      sajugrap_rag_chunks

  --manifest <path>
      Local upload manifest output

  --batch-size <number>
      Firestore writes per batch
      Default: 100

  --limit <number>
      Upload only first N eligible documents

  --dry-run
      Validate everything without connecting to Firestore

  --help
      Show this help

Examples:

  node scripts/uploadRagToFirestore.js --dry-run

  node scripts/uploadRagToFirestore.js --limit 5

  node scripts/uploadRagToFirestore.js
`);
}


function getDefaults() {
  return {
    input:
      DEFAULT_INPUT,

    manifest:
      DEFAULT_MANIFEST,

    collection:
      cleanText(
        process.env
          .RAG_FIRESTORE_COLLECTION
      ) ||
      DEFAULT_COLLECTION,

    batchSize:
      positiveInteger(
        process.env
          .RAG_FIRESTORE_BATCH_SIZE,
        DEFAULT_BATCH_SIZE,
        {
          min:
            1,

          max:
            500
        }
      ),

    limit:
      null,

    dryRun:
      false
  };
}


function parseArgs(
  argv
) {
  const config =
    getDefaults();


  function valueAfter(
    index,
    flag
  ) {
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
      throw new RagFirestoreUploadError({
        code:
          'SG-RAG-FIRESTORE-CLI-001',

        stage:
          'PARSE_ARGS',

        message:
          `${flag} requires a value.`
      });
    }

    return value;
  }


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


      case '--input':
        config.input =
          path.resolve(
            PROJECT_ROOT,
            valueAfter(
              index,
              arg
            )
          );

        index +=
          1;
        break;


      case '--manifest':
        config.manifest =
          path.resolve(
            PROJECT_ROOT,
            valueAfter(
              index,
              arg
            )
          );

        index +=
          1;
        break;


      case '--collection':
        config.collection =
          cleanText(
            valueAfter(
              index,
              arg
            )
          );

        index +=
          1;
        break;


      case '--batch-size':
        config.batchSize =
          positiveInteger(
            valueAfter(
              index,
              arg
            ),
            -1,
            {
              min:
                1,

              max:
                500
            }
          );

        index +=
          1;
        break;


      case '--limit':
        config.limit =
          positiveInteger(
            valueAfter(
              index,
              arg
            ),
            -1,
            {
              min:
                1,

              max:
                100000
            }
          );

        index +=
          1;
        break;


      default:
        throw new RagFirestoreUploadError({
          code:
            'SG-RAG-FIRESTORE-CLI-002',

          stage:
            'PARSE_ARGS',

          message:
            `Unknown option: ${arg}`
        });
    }
  }


  if (
    !config.collection
  ) {
    throw new RagFirestoreUploadError({
      code:
        'SG-RAG-FIRESTORE-CONFIG-001',

      stage:
        'VALIDATE_CONFIG',

      message:
        'Firestore collection name is empty.'
    });
  }


  if (
    config.collection.includes(
      '/'
    )
  ) {
    throw new RagFirestoreUploadError({
      code:
        'SG-RAG-FIRESTORE-CONFIG-002',

      stage:
        'VALIDATE_CONFIG',

      message:
        'Collection name must be a single collection ID without "/".'
    });
  }


  if (
    config.batchSize <
      1 ||
    config.batchSize >
      500
  ) {
    throw new RagFirestoreUploadError({
      code:
        'SG-RAG-FIRESTORE-CONFIG-003',

      stage:
        'VALIDATE_CONFIG',

      message:
        `Invalid batch size: ${config.batchSize}`
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
    throw new RagFirestoreUploadError({
      code:
        'SG-RAG-FIRESTORE-INPUT-001',

      stage:
        'READ_INPUT',

      message:
        `Embedded production JSONL was not found: ${filePath}`
    });
  }


  const raw =
    await fs.readFile(
      filePath,
      'utf8'
    );


  const documents =
    [];


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
      lines[
        index
      ].trim();

    if (
      !line
    ) {
      continue;
    }


    try {
      documents.push(
        JSON.parse(
          line
        )
      );

    } catch (
      error
    ) {
      throw new RagFirestoreUploadError({
        code:
          'SG-RAG-FIRESTORE-INPUT-002',

        stage:
          'PARSE_JSONL',

        message:
          `JSON parse failed at line ${index + 1}.`,

        detail:
          error.message,

        cause:
          error
      });
    }
  }


  return {
    raw,
    documents
  };
}


// ============================================================================
// Validation
// ============================================================================

function validateChunkId(
  chunkId
) {
  if (
    !chunkId
  ) {
    return false;
  }

  if (
    chunkId ===
      '.' ||
    chunkId ===
      '..'
  ) {
    return false;
  }

  if (
    chunkId.includes(
      '/'
    )
  ) {
    return false;
  }

  return true;
}


function validateEmbeddedDocument(
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
      valid:
        false,

      reason:
        'invalid_document'
    };
  }


  const chunkId =
    cleanText(
      document.chunkId
    );


  if (
    !validateChunkId(
      chunkId
    )
  ) {
    return {
      valid:
        false,

      reason:
        'invalid_chunk_id'
    };
  }


  if (
    document.corpus !==
      'production'
  ) {
    return {
      valid:
        false,

      reason:
        'not_production'
    };
  }


  if (
    document.status !==
      'active'
  ) {
    return {
      valid:
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
      valid:
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
      valid:
        false,

      reason:
        'retrieval_disallowed'
    };
  }


  const embedding =
    document.embedding;


  if (
    !embedding ||
    typeof embedding !==
      'object'
  ) {
    return {
      valid:
        false,

      reason:
        'embedding_missing'
    };
  }


  if (
    embedding.provider !==
      EXPECTED_PROVIDER
  ) {
    return {
      valid:
        false,

      reason:
        'embedding_provider_mismatch'
    };
  }


  if (
    embedding.dimensions !==
      EXPECTED_DIMENSIONS
  ) {
    return {
      valid:
        false,

      reason:
        'embedding_dimensions_mismatch'
    };
  }


  if (
    !isFiniteVector(
      embedding.vector
    )
  ) {
    return {
      valid:
        false,

      reason:
        'embedding_vector_invalid'
    };
  }


  if (
    embedding.vector.length !==
      embedding.dimensions
  ) {
    return {
      valid:
        false,

      reason:
        'embedding_vector_length_mismatch'
    };
  }


  return {
    valid:
      true,

    reason:
      null
  };
}


// ============================================================================
// Credentials / Firestore
// ============================================================================

async function resolveCredentials() {
  const explicitPath =
    cleanText(
      process.env
        .GOOGLE_APPLICATION_CREDENTIALS
    ) ||
    cleanText(
      process.env
        .FIREBASE_SERVICE_ACCOUNT_PATH
    );


  let projectId =
    cleanText(
      process.env
        .FIREBASE_PROJECT_ID
    ) ||
    cleanText(
      process.env
        .GOOGLE_CLOUD_PROJECT
    ) ||
    cleanText(
      process.env
        .GCLOUD_PROJECT
    );


  let keyFilename =
    null;


  if (
    explicitPath
  ) {
    keyFilename =
      path.isAbsolute(
        explicitPath
      )
        ? explicitPath
        : path.resolve(
            PROJECT_ROOT,
            explicitPath
          );


    if (
      !(await pathExists(
        keyFilename
      ))
    ) {
      throw new RagFirestoreUploadError({
        code:
          'SG-RAG-FIRESTORE-AUTH-001',

        stage:
          'RESOLVE_CREDENTIALS',

        message:
          'Service account JSON file was not found.',

        detail:
          keyFilename
      });
    }


    try {
      const serviceAccount =
        JSON.parse(
          await fs.readFile(
            keyFilename,
            'utf8'
          )
        );


      if (
        !projectId
      ) {
        projectId =
          cleanText(
            serviceAccount
              .project_id
          );
      }

    } catch (
      error
    ) {
      throw new RagFirestoreUploadError({
        code:
          'SG-RAG-FIRESTORE-AUTH-002',

        stage:
          'RESOLVE_CREDENTIALS',

        message:
          'Service account JSON could not be read.',

        detail:
          error.message,

        cause:
          error
      });
    }
  }


  return {
    projectId,
    keyFilename
  };
}


async function createFirestoreClient() {
  const {
    projectId,
    keyFilename
  } =
    await resolveCredentials();


  const options =
    {};


  if (
    projectId
  ) {
    options.projectId =
      projectId;
  }


  if (
    keyFilename
  ) {
    options.keyFilename =
      keyFilename;
  }


  try {
    return {
      db:
        new Firestore(
          options
        ),

      projectId:
        projectId ||
        null,

      credentialMode:
        keyFilename
          ? 'service_account_file'
          : 'application_default_credentials'
    };

  } catch (
    error
  ) {
    throw new RagFirestoreUploadError({
      code:
        'SG-RAG-FIRESTORE-AUTH-003',

      stage:
        'CREATE_FIRESTORE_CLIENT',

      message:
        'Failed to initialize Firestore client.',

      detail:
        error.message,

      cause:
        error
    });
  }
}


// ============================================================================
// Firestore payload
// ============================================================================

function buildFirestorePayload(
  document
) {
  const vector =
    document
      .embedding
      .vector;


  const safeEmbedding =
    {
      provider:
        document
          .embedding
          .provider,

      model:
        document
          .embedding
          .model,

      dimensions:
        document
          .embedding
          .dimensions,

      embeddedAt:
        document
          .embedding
          .embeddedAt ||
        null
    };


  return {
    ...document,

    embedding:
      safeEmbedding,

    embeddingVector:
      FieldValue.vector(
        vector
      ),

    firestoreMeta: {
      uploadedBy:
        'scripts/uploadRagToFirestore.js',

      uploadScriptVersion:
        SCRIPT_VERSION,

      uploadedAt:
        new Date()
          .toISOString()
    }
  };
}


// ============================================================================
// Manifest
// ============================================================================

function countByReason(
  skipped
) {
  const counts =
    {};


  for (
    const item of
    skipped
  ) {
    counts[
      item.reason
    ] =
      (
        counts[
          item.reason
        ] ||
        0
      ) + 1;
  }


  return counts;
}


async function writeManifest(
  filePath,
  manifest
) {
  await ensureParent(
    filePath
  );


  await fs.writeFile(
    filePath,

    JSON.stringify(
      manifest,
      null,
      2
    ) +
    '\n',

    'utf8'
  );
}


// ============================================================================
// Main
// ============================================================================

async function main() {
  await loadLocalEnvironment();


  const config =
    parseArgs(
      process.argv
        .slice(
          2
        )
    );


  const startedAt =
    new Date()
      .toISOString();


  console.log('');
  console.log(
    '=============================================='
  );

  console.log(
    ' SajuGrap Firestore RAG Upload'
  );

  console.log(
    '=============================================='
  );

  console.log(
    `input      : ${config.input}`
  );

  console.log(
    `collection : ${config.collection}`
  );

  console.log(
    `batch size : ${config.batchSize}`
  );

  console.log(
    `dry run    : ${config.dryRun ? 'YES' : 'NO'}`
  );

  console.log(
    '=============================================='
  );

  console.log('');


  const {
    raw,
    documents
  } =
    await readJsonl(
      config.input
    );


  if (
    documents.length ===
      0
  ) {
    throw new RagFirestoreUploadError({
      code:
        'SG-RAG-FIRESTORE-INPUT-003',

      stage:
        'VALIDATE_INPUT',

      message:
        'Embedded production corpus is empty.'
    });
  }


  const seenChunkIds =
    new Set();

  const eligible =
    [];

  const skipped =
    [];


  for (
    const document of
    documents
  ) {
    const chunkId =
      cleanText(
        document
          ?.chunkId
      );


    if (
      seenChunkIds.has(
        chunkId
      )
    ) {
      throw new RagFirestoreUploadError({
        code:
          'SG-RAG-FIRESTORE-INPUT-004',

        stage:
          'VALIDATE_INPUT',

        message:
          `Duplicate chunkId found: ${chunkId}`
      });
    }


    seenChunkIds.add(
      chunkId
    );


    const validation =
      validateEmbeddedDocument(
        document
      );


    if (
      validation.valid
    ) {
      eligible.push(
        document
      );
    } else {
      skipped.push({
        chunkId:
          chunkId ||
          null,

        reason:
          validation.reason
      });
    }
  }


  const selected =
    config.limit
      ? eligible.slice(
          0,
          config.limit
        )
      : eligible;


  const totalBatches =
    selected.length >
      0
      ? Math.ceil(
          selected.length /
          config.batchSize
        )
      : 0;


  console.log(
    `[PLAN] input=${documents.length}`
  );

  console.log(
    `[PLAN] eligible=${eligible.length}`
  );

  console.log(
    `[PLAN] selected=${selected.length}`
  );

  console.log(
    `[PLAN] skipped=${skipped.length}`
  );

  console.log(
    `[PLAN] write batches=${totalBatches}`
  );

  console.log(
    `[PLAN] vector dimensions=${EXPECTED_DIMENSIONS}`
  );

  console.log('');


  if (
    config.dryRun
  ) {
    const finishedAt =
      new Date()
        .toISOString();


    const manifest = {
      schemaVersion:
        'rag_firestore_upload_manifest_v1',

      scriptVersion:
        SCRIPT_VERSION,

      startedAt,
      finishedAt,

      dryRun:
        true,

      inputFile:
        path.relative(
          PROJECT_ROOT,
          config.input
        ),

      inputSha256:
        sha256(
          raw
        ),

      collection:
        config.collection,

      vectorField:
        'embeddingVector',

      counts: {
        input:
          documents.length,

        eligible:
          eligible.length,

        selected:
          selected.length,

        uploaded:
          0,

        skipped:
          skipped.length
      },

      skippedByReason:
        countByReason(
          skipped
        )
    };


    console.log(
      '[DRY RUN] Firestore was not contacted.'
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


  const {
    db,
    projectId,
    credentialMode
  } =
    await createFirestoreClient();


  console.log(
    `[AUTH] mode=${credentialMode}`
  );

  console.log(
    `[AUTH] project=${projectId || 'auto-detect'}`
  );

  console.log('');


  const collection =
    db.collection(
      config.collection
    );


  let uploaded =
    0;


  for (
    let start = 0;
    start <
      selected.length;
    start +=
      config.batchSize
  ) {
    const chunk =
      selected.slice(
        start,
        start +
          config.batchSize
      );


    const batchNumber =
      Math.floor(
        start /
        config.batchSize
      ) +
      1;


    console.log(
      `[UPLOAD] batch ${batchNumber}/${totalBatches} · ${chunk.length} document(s)`
    );


    const batch =
      db.batch();


    for (
      const document of
      chunk
    ) {
      const ref =
        collection.doc(
          document.chunkId
        );


      batch.set(
        ref,
        buildFirestorePayload(
          document
        ),
        {
          merge:
            false
        }
      );
    }


    try {
      await batch.commit();

    } catch (
      error
    ) {
      throw new RagFirestoreUploadError({
        code:
          'SG-RAG-FIRESTORE-WRITE-001',

        stage:
          'BATCH_COMMIT',

        message:
          `Firestore upload batch ${batchNumber} failed.`,

        detail:
          error.message,

        cause:
          error
      });
    }


    uploaded +=
      chunk.length;


    console.log(
      `[OK] uploaded ${uploaded}/${selected.length}`
    );
  }


  const finishedAt =
    new Date()
      .toISOString();


  const manifest = {
    schemaVersion:
      'rag_firestore_upload_manifest_v1',

    scriptVersion:
      SCRIPT_VERSION,

    startedAt,
    finishedAt,

    dryRun:
      false,

    inputFile:
      path.relative(
        PROJECT_ROOT,
        config.input
      ),

    inputSha256:
      sha256(
        raw
      ),

    collection:
      config.collection,

    vectorField:
      'embeddingVector',

    embedding: {
      provider:
        EXPECTED_PROVIDER,

      dimensions:
        EXPECTED_DIMENSIONS
    },

    firestore: {
      projectId:
        projectId ||
        null,

      credentialMode
    },

    counts: {
      input:
        documents.length,

      eligible:
        eligible.length,

      selected:
        selected.length,

      uploaded,

      skipped:
        skipped.length
    },

    skippedByReason:
      countByReason(
        skipped
      ),

    run: {
      limit:
        config.limit,

      complete:
        (
          uploaded ===
          eligible.length
        )
    }
  };


  await writeManifest(
    config.manifest,
    manifest
  );


  console.log('');
  console.log(
    '=============================================='
  );

  console.log(
    ' Firestore Upload Complete'
  );

  console.log(
    '=============================================='
  );

  console.log(
    `eligible : ${eligible.length}`
  );

  console.log(
    `uploaded : ${uploaded}`
  );

  console.log(
    `skipped  : ${skipped.length}`
  );

  console.log(
    `project  : ${projectId || 'auto-detect'}`
  );

  console.log(
    `collection: ${config.collection}`
  );

  console.log(
    `vector field: embeddingVector`
  );

  console.log(
    `manifest: ${config.manifest}`
  );

  console.log(
    '=============================================='
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
        '=============================================='
      );

      console.error(
        ` ${error?.code || 'SG-RAG-FIRESTORE-001'}`
      );

      console.error(
        ` stage: ${error?.stage || 'FIRESTORE_UPLOAD'}`
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