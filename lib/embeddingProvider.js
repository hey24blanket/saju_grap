// lib/embeddingProvider.js
// SajuGrap Gemini Embedding Provider v1
// -----------------------------------------------------------------------------
// 역할
// - RAG 문서의 embeddingText -> RETRIEVAL_DOCUMENT embedding
// - 사용자/RAG 검색 query -> RETRIEVAL_QUERY embedding
// - Gemini Embedding API 호출을 한 곳으로 통합
// - API key를 브라우저에 노출하지 않음
// - Firestore vector index에 맞는 차원 제한을 강제
//
// 계산하지 않는 것
// - 사주팔자
// - 강약
// - 용신
// - 십신
// - 신살
// - 합충형파해
// - 시간축 Fact
//
// 이 파일은 "텍스트 -> 숫자 벡터"만 담당한다.
// -----------------------------------------------------------------------------

import crypto from 'node:crypto';

export const EMBEDDING_PROVIDER_SCHEMA_VERSION = 'embedding_provider_v1';
export const EMBEDDING_PROVIDER_VERSION = '1.0.0';

export const EMBEDDING_PROVIDER = 'gemini';

export const DEFAULT_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL ||
  'gemini-embedding-2';

export const DEFAULT_EMBEDDING_DIMENSIONS =
  Number(
    process.env.RAG_EMBEDDING_DIMENSIONS ||
    768
  );

export const FIRESTORE_MAX_VECTOR_DIMENSIONS = 2048;

export const EMBEDDING_TASK = Object.freeze({
  DOCUMENT: 'RETRIEVAL_DOCUMENT',
  QUERY: 'RETRIEVAL_QUERY'
});

export const EMBEDDING_STAGE = Object.freeze({
  VALIDATE_CONFIG: 'EMBEDDING_VALIDATE_CONFIG',
  VALIDATE_INPUT: 'EMBEDDING_VALIDATE_INPUT',
  REQUEST: 'EMBEDDING_REQUEST',
  RESPONSE: 'EMBEDDING_RESPONSE',
  ATTACH_DOCUMENT: 'EMBEDDING_ATTACH_DOCUMENT'
});

export const EMBEDDING_ERROR = Object.freeze({
  ENV_MISSING: 'SG-EMBED-ENV-001',
  INVALID_MODEL: 'SG-EMBED-CONFIG-001',
  INVALID_DIMENSIONS: 'SG-EMBED-CONFIG-002',
  INVALID_INPUT: 'SG-EMBED-INPUT-001',
  REQUEST_FAILED: 'SG-EMBED-GEMINI-001',
  RESPONSE_INVALID: 'SG-EMBED-GEMINI-002',
  DIMENSION_MISMATCH: 'SG-EMBED-GEMINI-003',
  BATCH_INVALID: 'SG-EMBED-BATCH-001',
  ATTACH_INVALID: 'SG-EMBED-DOC-001'
});

const GEMINI_API_BASE =
  'https://generativelanguage.googleapis.com/v1beta';

const DEFAULT_TIMEOUT_MS =
  Number(
    process.env.RAG_EMBEDDING_TIMEOUT_MS ||
    30000
  );

const DEFAULT_MAX_RETRIES =
  Number(
    process.env.RAG_EMBEDDING_MAX_RETRIES ||
    3
  );

const DEFAULT_BATCH_SIZE =
  Number(
    process.env.RAG_EMBEDDING_BATCH_SIZE ||
    32
  );

const MIN_EMBEDDING_DIMENSIONS = 128;
const MAX_INPUT_CHARS = 30000;

const RETRYABLE_STATUS = new Set([
  408,
  409,
  429,
  500,
  502,
  503,
  504
]);


// ============================================================================
// Error
// ============================================================================

export class EmbeddingProviderError extends Error {
  constructor({
    code,
    stage,
    message,
    detail = null,
    providerStatus = null,
    providerCode = null,
    retryable = false,
    cause = null
  }) {
    super(message);

    this.name = 'EmbeddingProviderError';

    this.code = code;
    this.stage = stage;

    this.detail = detail;

    this.provider = EMBEDDING_PROVIDER;

    this.providerStatus = providerStatus;
    this.providerCode = providerCode;

    this.retryable = retryable;

    if (cause) {
      this.cause = cause;
    }
  }
}


