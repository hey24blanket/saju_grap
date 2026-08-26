// lib/ragDocumentSchema.js
// SajuGrap RAG Document Schema v1
// -----------------------------------------------------------------------------
// 역할
// - RAG 원천 문서를 "검색 가능한 의미 단위 chunk"로 정규화한다.
// - production RAG 문서의 공통 JSON 계약을 고정한다.
// - Engine Facts를 계산하거나 재판정하지 않는다.
// - Vector DB / Firestore 구현에 직접 종속되지 않는다.
// - 실제 embedding 생성은 embeddingProvider.js가 담당한다.
// -----------------------------------------------------------------------------

export const RAG_DOCUMENT_SCHEMA_VERSION = 'rag_document_v1';
export const RAG_DOCUMENT_SCHEMA_IMPLEMENTATION_VERSION = '1.0.0';

export const RAG_CORPUS = Object.freeze({
  PRODUCTION: 'production',
  EVALUATION_NEGATIVE: 'evaluation_negative'
});

export const RAG_DOCUMENT_STATUS = Object.freeze({
  DRAFT: 'draft',
  ACTIVE: 'active',
  INACTIVE: 'inactive'
});

export const RAG_DOMAINS = Object.freeze([
  'all',
  'career',
  'wealth',
  'mental',
  'love',
  'shared'
]);

export const RAG_CYCLE_TYPES = Object.freeze([
  'natal',
  'daewoon',
  'year',
  'month',
  'day',
  'hour',
  'shared'
]);

export const RAG_FACT_TYPES = Object.freeze([
  'strength',
  'useful_god',
  'ten_god',
  'star',
  'relation',
  'cycle',
  'wave',
  'strategy',
  'prohibition',
  'combination',
  'general'
]);

export const RAG_STRENGTH_BANDS = Object.freeze([
  'very_weak',
  'weak',
  'balanced',
  'strong',
  'very_strong'
]);

export const RAG_TEN_GOD_GROUPS = Object.freeze([
  'peer',
  'output',
  'wealth',
  'officer',
  'resource'
]);

export const RAG_ELEMENTS = Object.freeze([
  'wood',
  'fire',
  'earth',
  'metal',
  'water'
]);

export const RAG_YONGSIN_MECHANISMS = Object.freeze([
  'regulation',
  'climate',
  'bridge',
  'disease_remedy',
  'special_structure',
  'mixed'
]);

export const RAG_STRATEGY_MODES = Object.freeze([
  'expansion',
  'neutral',
  'contraction',
  'mixed'
]);

export const RAG_RELATION_TYPES = Object.freeze([
  'stem_five_combination',
  'branch_six_harmony',
  'branch_clash',
  'branch_three_harmony',
  'branch_seasonal_meeting',
  'half_harmony',
  'branch_punishment',
  'branch_harm',
  'branch_break'
]);

export const RAG_STAR_IDS = Object.freeze([
  'CHEONUL',
  'MUNCHANG',
  'YIMA',
  'DOHWA',
  'HWAGAE',
  'YANGIN',
  'GOEGANG',
  'HAKDANG'
]);

export const RAG_INTERPRETATION_CAPABILITIES = Object.freeze([
  'factMeaning',
  'strengthStateMeaning',
  'combinationMeaning',
  'timeAxisMeaning',
  'actionStrategy',
  'domainStrategy',
  'prohibitedInterpretation',
  'uncertaintyExpression'
]);

export const RAG_DOCUMENT_ERROR = Object.freeze({
  INVALID_DOCUMENT: 'SG-RAG-DOC-001',
  INVALID_SCHEMA: 'SG-RAG-DOC-002',
  INVALID_CHUNK_ID: 'SG-RAG-DOC-003',
  INVALID_SOURCE: 'SG-RAG-DOC-004',
  INVALID_CONTENT: 'SG-RAG-DOC-005',
  INVALID_DOMAIN: 'SG-RAG-DOC-006',
  INVALID_CYCLE_TYPE: 'SG-RAG-DOC-007',
  INVALID_FACT_TYPE: 'SG-RAG-DOC-008',
  INVALID_METADATA: 'SG-RAG-DOC-009',
  INVALID_CORPUS_POLICY: 'SG-RAG-DOC-010',
  INVALID_EMBEDDING: 'SG-RAG-DOC-011'
});

