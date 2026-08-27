// lib/ragRetriever.js
// SajuGrap Firestore Vector RAG Retriever v1
// -----------------------------------------------------------------------------
// 역할
// 1. ragQueryBuilder가 만든 RAG Query Packet을 입력으로 받는다.
// 2. semanticQuery를 RETRIEVAL_QUERY embedding으로 변환한다.
// 3. Firestore sajugrap_rag_chunks에서 COSINE nearest-neighbor 검색한다.
// 4. hardFilters는 현재 single-field vector index 단계에서는 안전하게
//    application-side post-filter로 적용한다.
// 5. softFilters / priority는 reranking boost에만 사용한다.
// 6. LLM에 전달할 검색 지식 packet / context text를 만든다.
//
// 절대 하지 않는 것
// - 사주 계산
// - Engine Facts 재계산/보정
// - 검색 문서에서 누락된 명리 Fact 추론
// - evaluation_negative corpus 사용
// - diagnostics를 검색 조건으로 사용
//
// 현재 인덱스
// collection : sajugrap_rag_chunks
// vectorField: embeddingVector
// dimensions : 768
// distance   : COSINE
// -----------------------------------------------------------------------------

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  Firestore
} from '@google-cloud/firestore';

import {
  embedQuery
} from './embeddingProvider.js';

import {
  buildRagQuery,
  validateRagQuery
} from './ragQueryBuilder.js';


export const RAG_RETRIEVER_SCHEMA_VERSION =
  'rag_retriever_v1';

export const RAG_RETRIEVER_VERSION =
  '1.0.0';

export const DEFAULT_RAG_COLLECTION =
  process.env.RAG_FIRESTORE_COLLECTION ||
  'sajugrap_rag_chunks';

export const DEFAULT_RAG_MANAGER_COLLECTION =
  process.env.RAG_MANAGER_COLLECTION ||
  'sajugrap_rag_manager';

export const DEFAULT_VECTOR_FIELD =
  'embeddingVector';

export const DEFAULT_DISTANCE_RESULT_FIELD =
  '__vectorDistance';

export const DEFAULT_DISTANCE_MEASURE =
  'COSINE';

export const DEFAULT_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL ||
  'gemini-embedding-2';

export const DEFAULT_EMBEDDING_DIMENSIONS =
  Number(
    process.env.RAG_EMBEDDING_DIMENSIONS ||
    768
  );

export const DEFAULT_TARGET_RESULTS =
  6;

export const DEFAULT_MAX_RESULTS =
  10;

export const DEFAULT_CANDIDATE_LIMIT =
  80;

export const MAX_CANDIDATE_LIMIT =
  200;


// ============================================================================
// Error
// ============================================================================