// ============================================================================
// Utilities
// ============================================================================

function cleanText(
  value,
  maxLength = MAX_INPUT_CHARS
) {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .slice(0, maxLength);
}


function safeTitle(value) {
  return cleanText(
    value,
    500
  );
}


function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );
}


function retryDelayMs(attempt) {
  const base =
    Math.min(
      8000,
      500 *
      2 ** Math.max(
        0,
        attempt - 1
      )
    );

  const jitter =
    Math.floor(
      Math.random() *
      250
    );

  return base + jitter;
}


function sha256(text) {
  return crypto
    .createHash('sha256')
    .update(
      text,
      'utf8'
    )
    .digest('hex');
}


function isFiniteVector(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item === 'number' &&
        Number.isFinite(item)
    )
  );
}


function l2Normalize(vector) {
  const magnitude =
    Math.sqrt(
      vector.reduce(
        (sum, value) =>
          sum +
          value * value,
        0
      )
    );

  if (
    !Number.isFinite(magnitude) ||
    magnitude === 0
  ) {
    throw new EmbeddingProviderError({
      code:
        EMBEDDING_ERROR
          .RESPONSE_INVALID,

      stage:
        EMBEDDING_STAGE
          .RESPONSE,

      message:
        'Embedding vector의 magnitude가 올바르지 않습니다.'
    });
  }

  return vector.map(
    (value) =>
      value /
      magnitude
  );
}


function normalizeModelName(value) {
  const model =
    cleanText(
      value,
      180
    );

  if (!model) {
    throw new EmbeddingProviderError({
      code:
        EMBEDDING_ERROR
          .INVALID_MODEL,

      stage:
        EMBEDDING_STAGE
          .VALIDATE_CONFIG,

      message:
        'Embedding model 이름이 비어 있습니다.'
    });
  }

  return model.replace(
    /^models\//,
    ''
  );
}


function validateDimensions(value) {
  const dimensions =
    Number(value);

  if (
    !Number.isInteger(dimensions) ||
    dimensions <
      MIN_EMBEDDING_DIMENSIONS
  ) {
    throw new EmbeddingProviderError({
      code:
        EMBEDDING_ERROR
          .INVALID_DIMENSIONS,

      stage:
        EMBEDDING_STAGE
          .VALIDATE_CONFIG,

      message:
        `Embedding dimensions가 올바르지 않습니다: ${value}`,

      detail:
        `minimum=${MIN_EMBEDDING_DIMENSIONS}`
    });
  }

  if (
    dimensions >
    FIRESTORE_MAX_VECTOR_DIMENSIONS
  ) {
    throw new EmbeddingProviderError({
      code:
        EMBEDDING_ERROR
          .INVALID_DIMENSIONS,

      stage:
        EMBEDDING_STAGE
          .VALIDATE_CONFIG,

      message:
        `Firestore에 저장할 embedding dimension은 ${FIRESTORE_MAX_VECTOR_DIMENSIONS} 이하여야 합니다.`,

      detail:
        `received=${dimensions}`
    });
  }

  return dimensions;
}


function validatePositiveInteger(
  value,
  fallback,
  {
    min = 1,
    max = 1000
  } = {}
) {
  const parsed =
    Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < min ||
    parsed > max
  ) {
    return fallback;
  }

  return parsed;
}


function normalizeTaskType(value) {
  if (
    value ===
      EMBEDDING_TASK.DOCUMENT ||
    value ===
      EMBEDDING_TASK.QUERY
  ) {
    return value;
  }

  throw new EmbeddingProviderError({
    code:
      EMBEDDING_ERROR
        .INVALID_INPUT,

    stage:
      EMBEDDING_STAGE
        .VALIDATE_INPUT,

    message:
      `지원하지 않는 embedding taskType입니다: ${value}`
  });
}


function shouldNormalizeOutput(
  model,
  dimensions
) {
  // gemini-embedding-001은 축소 dimension 사용 시
  // 수동 normalization이 필요한 모델이다.
  return (
    model ===
      'gemini-embedding-001' &&
    dimensions !==
      3072
  );
}


// ============================================================================
// Configuration
// ============================================================================