const DEFAULT_LOCALE = 'ko-KR';
const DEFAULT_SOURCE_VERSION = '1.0.0';
const DEFAULT_CHUNKING_STRATEGY = 'semantic';
const MAX_CONTENT_CHARS = 12000;
const MAX_TITLE_CHARS = 180;
const MAX_EMBEDDING_TEXT_CHARS = 16000;
const MAX_KEYWORDS = 40;
const MAX_ALIASES = 40;
const MAX_METADATA_VALUES = 30;


// ============================================================================
// Error
// ============================================================================

export class RagDocumentSchemaError extends Error {
  constructor({
    code,
    message,
    field = null,
    detail = null
  }) {
    super(message);

    this.name = 'RagDocumentSchemaError';
    this.code = code;
    this.field = field;
    this.detail = detail;
  }
}


// ============================================================================
// Utilities
// ============================================================================

function isPlainObject(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function safeObject(value) {
  return isPlainObject(value)
    ? value
    : {};
}

function safeArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function cleanText(value, maxLength = 500) {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  return String(value)
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

function cleanMultilineText(value, maxLength = MAX_CONTENT_CHARS) {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

function uniqueStrings(
  values,
  maxItems = MAX_METADATA_VALUES
) {
  const result = [];
  const seen = new Set();

  for (
    const raw of
    safeArray(values)
  ) {
    const value =
      cleanText(raw, 120);

    if (!value) {
      continue;
    }

    if (
      seen.has(value)
    ) {
      continue;
    }

    seen.add(value);
    result.push(value);

    if (
      result.length >=
      maxItems
    ) {
      break;
    }
  }

  return result;
}

function enumArray(
  values,
  allowed,
  maxItems = MAX_METADATA_VALUES
) {
  return uniqueStrings(
    values,
    maxItems
  ).filter(
    (value) =>
      allowed.includes(value)
  );
}

function normalizeBooleanMap(
  value,
  allowedKeys
) {
  const source =
    safeObject(value);

  return Object.fromEntries(
    allowedKeys.map(
      (key) => [
        key,
        source[key] === true
      ]
    )
  );
}

function compactObject(obj) {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([, value]) => {
        if (
          value === null ||
          value === undefined ||
          value === ''
        ) {
          return false;
        }

        if (
          Array.isArray(value) &&
          value.length === 0
        ) {
          return false;
        }

        if (
          isPlainObject(value) &&
          Object.keys(value).length === 0
        ) {
          return false;
        }

        return true;
      })
  );
}

function slugify(value) {
  return cleanText(value, 240)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
}

function normalizeOptionalInteger(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isInteger(parsed)
    ? parsed
    : null;
}


// ============================================================================
// Source
// ============================================================================

function normalizeSource(source) {
  const raw =
    safeObject(source);

  const sourceId =
    cleanText(
      raw.sourceId,
      180
    );

  if (!sourceId) {
    throw new RagDocumentSchemaError({
      code:
        RAG_DOCUMENT_ERROR
          .INVALID_SOURCE,

      field:
        'source.sourceId',

      message:
        'RAG sourceId가 필요합니다.'
    });
  }

  return compactObject({
    sourceId,

    sourceVersion:
      cleanText(
        raw.sourceVersion ||
        DEFAULT_SOURCE_VERSION,
        80
      ),

    title:
      cleanText(
        raw.title,
        300
      ) ||
      null,

    section:
      cleanText(
        raw.section,
        300
      ) ||
      null,

    subsection:
      cleanText(
        raw.subsection,
        300
      ) ||
      null,

    pageStart:
      normalizeOptionalInteger(
        raw.pageStart
      ),

    pageEnd:
      normalizeOptionalInteger(
        raw.pageEnd
      ),

    sourceType:
      cleanText(
        raw.sourceType ||
        'manual',
        80
      ),

    sourceUri:
      cleanText(
        raw.sourceUri,
        1000
      ) ||
      null
  });
}


// ============================================================================
// Metadata
// ============================================================================

function normalizeTenGodGroupBands(
  value
) {
  const raw =
    safeObject(value);

  const result = {};

  for (
    const group of
    RAG_TEN_GOD_GROUPS
  ) {
    const bands =
      enumArray(
        raw[group],
        RAG_STRENGTH_BANDS
      );

    if (
      bands.length > 0
    ) {
      result[group] =
        bands;
    }
  }

  return result;
}

function normalizeMetadata(metadata) {
  const raw =
    safeObject(metadata);

  return compactObject({
    strengthBands:
      enumArray(
        raw.strengthBands,
        RAG_STRENGTH_BANDS
      ),

    dominantImbalances:
      uniqueStrings(
        raw.dominantImbalances
      ),

    imbalanceSeverities:
      uniqueStrings(
        raw.imbalanceSeverities
      ),

    tenGodGroups:
      enumArray(
        raw.tenGodGroups,
        RAG_TEN_GOD_GROUPS
      ),

    tenGodGroupBands:
      normalizeTenGodGroupBands(
        raw.tenGodGroupBands
      ),

    yongsinElements:
      enumArray(
        raw.yongsinElements,
        RAG_ELEMENTS
      ),

    yongsinMechanisms:
      enumArray(
        raw.yongsinMechanisms,
        RAG_YONGSIN_MECHANISMS
      ),

    yongsinNeeds:
      uniqueStrings(
        raw.yongsinNeeds
      ),

    yongsinAvailabilities:
      uniqueStrings(
        raw.yongsinAvailabilities
      ),

    starIds:
      enumArray(
        raw.starIds,
        RAG_STAR_IDS
      ),

    relationTypes:
      enumArray(
        raw.relationTypes,
        RAG_RELATION_TYPES
      ),

    twelveStageKeys:
      uniqueStrings(
        raw.twelveStageKeys
      ),

    balanceEffects:
      uniqueStrings(
        raw.balanceEffects
      ),

    cycleTenGodGroups:
      enumArray(
        raw.cycleTenGodGroups,
        RAG_TEN_GOD_GROUPS
      ),

    strategyModes:
      enumArray(
        raw.strategyModes,
        RAG_STRATEGY_MODES
      ),

    keywords:
      uniqueStrings(
        raw.keywords,
        MAX_KEYWORDS
      ),

    aliases:
      uniqueStrings(
        raw.aliases,
        MAX_ALIASES
      )
  });
}


// ============================================================================
// Interpretation policy
// ============================================================================

function normalizeInterpretationPolicy(
  value
) {
  const normalized =
    normalizeBooleanMap(
      value,
      RAG_INTERPRETATION_CAPABILITIES
    );

  return {
    ...normalized,

    mayRecalculateEngineFacts:
      false,

    mayOverrideEngineFacts:
      false,

    mayInferMissingEngineFacts:
      false
  };
}


// ============================================================================
// Chunk metadata
// ============================================================================

function normalizeChunking(
  value
) {
  const raw =
    safeObject(value);

  return compactObject({
    strategy:
      cleanText(
        raw.strategy ||
        DEFAULT_CHUNKING_STRATEGY,
        80
      ),

    chunkIndex:
      normalizeOptionalInteger(
        raw.chunkIndex
      ),

    chunkTotal:
      normalizeOptionalInteger(
        raw.chunkTotal
      ),

    estimatedTokens:
      normalizeOptionalInteger(
        raw.estimatedTokens
      ),

    overlapGroup:
      cleanText(
        raw.overlapGroup,
        160
      ) ||
      null
  });
}


// ============================================================================
// Embedding metadata
// ----------------------------------------------------------------------------
// vector 자체는 build 시점에는 없어도 된다.
// embeddingProvider.js가 생성한 뒤 model/dimensions/vector를 채울 수 있다.
// ============================================================================

function normalizeEmbedding(
  value
) {
  const raw =
    safeObject(value);

  const vector =
    safeArray(
      raw.vector
    );

  const cleanVector =
    vector.length > 0 &&
    vector.every(
      (number) =>
        typeof number === 'number' &&
        Number.isFinite(number)
    )
      ? vector
      : [];

  const dimensions =
    normalizeOptionalInteger(
      raw.dimensions
    ) ??
    (
      cleanVector.length > 0
        ? cleanVector.length
        : null
    );

  return compactObject({
    provider:
      cleanText(
        raw.provider,
        80
      ) ||
      null,

    model:
      cleanText(
        raw.model,
        180
      ) ||
      null,

    dimensions,

    vector:
      cleanVector,

    embeddedAt:
      cleanText(
        raw.embeddedAt,
        80
      ) ||
      null
  });
}


// ============================================================================
// Embedding text
// ----------------------------------------------------------------------------
// content만 넣는 대신 검색 구별에 도움이 되는 canonical metadata를
// 짧게 앞에 붙인다.
// RAG 원문 의미를 왜곡하는 새로운 해석문은 생성하지 않는다.
// ============================================================================

export function buildRagEmbeddingText(
  document
) {
  const metadata =
    safeObject(
      document.metadata
    );

  const parts = [];

  const push =
    (label, value) => {
      if (
        value === null ||
        value === undefined ||
        value === ''
      ) {
        return;
      }

      if (
        Array.isArray(value)
      ) {
        if (
          value.length === 0
        ) {
          return;
        }

        parts.push(
          `${label}: ${value.join(', ')}`
        );

        return;
      }

      if (
        isPlainObject(value)
      ) {
        const text =
          Object.entries(value)
            .flatMap(
              ([key, item]) => {
                if (
                  Array.isArray(item)
                ) {
                  return item.map(
                    (entry) =>
                      `${key}=${entry}`
                  );
                }

                return [
                  `${key}=${item}`
                ];
              }
            )
            .join(', ');

        if (text) {
          parts.push(
            `${label}: ${text}`
          );
        }

        return;
      }

      parts.push(
        `${label}: ${value}`
      );
    };

  push(
    'title',
    document.title
  );

  push(
    'domain',
    document.domain
  );

  push(
    'cycleType',
    document.cycleType
  );

  push(
    'factType',
    document.factType
  );

  push(
    'strengthBands',
    metadata.strengthBands
  );

  push(
    'dominantImbalances',
    metadata.dominantImbalances
  );

  push(
    'tenGodGroups',
    metadata.tenGodGroups
  );

  push(
    'tenGodGroupBands',
    metadata.tenGodGroupBands
  );

  push(
    'yongsinElements',
    metadata.yongsinElements
  );

  push(
    'yongsinMechanisms',
    metadata.yongsinMechanisms
  );

  push(
    'starIds',
    metadata.starIds
  );

  push(
    'relationTypes',
    metadata.relationTypes
  );

  push(
    'strategyModes',
    metadata.strategyModes
  );

  push(
    'keywords',
    metadata.keywords
  );

  push(
    'aliases',
    metadata.aliases
  );

  parts.push(
    `content:\n${document.content}`
  );

  return parts
    .join('\n')
    .slice(
      0,
      MAX_EMBEDDING_TEXT_CHARS
    );
}


// ============================================================================
// Create / normalize document
// ============================================================================

export function createRagDocument(
  input
) {
  if (
    !isPlainObject(input)
  ) {
    throw new RagDocumentSchemaError({
      code:
        RAG_DOCUMENT_ERROR
          .INVALID_DOCUMENT,

      message:
        'RAG 문서는 객체여야 합니다.'
    });
  }

  const source =
    normalizeSource(
      input.source
    );

  const title =
    cleanText(
      input.title,
      MAX_TITLE_CHARS
    );

  const content =
    cleanMultilineText(
      input.content,
      MAX_CONTENT_CHARS
    );

  if (!title) {
    throw new RagDocumentSchemaError({
      code:
        RAG_DOCUMENT_ERROR
          .INVALID_CONTENT,

      field:
        'title',

      message:
        'RAG chunk title이 필요합니다.'
    });
  }

  if (!content) {
    throw new RagDocumentSchemaError({
      code:
        RAG_DOCUMENT_ERROR
          .INVALID_CONTENT,

      field:
        'content',

      message:
        'RAG chunk content가 비어 있습니다.'
    });
  }

  const domain =
    cleanText(
      input.domain ||
      'all',
      40
    );

  if (
    !RAG_DOMAINS.includes(
      domain
    )
  ) {
    throw new RagDocumentSchemaError({
      code:
        RAG_DOCUMENT_ERROR
          .INVALID_DOMAIN,

      field:
        'domain',

      message:
        `지원하지 않는 RAG domain입니다: ${domain}`
    });
  }

  const cycleType =
    cleanText(
      input.cycleType ||
      'shared',
      40
    );

  if (
    !RAG_CYCLE_TYPES.includes(
      cycleType
    )
  ) {
    throw new RagDocumentSchemaError({
      code:
        RAG_DOCUMENT_ERROR
          .INVALID_CYCLE_TYPE,

      field:
        'cycleType',

      message:
        `지원하지 않는 RAG cycleType입니다: ${cycleType}`
    });
  }

  const factType =
    cleanText(
      input.factType ||
      'general',
      60
    );

  if (
    !RAG_FACT_TYPES.includes(
      factType
    )
  ) {
    throw new RagDocumentSchemaError({
      code:
        RAG_DOCUMENT_ERROR
          .INVALID_FACT_TYPE,

      field:
        'factType',

      message:
        `지원하지 않는 RAG factType입니다: ${factType}`
    });
  }

  const corpus =
    cleanText(
      input.corpus ||
      RAG_CORPUS.PRODUCTION,
      60
    );

  if (
    !Object
      .values(RAG_CORPUS)
      .includes(corpus)
  ) {
    throw new RagDocumentSchemaError({
      code:
        RAG_DOCUMENT_ERROR
          .INVALID_CORPUS_POLICY,

      field:
        'corpus',

      message:
        `지원하지 않는 corpus입니다: ${corpus}`
    });
  }

  const status =
    cleanText(
      input.status ||
      RAG_DOCUMENT_STATUS.DRAFT,
      40
    );

  if (
    !Object
      .values(
        RAG_DOCUMENT_STATUS
      )
      .includes(status)
  ) {
    throw new RagDocumentSchemaError({
      code:
        RAG_DOCUMENT_ERROR
          .INVALID_DOCUMENT,

      field:
        'status',

      message:
        `지원하지 않는 document status입니다: ${status}`
    });
  }

  const metadata =
    normalizeMetadata(
      input.metadata
    );

  const interpretationPolicy =
    normalizeInterpretationPolicy(
      input.interpretationPolicy
    );

  const chunking =
    normalizeChunking(
      input.chunking
    );

  const embedding =
    normalizeEmbedding(
      input.embedding
    );

  const suppliedChunkId =
    cleanText(
      input.chunkId,
      180
    );

  const chunkId =
    suppliedChunkId ||
    slugify(
      [
        source.sourceId,
        factType,
        domain,
        cycleType,
        title,
        chunking.chunkIndex
      ]
        .filter(
          (value) =>
            value !== null &&
            value !== undefined &&
            value !== ''
        )
        .join('_')
    );

  if (!chunkId) {
    throw new RagDocumentSchemaError({
      code:
        RAG_DOCUMENT_ERROR
          .INVALID_CHUNK_ID,

      field:
        'chunkId',

      message:
        'RAG chunkId를 생성할 수 없습니다.'
    });
  }

  const document = {
    schemaVersion:
      RAG_DOCUMENT_SCHEMA_VERSION,

    schemaImplementationVersion:
      RAG_DOCUMENT_SCHEMA_IMPLEMENTATION_VERSION,

    chunkId,

    corpus,

    status,

    locale:
      cleanText(
        input.locale ||
        DEFAULT_LOCALE,
        40
      ),

    source,

    title,
    content,

    domain,
    cycleType,
    factType,

    metadata,

    interpretationPolicy,

    chunking,

    embeddingText:
      '',

    embedding,

    createdAt:
      cleanText(
        input.createdAt,
        80
      ) ||
      null,

    updatedAt:
      cleanText(
        input.updatedAt,
        80
      ) ||
      null
  };

  document.embeddingText =
    buildRagEmbeddingText(
      document
    );

  const validation =
    validateRagDocument(
      document
    );

  if (
    !validation.valid
  ) {
    throw new RagDocumentSchemaError({
      code:
        RAG_DOCUMENT_ERROR
          .INVALID_DOCUMENT,

      message:
        'RAG Document Schema 검증에 실패했습니다.',

      detail:
        validation.errors
          .map(
            (item) =>
              `${item.field}: ${item.message}`
          )
          .join(' | ')
    });
  }

  return document;
}


// ============================================================================
// Validation
// ============================================================================

export function validateRagDocument(
  document
) {
  const errors = [];
  const warnings = [];

  const addError =
    (
      field,
      message
    ) => {
      errors.push({
        field,
        message
      });
    };

  const addWarning =
    (
      field,
      message
    ) => {
      warnings.push({
        field,
        message
      });
    };

  if (
    !isPlainObject(
      document
    )
  ) {
    return {
      valid:
        false,

      errors: [
        {
          field:
            'document',

          message:
            'Document must be an object.'
        }
      ],

      warnings: []
    };
  }

  if (
    document.schemaVersion !==
    RAG_DOCUMENT_SCHEMA_VERSION
  ) {
    addError(
      'schemaVersion',
      `Expected ${RAG_DOCUMENT_SCHEMA_VERSION}.`
    );
  }

  if (
    !cleanText(
      document.chunkId,
      180
    )
  ) {
    addError(
      'chunkId',
      'chunkId is required.'
    );
  }

  if (
    !isPlainObject(
      document.source
    ) ||
    !cleanText(
      document.source
        ?.sourceId,
      180
    )
  ) {
    addError(
      'source.sourceId',
      'sourceId is required.'
    );
  }

  if (
    !cleanText(
      document.title,
      MAX_TITLE_CHARS
    )
  ) {
    addError(
      'title',
      'title is required.'
    );
  }

  if (
    !cleanMultilineText(
      document.content,
      MAX_CONTENT_CHARS
    )
  ) {
    addError(
      'content',
      'content is required.'
    );
  }

  if (
    !RAG_DOMAINS.includes(
      document.domain
    )
  ) {
    addError(
      'domain',
      'Invalid domain.'
    );
  }

  if (
    !RAG_CYCLE_TYPES.includes(
      document.cycleType
    )
  ) {
    addError(
      'cycleType',
      'Invalid cycleType.'
    );
  }

  if (
    !RAG_FACT_TYPES.includes(
      document.factType
    )
  ) {
    addError(
      'factType',
      'Invalid factType.'
    );
  }

  if (
    !Object
      .values(RAG_CORPUS)
      .includes(
        document.corpus
      )
  ) {
    addError(
      'corpus',
      'Invalid corpus.'
    );
  }

  if (
    !Object
      .values(
        RAG_DOCUMENT_STATUS
      )
      .includes(
        document.status
      )
  ) {
    addError(
      'status',
      'Invalid status.'
    );
  }

  if (
    !isPlainObject(
      document.metadata
    )
  ) {
    addError(
      'metadata',
      'metadata must be an object.'
    );
  }

  if (
    !isPlainObject(
      document
        .interpretationPolicy
    )
  ) {
    addError(
      'interpretationPolicy',
      'interpretationPolicy must be an object.'
    );
  } else {
    if (
      document
        .interpretationPolicy
        .mayRecalculateEngineFacts !==
      false
    ) {
      addError(
        'interpretationPolicy.mayRecalculateEngineFacts',
        'Engine Fact recalculation must be false.'
      );
    }

    if (
      document
        .interpretationPolicy
        .mayOverrideEngineFacts !==
      false
    ) {
      addError(
        'interpretationPolicy.mayOverrideEngineFacts',
        'Engine Fact override must be false.'
      );
    }

    if (
      document
        .interpretationPolicy
        .mayInferMissingEngineFacts !==
      false
    ) {
      addError(
        'interpretationPolicy.mayInferMissingEngineFacts',
        'Missing Engine Fact inference must be false.'
      );
    }
  }

  if (
    document.corpus ===
      RAG_CORPUS.PRODUCTION &&
    document.metadata
      ?.negativeExample === true
  ) {
    addError(
      'metadata.negativeExample',
      'Negative examples cannot be stored in the production corpus.'
    );
  }

  const vector =
    document.embedding
      ?.vector;

  if (
    Array.isArray(vector) &&
    vector.length > 0
  ) {
    if (
      !vector.every(
        (number) =>
          typeof number ===
            'number' &&
          Number.isFinite(number)
      )
    ) {
      addError(
        'embedding.vector',
        'Embedding vector contains invalid values.'
      );
    }

    if (
      document.embedding
        ?.dimensions &&
      vector.length !==
        document.embedding
          .dimensions
    ) {
      addError(
        'embedding.dimensions',
        'Embedding dimensions do not match vector length.'
      );
    }
  }

  if (
    document.status ===
      RAG_DOCUMENT_STATUS.ACTIVE &&
    !cleanText(
      document.embeddingText,
      MAX_EMBEDDING_TEXT_CHARS
    )
  ) {
    addError(
      'embeddingText',
      'Active RAG documents require embeddingText.'
    );
  }

  if (
    document.status ===
      RAG_DOCUMENT_STATUS.ACTIVE &&
    (
      !Array.isArray(vector) ||
      vector.length === 0
    )
  ) {
    addWarning(
      'embedding.vector',
      'Active document has no embedding yet. It cannot be vector-searched until embedding is generated.'
    );
  }

  const estimatedTokens =
    document.chunking
      ?.estimatedTokens;

  if (
    Number.isInteger(
      estimatedTokens
    ) &&
    estimatedTokens > 900
  ) {
    addWarning(
      'chunking.estimatedTokens',
      'Chunk is larger than the recommended semantic target. Consider splitting it.'
    );
  }

  if (
    Number.isInteger(
      estimatedTokens
    ) &&
    estimatedTokens < 80
  ) {
    addWarning(
      'chunking.estimatedTokens',
      'Chunk is very small. Check whether it has enough semantic context.'
    );
  }

  return {
    valid:
      errors.length === 0,

    errors,
    warnings
  };
}


// ============================================================================
// Production eligibility
// ============================================================================

export function isProductionRagDocument(
  document
) {
  if (
    !document ||
    document.corpus !==
      RAG_CORPUS.PRODUCTION ||
    document.status !==
      RAG_DOCUMENT_STATUS.ACTIVE
  ) {
    return false;
  }

  const validation =
    validateRagDocument(
      document
    );

  return validation.valid;
}


// ============================================================================
// Firestore-neutral payload
// ----------------------------------------------------------------------------
// 실제 Firestore VectorValue 변환은 ragRetriever / corpus upload adapter에서 한다.
// 여기서는 plain JSON 형태만 반환한다.
// ============================================================================

export function toRagStoragePayload(
  document,
  {
    includeVector = true
  } = {}
) {
  const validation =
    validateRagDocument(
      document
    );

  if (
    !validation.valid
  ) {
    throw new RagDocumentSchemaError({
      code:
        RAG_DOCUMENT_ERROR
          .INVALID_DOCUMENT,

      message:
        '유효하지 않은 RAG 문서는 저장 payload로 변환할 수 없습니다.',

      detail:
        validation.errors
          .map(
            (item) =>
              `${item.field}: ${item.message}`
          )
          .join(' | ')
    });
  }

  const embedding =
    safeObject(
      document.embedding
    );

  const storageEmbedding =
    includeVector
      ? embedding
      : Object.fromEntries(
          Object.entries(
            embedding
          ).filter(
            ([key]) =>
              key !== 'vector'
          )
        );

  return {
    schemaVersion:
      document.schemaVersion,

    schemaImplementationVersion:
      document
        .schemaImplementationVersion,

    chunkId:
      document.chunkId,

    corpus:
      document.corpus,

    status:
      document.status,

    locale:
      document.locale,

    source:
      document.source,

    title:
      document.title,

    content:
      document.content,

    domain:
      document.domain,

    cycleType:
      document.cycleType,

    factType:
      document.factType,

    metadata:
      document.metadata,

    interpretationPolicy:
      document
        .interpretationPolicy,

    chunking:
      document.chunking,

    embeddingText:
      document.embeddingText,

    embedding:
      storageEmbedding,

    createdAt:
      document.createdAt,

    updatedAt:
      document.updatedAt
  };
}


// ============================================================================
// Compact diagnostics
// ============================================================================

export function summarizeRagDocument(
  document
) {
  if (
    !isPlainObject(
      document
    )
  ) {
    return null;
  }

  const validation =
    validateRagDocument(
      document
    );

  return {
    chunkId:
      document.chunkId ||
      null,

    schemaVersion:
      document.schemaVersion ||
      null,

    sourceId:
      document.source
        ?.sourceId ||
      null,

    domain:
      document.domain ||
      null,

    cycleType:
      document.cycleType ||
      null,

    factType:
      document.factType ||
      null,

    corpus:
      document.corpus ||
      null,

    status:
      document.status ||
      null,

    embeddingDimensions:
      document.embedding
        ?.dimensions ||
      (
        Array.isArray(
          document.embedding
            ?.vector
        )
          ? document.embedding
              .vector
              .length
          : 0
      ),

    valid:
      validation.valid,

    errorCount:
      validation.errors.length,

    warningCount:
      validation.warnings.length
  };
}


// ============================================================================
// Default export
// ============================================================================

export default Object.freeze({
  schemaVersion:
    RAG_DOCUMENT_SCHEMA_VERSION,

  implementationVersion:
    RAG_DOCUMENT_SCHEMA_IMPLEMENTATION_VERSION,

  create:
    createRagDocument,

  validate:
    validateRagDocument,

  buildEmbeddingText:
    buildRagEmbeddingText,

  isProduction:
    isProductionRagDocument,

  toStoragePayload:
    toRagStoragePayload,

  summarize:
    summarizeRagDocument
});