export class RagRetrieverError extends Error {
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
      'RagRetrieverError';

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


function safeObject(
  value
) {
  return (
    value &&
    typeof value ===
      'object' &&
    !Array.isArray(
      value
    )
  )
    ? value
    : {};
}


function clamp(
  value,
  min,
  max
) {
  return Math.max(
    min,
    Math.min(
      max,
      value
    )
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


function uniqueStrings(
  values
) {
  return [
    ...new Set(
      safeArray(
        values
      )
        .map(
          (value) =>
            cleanText(
              value,
              300
            )
        )
        .filter(
          Boolean
        )
    )
  ];
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


function normalizeComparable(
  value
) {
  if (
    typeof value ===
      'string'
  ) {
    return value
      .trim()
      .toLowerCase();
  }

  if (
    typeof value ===
      'number' ||
    typeof value ===
      'boolean'
  ) {
    return String(
      value
    );
  }

  return null;
}


function flattenValues(
  value
) {
  if (
    value ===
      null ||
    value ===
      undefined
  ) {
    return [];
  }

  if (
    Array.isArray(
      value
    )
  ) {
    return value.flatMap(
      flattenValues
    );
  }

  if (
    typeof value ===
      'object'
  ) {
    return Object.entries(
      value
    )
      .flatMap(
        ([key, item]) => [
          `${key}:${normalizeComparable(item) ?? ''}`,
          ...flattenValues(
            item
          )
        ]
      )
      .filter(
        Boolean
      );
  }

  const normalized =
    normalizeComparable(
      value
    );

  return normalized
    ? [
        normalized
      ]
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


// ============================================================================
// Firestore credentials
// ----------------------------------------------------------------------------
// Local:
//   GOOGLE_APPLICATION_CREDENTIALS=secrets/firebase-service-account.json
//
// Vercel 추천:
//   FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account", ...}
//
// 또는:
//   FIREBASE_PROJECT_ID=...
//   FIREBASE_CLIENT_EMAIL=...
//   FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END...
//
// 아무 것도 명시되지 않으면 Application Default Credentials를 사용한다.
// ============================================================================

let firestoreSingleton =
  null;

let firestoreSingletonKey =
  null;


function normalizePrivateKey(
  value
) {
  return cleanText(
    value,
    20000
  ).replace(
    /\\n/g,
    '\n'
  );
}


function parseServiceAccountJson(
  raw
) {
  const text =
    cleanText(
      raw,
      50000
    );

  if (
    !text
  ) {
    return null;
  }

  try {
    const parsed =
      JSON.parse(
        text
      );

    return parsed &&
      typeof parsed ===
        'object'
      ? parsed
      : null;

  } catch (
    error
  ) {
    throw new RagRetrieverError({
      code:
        'SG-RAG-RETRIEVER-AUTH-001',

      stage:
        'PARSE_SERVICE_ACCOUNT_JSON',

      message:
        'FIREBASE_SERVICE_ACCOUNT_JSON 형식을 읽을 수 없습니다.',

      detail:
        error.message,

      cause:
        error
    });
  }
}


async function readServiceAccountFile(
  filePath
) {
  if (
    !filePath
  ) {
    return null;
  }

  const absolutePath =
    path.isAbsolute(
      filePath
    )
      ? filePath
      : path.resolve(
          process.cwd(),
          filePath
        );

  if (
    !(await pathExists(
      absolutePath
    ))
  ) {
    throw new RagRetrieverError({
      code:
        'SG-RAG-RETRIEVER-AUTH-002',

      stage:
        'READ_SERVICE_ACCOUNT_FILE',

      message:
        'Firebase service account JSON 파일을 찾을 수 없습니다.',

      detail:
        absolutePath
    });
  }

  try {
    const text =
      await fs.readFile(
        absolutePath,
        'utf8'
      );

    return JSON.parse(
      text
    );

  } catch (
    error
  ) {
    throw new RagRetrieverError({
      code:
        'SG-RAG-RETRIEVER-AUTH-003',

      stage:
        'READ_SERVICE_ACCOUNT_FILE',

      message:
        'Firebase service account JSON 파일을 읽을 수 없습니다.',

      detail:
        error.message,

      cause:
        error
    });
  }
}


async function resolveFirestoreAuth() {
  const envJson =
    parseServiceAccountJson(
      process.env
        .FIREBASE_SERVICE_ACCOUNT_JSON
    );

  if (
    envJson
  ) {
    const projectId =
      cleanText(
        envJson.project_id,
        300
      ) ||
      cleanText(
        process.env
          .FIREBASE_PROJECT_ID,
        300
      );

    const clientEmail =
      cleanText(
        envJson.client_email,
        500
      );

    const privateKey =
      normalizePrivateKey(
        envJson.private_key
      );

    if (
      !projectId ||
      !clientEmail ||
      !privateKey
    ) {
      throw new RagRetrieverError({
        code:
          'SG-RAG-RETRIEVER-AUTH-004',

        stage:
          'RESOLVE_FIRESTORE_AUTH',

        message:
          'FIREBASE_SERVICE_ACCOUNT_JSON에 필수 인증 값이 없습니다.',

        detail:
          'Required: project_id, client_email, private_key'
      });
    }

    return {
      mode:
        'service_account_json_env',

      projectId,

      options: {
        projectId,

        credentials: {
          client_email:
            clientEmail,

          private_key:
            privateKey
        }
      }
    };
  }


  const credentialPath =
    cleanText(
      process.env
        .GOOGLE_APPLICATION_CREDENTIALS,
      2000
    ) ||
    cleanText(
      process.env
        .FIREBASE_SERVICE_ACCOUNT_PATH,
      2000
    );

  if (
    credentialPath
  ) {
    const account =
      await readServiceAccountFile(
        credentialPath
      );

    const projectId =
      cleanText(
        process.env
          .FIREBASE_PROJECT_ID,
        300
      ) ||
      cleanText(
        account
          ?.project_id,
        300
      );

    const clientEmail =
      cleanText(
        account
          ?.client_email,
        500
      );

    const privateKey =
      normalizePrivateKey(
        account
          ?.private_key
      );

    if (
      !projectId ||
      !clientEmail ||
      !privateKey
    ) {
      throw new RagRetrieverError({
        code:
          'SG-RAG-RETRIEVER-AUTH-005',

        stage:
          'RESOLVE_FIRESTORE_AUTH',

        message:
          'Service account 파일의 필수 인증 값이 누락되었습니다.',

        detail:
          'Required: project_id, client_email, private_key'
      });
    }

    return {
      mode:
        'service_account_file',

      projectId,

      options: {
        projectId,

        credentials: {
          client_email:
            clientEmail,

          private_key:
            privateKey
        }
      }
    };
  }


  const projectId =
    cleanText(
      process.env
        .FIREBASE_PROJECT_ID,
      300
    ) ||
    cleanText(
      process.env
        .GOOGLE_CLOUD_PROJECT,
      300
    ) ||
    cleanText(
      process.env
        .GCLOUD_PROJECT,
      300
    );

  const clientEmail =
    cleanText(
      process.env
        .FIREBASE_CLIENT_EMAIL,
      500
    );

  const privateKey =
    normalizePrivateKey(
      process.env
        .FIREBASE_PRIVATE_KEY
    );

  if (
    projectId &&
    clientEmail &&
    privateKey
  ) {
    return {
      mode:
        'service_account_split_env',

      projectId,

      options: {
        projectId,

        credentials: {
          client_email:
            clientEmail,

          private_key:
            privateKey
        }
      }
    };
  }


  return {
    mode:
      'application_default_credentials',

    projectId:
      projectId ||
      null,

    options:
      projectId
        ? {
            projectId
          }
        : {}
  };
}


export async function getFirestoreClient({
  forceNew = false
} = {}) {
  const auth =
    await resolveFirestoreAuth();

  const singletonKey =
    JSON.stringify({
      mode:
        auth.mode,

      projectId:
        auth.projectId
    });

  if (
    !forceNew &&
    firestoreSingleton &&
    firestoreSingletonKey ===
      singletonKey
  ) {
    return {
      db:
        firestoreSingleton,

      auth: {
        mode:
          auth.mode,

        projectId:
          auth.projectId
      }
    };
  }

  try {
    const db =
      new Firestore(
        auth.options
      );

    if (
      !forceNew
    ) {
      firestoreSingleton =
        db;

      firestoreSingletonKey =
        singletonKey;
    }

    return {
      db,

      auth: {
        mode:
          auth.mode,

        projectId:
          auth.projectId
      }
    };

  } catch (
    error
  ) {
    throw new RagRetrieverError({
      code:
        'SG-RAG-RETRIEVER-AUTH-006',

      stage:
        'CREATE_FIRESTORE_CLIENT',

      message:
        'Firestore client 생성에 실패했습니다.',

      detail:
        error.message,

      cause:
        error
    });
  }
}


// ============================================================================
// RAG Query Packet validation
// ============================================================================

function assertRagQueryPacket(
  packet
) {
  const validation =
    validateRagQuery(
      packet
    );

  if (
    !validation.valid
  ) {
    throw new RagRetrieverError({
      code:
        'SG-RAG-RETRIEVER-QUERY-001',

      stage:
        'VALIDATE_RAG_QUERY',

      message:
        'RAG Query Packet 검증에 실패했습니다.',

      detail:
        validation.errors
          .join(
            ', '
          )
    });
  }

  const semanticQuery =
    cleanText(
      packet
        ?.query
        ?.semanticQuery,
      30000
    );

  if (
    !semanticQuery
  ) {
    throw new RagRetrieverError({
      code:
        'SG-RAG-RETRIEVER-QUERY-002',

      stage:
        'VALIDATE_RAG_QUERY',

      message:
        'semanticQuery가 비어 있습니다.'
    });
  }

  return semanticQuery;
}


// ============================================================================
// Query embedding
// ============================================================================

function extractEmbeddingVector(
  result
) {
  if (
    isFiniteVector(
      result
    )
  ) {
    return result;
  }

  const candidates = [
    result
      ?.vector,

    result
      ?.values,

    result
      ?.embedding
      ?.vector,

    result
      ?.embedding
      ?.values
  ];

  for (
    const candidate of
    candidates
  ) {
    if (
      isFiniteVector(
        candidate
      )
    ) {
      return candidate;
    }
  }

  return null;
}


async function buildQueryVector(
  semanticQuery,
  {
    model,
    dimensions
  }
) {
  let result;

  try {
    result =
      await embedQuery(
        semanticQuery,
        {
          model,
          dimensions
        }
      );

  } catch (
    error
  ) {
    throw new RagRetrieverError({
      code:
        error?.code ||
        'SG-RAG-RETRIEVER-EMBED-001',

      stage:
        error?.stage ||
        'EMBED_QUERY',

      message:
        'RAG 검색 query embedding 생성에 실패했습니다.',

      detail:
        error?.message ||
        String(
          error
        ),

      cause:
        error
    });
  }

  const vector =
    extractEmbeddingVector(
      result
    );

  if (
    !vector
  ) {
    throw new RagRetrieverError({
      code:
        'SG-RAG-RETRIEVER-EMBED-002',

      stage:
        'VALIDATE_QUERY_VECTOR',

      message:
        'Embedding provider 응답에서 query vector를 찾을 수 없습니다.'
    });
  }

  if (
    vector.length !==
      dimensions
  ) {
    throw new RagRetrieverError({
      code:
        'SG-RAG-RETRIEVER-EMBED-003',

      stage:
        'VALIDATE_QUERY_VECTOR',

      message:
        'Query vector dimensions가 Firestore index와 일치하지 않습니다.',

      detail:
        `received=${vector.length}, expected=${dimensions}`
    });
  }

  return vector;
}


// ============================================================================
// Document metadata adapter
// ============================================================================

function fieldAliases(
  field
) {
  switch (
    field
  ) {
    case 'domain':
      return [
        'domain',
        'domains'
      ];

    case 'cycleType':
      return [
        'cycleType',
        'cycleTypes',
        'cycle',
        'cycles'
      ];

    case 'starIds':
      return [
        'starIds',
        'stars'
      ];

    case 'relationTypes':
      return [
        'relationTypes',
        'relations'
      ];

    case 'yongsinMechanisms':
      return [
        'yongsinMechanisms',
        'mechanisms'
      ];

    default:
      return [
        field
      ];
  }
}


function collectFieldValues(
  document,
  field
) {
  const aliases =
    fieldAliases(
      field
    );

  const containers = [
    document,

    document
      ?.metadata,

    document
      ?.retrieval,

    document
      ?.selectors,

    document
      ?.ragMetadata,

    document
      ?.filters
  ]
    .map(
      safeObject
    );


  const values =
    [];


  for (
    const container of
    containers
  ) {
    for (
      const alias of
      aliases
    ) {
      if (
        container[
          alias
        ] !==
        undefined
      ) {
        values.push(
          container[
            alias
          ]
        );
      }
    }
  }


  const knownNested = {
    strengthBand: [
      document
        ?.strengthBand,
      document
        ?.selectors
        ?.strengthBand
    ],

    dominantImbalance: [
      document
        ?.dominantImbalance,
      document
        ?.selectors
        ?.dominantImbalance
    ],

    yongsinElement: [
      document
        ?.yongsinElement,
      document
        ?.selectors
        ?.yongsinElement
    ],

    tenGodGroupBands: [
      document
        ?.tenGodGroupBands,
      document
        ?.selectors
        ?.tenGodGroupBands
    ],

    cycleTenGodGroup: [
      document
        ?.cycleTenGodGroup,
      document
        ?.selectors
        ?.cycleTenGodGroup
    ],

    twelveStageKey: [
      document
        ?.twelveStageKey,
      document
        ?.selectors
        ?.twelveStageKey
    ],

    balanceEffect: [
      document
        ?.balanceEffect,
      document
        ?.selectors
        ?.balanceEffect
    ],

    cycleRelationTypes: [
      document
        ?.cycleRelationTypes,
      document
        ?.selectors
        ?.cycleRelationTypes
    ]
  };


  if (
    knownNested[
      field
    ]
  ) {
    values.push(
      ...knownNested[
        field
      ]
    );
  }


  return values
    .flatMap(
      flattenValues
    );
}


// ============================================================================
// Hard filters
// ============================================================================

function documentMatchesHardFilter(
  document,
  filter
) {
  const field =
    cleanText(
      filter
        ?.field,
      200
    );

  const op =
    cleanText(
      filter
        ?.op,
      50
    ).toLowerCase();

  if (
    !field
  ) {
    return true;
  }

  const documentValues =
    collectFieldValues(
      document,
      field
    );

  const requestedValues =
    flattenValues(
      filter
        ?.value
    );

  if (
    op ===
      'in'
  ) {
    if (
      requestedValues.length ===
        0
    ) {
      return true;
    }

    return requestedValues.some(
      (requested) =>
        documentValues.includes(
          requested
        )
    );
  }


  if (
    op ===
      '=='
  ) {
    if (
      requestedValues.length ===
        0
    ) {
      return true;
    }

    return documentValues.includes(
      requestedValues[
        0
      ]
    );
  }


  return true;
}


function matchesAllHardFilters(
  document,
  hardFilters
) {
  return safeArray(
    hardFilters
  ).every(
    (filter) =>
      documentMatchesHardFilter(
        document,
        filter
      )
  );
}


// ============================================================================
// Soft filter reranking
// ============================================================================

function objectMatchRatio(
  documentValue,
  requestedObject
) {
  if (
    !requestedObject ||
    typeof requestedObject !==
      'object' ||
    Array.isArray(
      requestedObject
    )
  ) {
    return 0;
  }

  const entries =
    Object.entries(
      requestedObject
    );

  if (
    entries.length ===
      0
  ) {
    return 0;
  }

  const docFlat =
    flattenValues(
      documentValue
    );

  let matched =
    0;

  for (
    const [
      key,
      value
    ] of
    entries
  ) {
    const normalizedPair =
      `${key}:${normalizeComparable(value) ?? ''}`;

    if (
      docFlat.includes(
        normalizedPair
      )
    ) {
      matched +=
        1;
    }
  }

  return matched /
    entries.length;
}


function softFilterMatchRatio(
  document,
  filter
) {
  const field =
    cleanText(
      filter
        ?.field,
      200
    );

  const requested =
    filter
      ?.value;

  if (
    !field ||
    requested ===
      null ||
    requested ===
      undefined
  ) {
    return 0;
  }


  if (
    requested &&
    typeof requested ===
      'object' &&
    !Array.isArray(
      requested
    )
  ) {
    const aliases =
      fieldAliases(
        field
      );

    const candidateObjects = [
      document?.[field],
      document?.metadata?.[field],
      document?.retrieval?.[field],
      document?.selectors?.[field]
    ];

    for (
      const alias of
      aliases
    ) {
      candidateObjects.push(
        document?.[alias],
        document?.metadata?.[alias],
        document?.retrieval?.[alias],
        document?.selectors?.[alias]
      );
    }

    let best =
      0;

    for (
      const value of
      candidateObjects
    ) {
      best =
        Math.max(
          best,
          objectMatchRatio(
            value,
            requested
          )
        );
    }

    return best;
  }


  const documentValues =
    collectFieldValues(
      document,
      field
    );

  const requestedValues =
    flattenValues(
      requested
    );

  if (
    requestedValues.length ===
      0 ||
    documentValues.length ===
      0
  ) {
    return 0;
  }


  const matched =
    requestedValues.filter(
      (value) =>
        documentValues.includes(
          value
        )
    ).length;


  return matched /
    requestedValues.length;
}


function calculateMetadataScore(
  document,
  softFilters
) {
  let weightedScore =
    0;

  let totalWeight =
    0;

  const matches =
    [];


  for (
    const filter of
    safeArray(
      softFilters
    )
  ) {
    const weight =
      Number.isFinite(
        Number(
          filter?.weight
        )
      )
        ? Math.max(
            0,
            Number(
              filter.weight
            )
          )
        : 0;


    if (
      weight <=
        0
    ) {
      continue;
    }


    const ratio =
      softFilterMatchRatio(
        document,
        filter
      );


    weightedScore +=
      ratio *
      weight;

    totalWeight +=
      weight;


    if (
      ratio >
        0
    ) {
      matches.push({
        field:
          filter.field,

        ratio:
          Number(
            ratio.toFixed(
              4
            )
          ),

        weight
      });
    }
  }


  return {
    score:
      totalWeight >
        0
        ? weightedScore /
          totalWeight
        : 0,

    matches
  };
}


// ============================================================================
// Priority
// ============================================================================

function normalizedPriority(
  document
) {
  const values = [
    document
      ?.priority,

    document
      ?.metadata
      ?.priority,

    document
      ?.reviewedManifest
      ?.priority
  ];


  for (
    const value of
    values
  ) {
    const number =
      Number(
        value
      );

    if (
      Number.isFinite(
        number
      )
    ) {
      return clamp(
        number /
          100,
        0,
        1
      );
    }
  }


  return 0.5;
}


// ============================================================================
// Safe result projection
// ============================================================================

function firstNonEmptyText(
  values,
  maxLength
) {
  for (
    const value of
    values
  ) {
    const text =
      cleanText(
        value,
        maxLength
      );

    if (
      text
    ) {
      return text;
    }
  }

  return '';
}


function safeSource(
  document
) {
  return {
    documentId:
      document
        ?.documentId ||
      document
        ?.reviewedManifest
        ?.documentId ||
      null,

    documentName:
      document
        ?.documentName ||
      document
        ?.reviewedManifest
        ?.documentName ||
      null,

    sourcePdf:
      document
        ?.sourcePdf ||
      document
        ?.reviewedManifest
        ?.sourcePdf ||
      null,

    sourcePage:
      document
        ?.sourcePage ??
      document
        ?.reviewedManifest
        ?.sourcePage ??
      null,

    version:
      document
        ?.version ||
      document
        ?.reviewedManifest
        ?.version ||
      null
  };
}


function projectRetrievedDocument(
  firestoreDocument,
  {
    vectorDistance,
    semanticScore,
    metadataScore,
    priorityScore,
    finalScore,
    softMatches
  }
) {
  const content =
    firstNonEmptyText(
      [
        firestoreDocument
          ?.text,

        firestoreDocument
          ?.content,

        firestoreDocument
          ?.embeddingText
      ],
      12000
    );


  return {
    chunkId:
      firestoreDocument
        ?.chunkId ||
      null,

    knowledgeId:
      firestoreDocument
        ?.knowledgeId ||
      null,

    title:
      cleanText(
        firestoreDocument
          ?.title,
        1000
      ) ||
      null,

    category:
      firestoreDocument
        ?.category ||
      null,

    ragVersion:
      firestoreDocument
        ?.ragVersion ||
      null,

    knowledgeLayer:
      firestoreDocument
        ?.knowledgeLayer ||
      'myeongri',

    domain:
      firestoreDocument
        ?.domain ||
      null,

    cycleType:
      firestoreDocument
        ?.cycleType ||
      null,

    factType:
      firestoreDocument
        ?.factType ||
      null,

    content,

    source:
      safeSource(
        firestoreDocument
      ),

    metadata: {
      domain:
        firestoreDocument
          ?.domain ??
        null,

      domains:
        safeArray(
          firestoreDocument
            ?.domains
        ),

      cycleType:
        firestoreDocument
          ?.cycleType ??
        null,

      cycleTypes:
        safeArray(
          firestoreDocument
            ?.cycleTypes
        ),

      factTypes:
        safeArray(
          firestoreDocument
            ?.factTypes
        ),

      priority:
        firestoreDocument
          ?.priority ??
        firestoreDocument
          ?.reviewedManifest
          ?.priority ??
        null
    },

    retrieval: {
      vectorDistance:
        Number(
          vectorDistance.toFixed(
            8
          )
        ),

      semanticScore:
        Number(
          semanticScore.toFixed(
            6
          )
        ),

      metadataScore:
        Number(
          metadataScore.toFixed(
            6
          )
        ),

      priorityScore:
        Number(
          priorityScore.toFixed(
            6
          )
        ),

      finalScore:
        Number(
          finalScore.toFixed(
            6
          )
        ),

      softMatches
    }
  };
}


// ============================================================================
// Firestore vector search
// ============================================================================

async function runVectorSearch({
  db,
  collectionName,
  vectorField,
  queryVector,
  candidateLimit,
  ragVersion = null,
  knowledgeLayer = null
}) {
  try {
    let baseQuery =
      db.collection(
        collectionName
      );


    // Version/lane filters MUST run before nearest-neighbor search.
    // Firestore requires a composite vector index for these pre-filters.
    if (
      cleanText(
        ragVersion,
        120
      )
    ) {
      baseQuery =
        baseQuery.where(
          'ragVersion',
          '==',
          cleanText(
            ragVersion,
            120
          )
        );
    }


    if (
      cleanText(
        knowledgeLayer,
        80
      )
    ) {
      baseQuery =
        baseQuery.where(
          'knowledgeLayer',
          '==',
          cleanText(
            knowledgeLayer,
            80
          )
        );
    }


    const vectorQuery =
      baseQuery.findNearest({
        vectorField,

        queryVector,

        limit:
          candidateLimit,

        distanceMeasure:
          DEFAULT_DISTANCE_MEASURE,

        distanceResultField:
          DEFAULT_DISTANCE_RESULT_FIELD
      });


    const snapshot =
      await vectorQuery.get();


    const results =
      [];


    snapshot.forEach(
      (doc) => {
        const data =
          doc.data();

        const distance =
          Number(
            data[
              DEFAULT_DISTANCE_RESULT_FIELD
            ]
          );


        results.push({
          id:
            doc.id,

          data: {
            ...data,

            chunkId:
              data.chunkId ||
              doc.id
          },

          vectorDistance:
            Number.isFinite(
              distance
            )
              ? distance
              : null
        });
      }
    );


    return results;

  } catch (
    error
  ) {
    const message =
      error?.message ||
      String(
        error
      );


    throw new RagRetrieverError({
      code:
        'SG-RAG-RETRIEVER-FIRESTORE-001',

      stage:
        'VECTOR_SEARCH',

      message:
        'Firestore vector search에 실패했습니다.',

      detail:
        message,

      cause:
        error
    });
  }
}


// ============================================================================
// Active RAG version
// ----------------------------------------------------------------------------
// If the manager has not promoted a version yet, return null and keep the
// legacy single-corpus behavior. After first promote, version filtering becomes
// a Firestore pre-filter before vector search.
// ============================================================================

async function resolveActiveRagVersion(
  db
) {
  try {
    const snapshot =
      await db
        .collection(
          DEFAULT_RAG_MANAGER_COLLECTION
        )
        .doc(
          'runtime'
        )
        .get();


    if (
      !snapshot.exists
    ) {
      return null;
    }


    return cleanText(
      snapshot.data()
        ?.activeRagVersion,
      120
    ) || null;

  } catch (
    error
  ) {
    throw new RagRetrieverError({
      code:
        'SG-RAG-RETRIEVER-VERSION-001',

      stage:
        'RESOLVE_ACTIVE_VERSION',

      message:
        '활성 RAG version을 확인하지 못했습니다.',

      detail:
        error?.message ||
        String(
          error
        ),

      cause:
        error
    });
  }
}


// ============================================================================
// Retrieval
// ============================================================================

export async function retrieveRag(
  ragQueryPacket,
  options = {}
) {
  const semanticQuery =
    assertRagQueryPacket(
      ragQueryPacket
    );


  const rankingPolicy =
    safeObject(
      ragQueryPacket
        ?.query
        ?.rankingPolicy
    );


  const targetResults =
    positiveInteger(
      options.targetResults ??
      rankingPolicy.targetResults,
      DEFAULT_TARGET_RESULTS,
      {
        min:
          1,

        max:
          DEFAULT_MAX_RESULTS
      }
    );


  const maximumResults =
    positiveInteger(
      options.maximumResults ??
      rankingPolicy.maximumResults,
      DEFAULT_MAX_RESULTS,
      {
        min:
          targetResults,

        max:
          20
      }
    );


  const candidateLimit =
    positiveInteger(
      options.candidateLimit,
      Math.max(
        DEFAULT_CANDIDATE_LIMIT,
        targetResults *
          8
      ),
      {
        min:
          targetResults,

        max:
          MAX_CANDIDATE_LIMIT
      }
    );


  const collectionName =
    cleanText(
      options.collectionName,
      500
    ) ||
    DEFAULT_RAG_COLLECTION;


  const vectorField =
    cleanText(
      options.vectorField,
      500
    ) ||
    DEFAULT_VECTOR_FIELD;


  const embeddingModel =
    cleanText(
      options.embeddingModel,
      500
    ) ||
    DEFAULT_EMBEDDING_MODEL;


  const embeddingDimensions =
    positiveInteger(
      options.embeddingDimensions,
      DEFAULT_EMBEDDING_DIMENSIONS,
      {
        min:
          128,

        max:
          2048
      }
    );


  const startedAt =
    Date.now();


  const queryVector =
    await buildQueryVector(
      semanticQuery,
      {
        model:
          embeddingModel,

        dimensions:
          embeddingDimensions
      }
    );


  const {
    db,
    auth
  } =
    options.firestore
      ? {
          db:
            options.firestore,

          auth: {
            mode:
              'injected_firestore',

            projectId:
              null
          }
        }
      : await getFirestoreClient();


  const explicitRagVersion =
    cleanText(
      options.ragVersion,
      120
    ) ||
    null;


  const ragVersion =
    explicitRagVersion ||
    await resolveActiveRagVersion(
      db
    );


  const knowledgeLayer =
    cleanText(
      options.knowledgeLayer,
      80
    ) ||
    null;


  const vectorCandidates =
    await runVectorSearch({
      db,

      collectionName,

      vectorField,

      queryVector,

      candidateLimit,

      ragVersion,

      knowledgeLayer
    });


  const hardFilters =
    safeArray(
      ragQueryPacket
        ?.query
        ?.hardFilters
    );


  const softFilters =
    safeArray(
      ragQueryPacket
        ?.query
        ?.softFilters
    );


  const reranked =
    [];


  let rejectedByHardFilter =
    0;


  for (
    const candidate of
    vectorCandidates
  ) {
    const document =
      candidate.data;


    if (
      document
        ?.corpus &&
      document.corpus !==
        'production'
    ) {
      continue;
    }


    if (
      document
        ?.status &&
      document.status !==
        'active'
    ) {
      continue;
    }


    if (
      document
        ?.reviewedManifest
        ?.isNegative ===
        true ||
      document
        ?.reviewedManifest
        ?.retrievalAllowed ===
        false
    ) {
      continue;
    }


    if (
      !matchesAllHardFilters(
        document,
        hardFilters
      )
    ) {
      rejectedByHardFilter +=
        1;

      continue;
    }


    const vectorDistance =
      Number.isFinite(
        candidate.vectorDistance
      )
        ? candidate.vectorDistance
        : 2;


    const semanticScore =
      clamp(
        1 -
        vectorDistance /
          2,
        0,
        1
      );


    const {
      score:
        metadataScore,

      matches:
        softMatches
    } =
      calculateMetadataScore(
        document,
        softFilters
      );


    const priorityScore =
      normalizedPriority(
        document
      );


    const finalScore =
      semanticScore +
      metadataScore *
        0.12 +
      priorityScore *
        0.04;


    reranked.push(
      projectRetrievedDocument(
        document,
        {
          vectorDistance,

          semanticScore,

          metadataScore,

          priorityScore,

          finalScore,

          softMatches
        }
      )
    );
  }


  reranked.sort(
    (
      left,
      right
    ) =>
      right
        .retrieval
        .finalScore -
      left
        .retrieval
        .finalScore
  );


  const results =
    reranked.slice(
      0,
      Math.min(
        targetResults,
        maximumResults
      )
    );


  const elapsedMs =
    Date.now() -
    startedAt;


  return {
    schemaVersion:
      RAG_RETRIEVER_SCHEMA_VERSION,

    retrieverVersion:
      RAG_RETRIEVER_VERSION,

    source: {
      collection:
        collectionName,

      ragVersion,

      knowledgeLayer,

      vectorField,

      distanceMeasure:
        DEFAULT_DISTANCE_MEASURE,

      embeddingProvider:
        'gemini',

      embeddingModel,

      embeddingDimensions,

      authMode:
        auth.mode,

      projectId:
        auth.projectId
    },

    query: {
      semanticQuery,

      context:
        ragQueryPacket
          .context,

      hardFilters,

      softFilterCount:
        softFilters.length
    },

    stats: {
      candidateLimit,

      candidatesReturned:
        vectorCandidates.length,

      rejectedByHardFilter,

      reranked:
        reranked.length,

      returned:
        results.length,

      elapsedMs
    },

    results,

    policy: {
      engineFactsRecalculated:
        false,

      diagnosticsUsed:
        false,

      negativeCorpusAllowed:
        false,

      firestoreServerPrefilter:
        Boolean(
          ragVersion ||
          knowledgeLayer
        ),

      versionFilterMode:
        ragVersion
          ? 'firestore_pre_filter'
          : 'legacy_unversioned',

      hardFilterMode:
        'application_post_filter',

      metadataBoost:
        true
    }
  };
}


// ============================================================================
// Convenience: Engine Facts -> Query Builder -> Retriever
// ============================================================================

export async function retrieveRagForEngineFacts(
  engineFacts,
  {
    domain = 'all',
    cycleType = null,
    cycleIndex = null,
    userQuery = '',
    ...retrieverOptions
  } = {}
) {
  let queryPacket;

  try {
    queryPacket =
      buildRagQuery(
        engineFacts,
        {
          domain,
          cycleType,
          cycleIndex,
          userQuery
        }
      );

  } catch (
    error
  ) {
    throw new RagRetrieverError({
      code:
        error?.code ||
        'SG-RAG-RETRIEVER-BUILDER-001',

      stage:
        error?.stage ||
        'BUILD_RAG_QUERY',

      message:
        'Engine Facts에서 RAG Query Packet 생성에 실패했습니다.',

      detail:
        error?.message ||
        String(
          error
        ),

      cause:
        error
    });
  }


  return retrieveRag(
    queryPacket,
    retrieverOptions
  );
}


// ============================================================================
// LLM context formatter
// ============================================================================

export function buildRetrievedRagContext(
  retrievalResult,
  {
    maxChunks =
      DEFAULT_TARGET_RESULTS,

    maxCharsPerChunk =
      5000
  } = {}
) {
  const results =
    safeArray(
      retrievalResult
        ?.results
    )
      .slice(
        0,
        positiveInteger(
          maxChunks,
          DEFAULT_TARGET_RESULTS,
          {
            min:
              1,

            max:
              20
          }
        )
      );


  if (
    results.length ===
      0
  ) {
    return [
      '[RETRIEVED RAG KNOWLEDGE]',
      '검색된 RAG 지식이 없습니다.',
      'Engine Facts에 없는 명리 Fact를 추측하거나 재계산하지 마세요.'
    ].join(
      '\n'
    );
  }


  const blocks =
    results.map(
      (
        item,
        index
      ) => {
        const source =
          item.source ||
          {};

        const sourceLabel = [
          source.sourcePdf,
          source.sourcePage
            ? `p.${source.sourcePage}`
            : null
        ]
          .filter(
            Boolean
          )
          .join(
            ' / '
          );


        const content =
          cleanText(
            item.content,
            maxCharsPerChunk
          );


        return [
          `### RAG ${index + 1}`,
          `chunkId: ${item.chunkId || '-'}`,
          `knowledgeId: ${item.knowledgeId || '-'}`,
          `title: ${item.title || '-'}`,
          `source: ${sourceLabel || '-'}`,
          `retrievalScore: ${item.retrieval?.finalScore ?? '-'}`,
          '',
          content
        ].join(
          '\n'
        );
      }
    );


  return [
    '[RETRIEVED RAG KNOWLEDGE - INTERPRETATION ONLY]',
    '아래 내용은 Engine Facts의 의미와 전략을 설명하기 위한 검색 지식입니다.',
    '검색 지식으로 사주팔자, 강약, 용신, 십신, 12운성, 귀인·신살, 합충형파해, 운 간지를 새로 계산하거나 Engine Facts를 수정하지 마세요.',
    '',
    ...blocks
  ].join(
    '\n\n'
  );
}


// ============================================================================
// Compact diagnostics
// ============================================================================

export function summarizeRagRetrieval(
  retrievalResult
) {
  if (
    !retrievalResult ||
    typeof retrievalResult !==
      'object'
  ) {
    return null;
  }


  return {
    schemaVersion:
      retrievalResult
        .schemaVersion,

    retrieverVersion:
      retrievalResult
        .retrieverVersion,

    source: {
      collection:
        retrievalResult
          .source
          ?.collection,

      ragVersion:
        retrievalResult
          .source
          ?.ragVersion ||
        null,

      knowledgeLayer:
        retrievalResult
          .source
          ?.knowledgeLayer ||
        null,

      vectorField:
        retrievalResult
          .source
          ?.vectorField,

      distanceMeasure:
        retrievalResult
          .source
          ?.distanceMeasure,

      embeddingModel:
        retrievalResult
          .source
          ?.embeddingModel,

      embeddingDimensions:
        retrievalResult
          .source
          ?.embeddingDimensions
    },

    stats:
      retrievalResult
        .stats,

    resultIds:
      safeArray(
        retrievalResult
          .results
      ).map(
        (item) =>
          item.chunkId
      )
  };
}


// ============================================================================
// Runtime info
// ============================================================================

export function getRagRetrieverRuntimeInfo() {
  return {
    schemaVersion:
      RAG_RETRIEVER_SCHEMA_VERSION,

    retrieverVersion:
      RAG_RETRIEVER_VERSION,

    collection:
      DEFAULT_RAG_COLLECTION,

    vectorField:
      DEFAULT_VECTOR_FIELD,

    distanceMeasure:
      DEFAULT_DISTANCE_MEASURE,

    embeddingModel:
      DEFAULT_EMBEDDING_MODEL,

    embeddingDimensions:
      DEFAULT_EMBEDDING_DIMENSIONS,

    candidateLimit:
      DEFAULT_CANDIDATE_LIMIT,

    targetResults:
      DEFAULT_TARGET_RESULTS,

    serverPrefilter:
      false,

    hardFilterMode:
      'application_post_filter'
  };
}


// ============================================================================
// Default export
// ============================================================================

export default Object.freeze({
  schemaVersion:
    RAG_RETRIEVER_SCHEMA_VERSION,

  retrieverVersion:
    RAG_RETRIEVER_VERSION,

  retrieve:
    retrieveRag,

  retrieveForEngineFacts:
    retrieveRagForEngineFacts,

  buildContext:
    buildRetrievedRagContext,

  summarize:
    summarizeRagRetrieval,

  runtimeInfo:
    getRagRetrieverRuntimeInfo
});