export function getEmbeddingConfig(
  overrides = {}
) {
  const model =
    normalizeModelName(
      overrides.model ||
      DEFAULT_EMBEDDING_MODEL
    );

  const dimensions =
    validateDimensions(
      overrides.dimensions ??
      DEFAULT_EMBEDDING_DIMENSIONS
    );

  const timeoutMs =
    validatePositiveInteger(
      overrides.timeoutMs ??
      DEFAULT_TIMEOUT_MS,
      30000,
      {
        min: 1000,
        max: 120000
      }
    );

  const maxRetries =
    validatePositiveInteger(
      overrides.maxRetries ??
      DEFAULT_MAX_RETRIES,
      3,
      {
        min: 1,
        max: 8
      }
    );

  const batchSize =
    validatePositiveInteger(
      overrides.batchSize ??
      DEFAULT_BATCH_SIZE,
      32,
      {
        min: 1,
        max: 100
      }
    );

  return {
    provider:
      EMBEDDING_PROVIDER,

    model,

    dimensions,

    timeoutMs,

    maxRetries,

    batchSize
  };
}


function getGeminiApiKey(
  explicitKey = null
) {
  const key =
    cleanText(
      explicitKey ||
      process.env.GEMINI_API_KEY,
      1000
    );

  if (!key) {
    throw new EmbeddingProviderError({
      code:
        EMBEDDING_ERROR
          .ENV_MISSING,

      stage:
        EMBEDDING_STAGE
          .VALIDATE_CONFIG,

      message:
        'GEMINI_API_KEY 환경변수가 없습니다.',

      detail:
        'Vercel 또는 실행 환경에 GEMINI_API_KEY를 설정하세요.'
    });
  }

  return key;
}


// ============================================================================
// Input normalization
// ============================================================================

function normalizeEmbeddingItem(
  item,
  {
    taskType
  }
) {
  if (
    typeof item === 'string'
  ) {
    const text =
      cleanText(item);

    if (!text) {
      throw new EmbeddingProviderError({
        code:
          EMBEDDING_ERROR
            .INVALID_INPUT,

        stage:
          EMBEDDING_STAGE
            .VALIDATE_INPUT,

        message:
          'Embedding text가 비어 있습니다.'
      });
    }

    return {
      text,
      title: null
    };
  }

  if (
    !item ||
    typeof item !== 'object' ||
    Array.isArray(item)
  ) {
    throw new EmbeddingProviderError({
      code:
        EMBEDDING_ERROR
          .INVALID_INPUT,

      stage:
        EMBEDDING_STAGE
          .VALIDATE_INPUT,

      message:
        'Embedding 입력은 문자열 또는 { text, title } 객체여야 합니다.'
    });
  }

  const text =
    cleanText(
      item.text
    );

  if (!text) {
    throw new EmbeddingProviderError({
      code:
        EMBEDDING_ERROR
          .INVALID_INPUT,

      stage:
        EMBEDDING_STAGE
          .VALIDATE_INPUT,

      message:
        'Embedding text가 비어 있습니다.'
    });
  }

  return {
    text,

    title:
      taskType ===
        EMBEDDING_TASK
          .DOCUMENT
        ? (
            safeTitle(
              item.title
            ) ||
            null
          )
        : null
  };
}


// ============================================================================
// Gemini REST request helpers
// ============================================================================

function modelResourceName(
  model
) {
  return `models/${model}`;
}


function singleEndpoint(
  model
) {
  return (
    `${GEMINI_API_BASE}/models/` +
    `${encodeURIComponent(model)}` +
    ':embedContent'
  );
}


function batchEndpoint(
  model
) {
  return (
    `${GEMINI_API_BASE}/models/` +
    `${encodeURIComponent(model)}` +
    ':batchEmbedContents'
  );
}


function buildEmbedContentConfig({
  taskType,
  dimensions,
  title = null
}) {
  const config = {
    taskType,

    outputDimensionality:
      dimensions,

    // RAG corpus builder가 이미 chunk 길이를 관리한다.
    // provider가 조용히 잘라 버리지 않도록 false로 둔다.
    autoTruncate:
      false
  };

  if (
    taskType ===
      EMBEDDING_TASK
        .DOCUMENT &&
    title
  ) {
    config.title =
      title;
  }

  return config;
}


function buildSingleRequestBody({
  model,
  text,
  title,
  taskType,
  dimensions
}) {
  return {
    model:
      modelResourceName(
        model
      ),

    content: {
      parts: [
        {
          text
        }
      ]
    },

    embedContentConfig:
      buildEmbedContentConfig({
        taskType,
        dimensions,
        title
      })
  };
}


function buildBatchRequestBody({
  model,
  items,
  taskType,
  dimensions
}) {
  return {
    requests:
      items.map(
        (item) => ({
          model:
            modelResourceName(
              model
            ),

          content: {
            parts: [
              {
                text:
                  item.text
              }
            ]
          },

          embedContentConfig:
            buildEmbedContentConfig({
              taskType,
              dimensions,
              title:
                item.title
            })
        })
      )
  };
}


function providerErrorInfo(
  payload
) {
  const error =
    payload?.error;

  return {
    message:
      cleanText(
        error?.message,
        1000
      ) ||
      null,

    code:
      cleanText(
        error?.status,
        120
      ) ||
      (
        error?.code !==
          undefined
          ? String(
              error.code
            )
          : null
      )
  };
}


async function fetchJsonWithRetry({
  url,
  body,
  apiKey,
  timeoutMs,
  maxRetries
}) {
  let lastError = null;

  for (
    let attempt = 1;
    attempt <= maxRetries;
    attempt += 1
  ) {
    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () =>
          controller.abort(),
        timeoutMs
      );

    try {
      const response =
        await fetch(
          url,
          {
            method:
              'POST',

            headers: {
              'Content-Type':
                'application/json',

              'x-goog-api-key':
                apiKey
            },

            body:
              JSON.stringify(
                body
              ),

            signal:
              controller.signal
          }
        );

      const rawText =
        await response.text();

      let payload = {};

      if (rawText) {
        try {
          payload =
            JSON.parse(
              rawText
            );
        } catch {
          payload = {
            raw:
              rawText.slice(
                0,
                1500
              )
          };
        }
      }

      if (
        response.ok
      ) {
        return {
          payload,

          status:
            response.status,

          attempt
        };
      }

      const info =
        providerErrorInfo(
          payload
        );

      const retryable =
        RETRYABLE_STATUS.has(
          response.status
        );

      lastError =
        new EmbeddingProviderError({
          code:
            EMBEDDING_ERROR
              .REQUEST_FAILED,

          stage:
            EMBEDDING_STAGE
              .REQUEST,

          message:
            info.message ||
            'Gemini Embedding API 요청에 실패했습니다.',

          detail:
            `attempt=${attempt}/${maxRetries}`,

          providerStatus:
            response.status,

          providerCode:
            info.code,

          retryable
        });

      if (
        !retryable ||
        attempt >=
          maxRetries
      ) {
        throw lastError;
      }

      await sleep(
        retryDelayMs(
          attempt
        )
      );
    } catch (error) {
      if (
        error instanceof
        EmbeddingProviderError
      ) {
        if (
          !error.retryable ||
          attempt >=
            maxRetries
        ) {
          throw error;
        }

        lastError =
          error;

        await sleep(
          retryDelayMs(
            attempt
          )
        );

        continue;
      }

      const isAbort =
        error?.name ===
        'AbortError';

      lastError =
        new EmbeddingProviderError({
          code:
            EMBEDDING_ERROR
              .REQUEST_FAILED,

          stage:
            EMBEDDING_STAGE
              .REQUEST,

          message:
            isAbort
              ? 'Gemini Embedding API 요청 시간이 초과되었습니다.'
              : 'Gemini Embedding API 네트워크 요청에 실패했습니다.',

          detail:
            `attempt=${attempt}/${maxRetries}`,

          retryable:
            true,

          cause:
            error
        });

      if (
        attempt >=
        maxRetries
      ) {
        throw lastError;
      }

      await sleep(
        retryDelayMs(
          attempt
        )
      );
    } finally {
      clearTimeout(
        timer
      );
    }
  }

  throw (
    lastError ||
    new EmbeddingProviderError({
      code:
        EMBEDDING_ERROR
          .REQUEST_FAILED,

      stage:
        EMBEDDING_STAGE
          .REQUEST,

      message:
        'Gemini Embedding API 요청에 실패했습니다.'
    })
  );
}


// ============================================================================
// Response validation
// ============================================================================

function finalizeVector({
  vector,
  config
}) {
  if (
    !isFiniteVector(
      vector
    )
  ) {
    throw new EmbeddingProviderError({
      code:
        EMBEDDING_ERROR
          .RESPONSE_INVALID,

      stage:
        EMBEDDING_STAGE
          .RESPONSE,

      message:
        'Gemini Embedding API가 유효한 vector를 반환하지 않았습니다.'
    });
  }

  if (
    vector.length !==
    config.dimensions
  ) {
    throw new EmbeddingProviderError({
      code:
        EMBEDDING_ERROR
          .DIMENSION_MISMATCH,

      stage:
        EMBEDDING_STAGE
          .RESPONSE,

      message:
        'Embedding vector dimension이 설정값과 다릅니다.',

      detail:
        `expected=${config.dimensions}, actual=${vector.length}`
    });
  }

  return shouldNormalizeOutput(
    config.model,
    config.dimensions
  )
    ? l2Normalize(
        vector
      )
    : vector;
}


function makeEmbeddingResult({
  vector,
  config,
  taskType,
  text,
  title = null,
  providerStatus = 200,
  attempts = 1
}) {
  return {
    schemaVersion:
      EMBEDDING_PROVIDER_SCHEMA_VERSION,

    provider:
      EMBEDDING_PROVIDER,

    providerVersion:
      EMBEDDING_PROVIDER_VERSION,

    model:
      config.model,

    dimensions:
      config.dimensions,

    taskType,

    vector,

    input: {
      textHash:
        sha256(
          text
        ),

      charCount:
        text.length,

      title:
        title ||
        null
    },

    diagnostics: {
      providerStatus,

      attempts
    }
  };
}


// ============================================================================
// Single embedding
// ============================================================================

export async function embedText(
  item,
  {
    taskType =
      EMBEDDING_TASK
        .QUERY,

    model =
      DEFAULT_EMBEDDING_MODEL,

    dimensions =
      DEFAULT_EMBEDDING_DIMENSIONS,

    timeoutMs =
      DEFAULT_TIMEOUT_MS,

    maxRetries =
      DEFAULT_MAX_RETRIES,

    apiKey =
      null
  } = {}
) {
  const normalizedTask =
    normalizeTaskType(
      taskType
    );

  const config =
    getEmbeddingConfig({
      model,
      dimensions,
      timeoutMs,
      maxRetries
    });

  const key =
    getGeminiApiKey(
      apiKey
    );

  const normalized =
    normalizeEmbeddingItem(
      item,
      {
        taskType:
          normalizedTask
      }
    );

  const response =
    await fetchJsonWithRetry({
      url:
        singleEndpoint(
          config.model
        ),

      body:
        buildSingleRequestBody({
          model:
            config.model,

          text:
            normalized.text,

          title:
            normalized.title,

          taskType:
            normalizedTask,

          dimensions:
            config.dimensions
        }),

      apiKey:
        key,

      timeoutMs:
        config.timeoutMs,

      maxRetries:
        config.maxRetries
    });

  const vector =
    finalizeVector({
      vector:
        response
          .payload
          ?.embedding
          ?.values,

      config
    });

  return makeEmbeddingResult({
    vector,
    config,

    taskType:
      normalizedTask,

    text:
      normalized.text,

    title:
      normalized.title,

    providerStatus:
      response.status,

    attempts:
      response.attempt
  });
}


export async function embedDocument(
  text,
  {
    title = null,
    ...options
  } = {}
) {
  return embedText(
    {
      text,
      title
    },

    {
      ...options,

      taskType:
        EMBEDDING_TASK
          .DOCUMENT
    }
  );
}


export async function embedQuery(
  text,
  options = {}
) {
  return embedText(
    text,

    {
      ...options,

      taskType:
        EMBEDDING_TASK
          .QUERY
    }
  );
}


// ============================================================================
// Batch embedding
// ============================================================================

async function embedBatchChunk(
  normalizedItems,
  {
    taskType,
    config,
    apiKey
  }
) {
  const response =
    await fetchJsonWithRetry({
      url:
        batchEndpoint(
          config.model
        ),

      body:
        buildBatchRequestBody({
          model:
            config.model,

          items:
            normalizedItems,

          taskType,

          dimensions:
            config.dimensions
        }),

      apiKey,

      timeoutMs:
        config.timeoutMs,

      maxRetries:
        config.maxRetries
    });

  const embeddings =
    response
      .payload
      ?.embeddings;

  if (
    !Array.isArray(
      embeddings
    ) ||
    embeddings.length !==
      normalizedItems.length
  ) {
    throw new EmbeddingProviderError({
      code:
        EMBEDDING_ERROR
          .RESPONSE_INVALID,

      stage:
        EMBEDDING_STAGE
          .RESPONSE,

      message:
        'Gemini batch embedding 응답 개수가 요청 개수와 다릅니다.',

      detail:
        `requested=${normalizedItems.length}, received=${
          Array.isArray(embeddings)
            ? embeddings.length
            : 'invalid'
        }`
    });
  }

  return embeddings.map(
    (
      embedding,
      index
    ) => {
      const item =
        normalizedItems[
          index
        ];

      const vector =
        finalizeVector({
          vector:
            embedding?.values,

          config
        });

      return makeEmbeddingResult({
        vector,
        config,
        taskType,

        text:
          item.text,

        title:
          item.title,

        providerStatus:
          response.status,

        attempts:
          response.attempt
      });
    }
  );
}


export async function embedBatch(
  items,
  {
    taskType =
      EMBEDDING_TASK
        .DOCUMENT,

    model =
      DEFAULT_EMBEDDING_MODEL,

    dimensions =
      DEFAULT_EMBEDDING_DIMENSIONS,

    timeoutMs =
      DEFAULT_TIMEOUT_MS,

    maxRetries =
      DEFAULT_MAX_RETRIES,

    batchSize =
      DEFAULT_BATCH_SIZE,

    apiKey =
      null,

    onProgress =
      null
  } = {}
) {
  if (
    !Array.isArray(
      items
    ) ||
    items.length === 0
  ) {
    throw new EmbeddingProviderError({
      code:
        EMBEDDING_ERROR
          .BATCH_INVALID,

      stage:
        EMBEDDING_STAGE
          .VALIDATE_INPUT,

      message:
        'Batch embedding에는 1개 이상의 입력이 필요합니다.'
    });
  }

  const normalizedTask =
    normalizeTaskType(
      taskType
    );

  const config =
    getEmbeddingConfig({
      model,
      dimensions,
      timeoutMs,
      maxRetries,
      batchSize
    });

  const key =
    getGeminiApiKey(
      apiKey
    );

  const normalizedItems =
    items.map(
      (item) =>
        normalizeEmbeddingItem(
          item,
          {
            taskType:
              normalizedTask
          }
        )
    );

  const results = [];

  for (
    let start = 0;
    start <
      normalizedItems.length;
    start +=
      config.batchSize
  ) {
    const chunk =
      normalizedItems.slice(
        start,
        start +
          config.batchSize
      );

    const chunkResults =
      await embedBatchChunk(
        chunk,
        {
          taskType:
            normalizedTask,

          config,

          apiKey:
            key
        }
      );

    results.push(
      ...chunkResults
    );

    if (
      typeof onProgress ===
      'function'
    ) {
      await onProgress({
        completed:
          results.length,

        total:
          normalizedItems.length,

        batchSize:
          chunk.length,

        model:
          config.model,

        dimensions:
          config.dimensions
      });
    }
  }

  return results;
}


// ============================================================================
// rag_document_v1 integration
// ============================================================================

export async function attachEmbeddingToRagDocument(
  document,
  options = {}
) {
  if (
    !document ||
    typeof document !==
      'object' ||
    Array.isArray(
      document
    )
  ) {
    throw new EmbeddingProviderError({
      code:
        EMBEDDING_ERROR
          .ATTACH_INVALID,

      stage:
        EMBEDDING_STAGE
          .ATTACH_DOCUMENT,

      message:
        'RAG document가 올바른 객체가 아닙니다.'
    });
  }

  const text =
    cleanText(
      document
        .embeddingText
    );

  if (!text) {
    throw new EmbeddingProviderError({
      code:
        EMBEDDING_ERROR
          .ATTACH_INVALID,

      stage:
        EMBEDDING_STAGE
          .ATTACH_DOCUMENT,

      message:
        'RAG document에 embeddingText가 없습니다.',

      detail:
        `chunkId=${document.chunkId || 'unknown'}`
    });
  }

  const result =
    await embedDocument(
      text,
      {
        ...options,

        title:
          document.title ||
          null
      }
    );

  return {
    ...document,

    embedding: {
      provider:
        result.provider,

      model:
        result.model,

      dimensions:
        result.dimensions,

      vector:
        result.vector,

      embeddedAt:
        new Date()
          .toISOString()
    }
  };
}


export async function attachEmbeddingsToRagDocuments(
  documents,
  {
    onProgress =
      null,

    ...options
  } = {}
) {
  if (
    !Array.isArray(
      documents
    ) ||
    documents.length === 0
  ) {
    throw new EmbeddingProviderError({
      code:
        EMBEDDING_ERROR
          .ATTACH_INVALID,

      stage:
        EMBEDDING_STAGE
          .ATTACH_DOCUMENT,

      message:
        'Embedding을 붙일 RAG document 배열이 비어 있습니다.'
    });
  }

  const items =
    documents.map(
      (document) => {
        const text =
          cleanText(
            document
              ?.embeddingText
          );

        if (!text) {
          throw new EmbeddingProviderError({
            code:
              EMBEDDING_ERROR
                .ATTACH_INVALID,

            stage:
              EMBEDDING_STAGE
                .ATTACH_DOCUMENT,

            message:
              'RAG document에 embeddingText가 없습니다.',

            detail:
              `chunkId=${document?.chunkId || 'unknown'}`
          });
        }

        return {
          text,

          title:
            document.title ||
            null
        };
      }
    );

  const results =
    await embedBatch(
      items,
      {
        ...options,

        taskType:
          EMBEDDING_TASK
            .DOCUMENT,

        onProgress
      }
    );

  return documents.map(
    (
      document,
      index
    ) => {
      const result =
        results[index];

      return {
        ...document,

        embedding: {
          provider:
            result.provider,

          model:
            result.model,

          dimensions:
            result.dimensions,

          vector:
            result.vector,

          embeddedAt:
            new Date()
              .toISOString()
        }
      };
    }
  );
}


// ============================================================================
// Diagnostics
// ----------------------------------------------------------------------------
// vector 값 자체는 로그/진단에서 제외한다.
// ============================================================================

export function summarizeEmbeddingResult(
  result
) {
  if (
    !result ||
    typeof result !==
      'object'
  ) {
    return null;
  }

  return {
    schemaVersion:
      result.schemaVersion ||
      null,

    provider:
      result.provider ||
      null,

    providerVersion:
      result.providerVersion ||
      null,

    model:
      result.model ||
      null,

    dimensions:
      result.dimensions ||
      (
        Array.isArray(
          result.vector
        )
          ? result.vector.length
          : null
      ),

    taskType:
      result.taskType ||
      null,

    input:
      result.input
        ? {
            textHash:
              result
                .input
                .textHash ||
              null,

            charCount:
              result
                .input
                .charCount ??
              null,

            title:
              result
                .input
                .title ||
              null
          }
        : null,

    diagnostics:
      result.diagnostics ||
      null
  };
}


export function getEmbeddingRuntimeInfo(
  overrides = {}
) {
  const config =
    getEmbeddingConfig(
      overrides
    );

  return {
    schemaVersion:
      EMBEDDING_PROVIDER_SCHEMA_VERSION,

    provider:
      EMBEDDING_PROVIDER,

    providerVersion:
      EMBEDDING_PROVIDER_VERSION,

    model:
      config.model,

    dimensions:
      config.dimensions,

    timeoutMs:
      config.timeoutMs,

    maxRetries:
      config.maxRetries,

    batchSize:
      config.batchSize,

    apiKeyConfigured:
      Boolean(
        process.env
          .GEMINI_API_KEY
      )
  };
}


// ============================================================================
// Default export
// ============================================================================

export default Object.freeze({
  schemaVersion:
    EMBEDDING_PROVIDER_SCHEMA_VERSION,

  provider:
    EMBEDDING_PROVIDER,

  version:
    EMBEDDING_PROVIDER_VERSION,

  model:
    DEFAULT_EMBEDDING_MODEL,

  dimensions:
    DEFAULT_EMBEDDING_DIMENSIONS,

  task:
    EMBEDDING_TASK,

  embedText,

  embedDocument,

  embedQuery,

  embedBatch,

  attachEmbeddingToRagDocument,

  attachEmbeddingsToRagDocuments,

  summarize:
    summarizeEmbeddingResult,

  runtimeInfo:
    getEmbeddingRuntimeInfo
});
