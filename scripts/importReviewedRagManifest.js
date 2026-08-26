#!/usr/bin/env node
// scripts/importReviewedRagManifest.js
// SajuGrap Reviewed Manifest -> rag_document_v1 importer
// -----------------------------------------------------------------------------
// Source of truth for this importer:
// - reviewed manifest columns only
// - deterministic identifier/category mappings only
// - never infer Myeongri facts from prose content
// -----------------------------------------------------------------------------

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  createRagDocument,
  validateRagDocument,
  RAG_CORPUS,
  RAG_DOCUMENT_STATUS,
  RAG_STAR_IDS
} from '../lib/ragDocumentSchema.js';

const IMPORTER_VERSION = '1.0.0';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const DEFAULTS = Object.freeze({
  input: path.join(
    PROJECT_ROOT,
    'rag-source',
    'reviewed',
    'SajuGrap_RAG_Chunk_Manifest_v1.3_after_06_review.csv'
  ),

  productionOutput: path.join(
    PROJECT_ROOT,
    'data',
    'rag-corpus.reviewed.production.jsonl'
  ),

  evaluationOutput: path.join(
    PROJECT_ROOT,
    'data',
    'rag-corpus.reviewed.evaluation.jsonl'
  ),

  manifestOutput: path.join(
    PROJECT_ROOT,
    'data',
    'rag-corpus.reviewed.import-manifest.json'
  ),

  strict: true
});

const REQUIRED_COLUMNS = Object.freeze([
  'chunkId',
  'knowledgeId',
  'chunkPart',
  'chunkPartsTotal',
  'documentId',
  'documentName',
  'title',
  'category',
  'priority',
  'chunkMode',
  'sourceBasis',
  'sourcePdf',
  'sourcePage',
  'version',
  'embeddingDimension',
  'embeddingModel',
  'relatedKnowledgeIds',
  'text',
  'charCount',
  'contentHash',
  'isActive',
  'retrievalAllowed',
  'isNegative',
  'interpretationLayer'
]);

const ENGINE_STAR_IDS = Object.freeze([
  'TIAN_YI',
  'WEN_CHANG',
  'YIMA',
  'PEACH_BLOSSOM',
  'HUA_GAI',
  'YANG_REN',
  'KUI_GANG',
  'XUE_TANG'
]);


// ============================================================================
// Reviewed ID -> Engine/RAG metadata mapping
// ============================================================================

const STAR_IDS_BY_KNOWLEDGE_ID = Object.freeze({
  'SG-00-017': [
    'TIAN_YI',
    'WEN_CHANG'
  ],

  'SG-00-018': [
    'YIMA',
    'PEACH_BLOSSOM',
    'HUA_GAI'
  ],

  'SG-00-019': [
    'YANG_REN',
    'KUI_GANG',
    'XUE_TANG'
  ],

  'SG-E-STAR-101': [
    'TIAN_YI'
  ],

  'SG-E-STAR-102': [
    'WEN_CHANG'
  ],

  'SG-E-STAR-103': [
    'YIMA'
  ],

  'SG-E-STAR-104': [
    'PEACH_BLOSSOM'
  ],

  'SG-E-STAR-105': [
    'HUA_GAI'
  ],

  'SG-E-STAR-106': [
    'YANG_REN'
  ],

  'SG-E-STAR-107': [
    'KUI_GANG'
  ],

  'SG-E-STAR-108': [
    'XUE_TANG'
  ],

  'SG-F-STAR-001': [
    'PEACH_BLOSSOM'
  ],

  'SG-F-STAR-002': [
    'YIMA'
  ],

  'SG-F-STAR-003': [
    'HUA_GAI'
  ],

  'SG-F-STAR-004': [
    'TIAN_YI'
  ]
});


const RELATION_TYPES_BY_KNOWLEDGE_ID = Object.freeze({
  'SG-E-REL-101': [
    'stem_five_combination'
  ],

  'SG-E-REL-102': [
    'branch_six_harmony'
  ],

  'SG-E-REL-103': [
    'branch_clash'
  ],

  'SG-E-REL-104': [
    'branch_three_harmony'
  ],

  'SG-E-REL-105': [
    'half_harmony'
  ],

  'SG-E-REL-106': [
    'branch_seasonal_meeting'
  ],

  'SG-E-REL-107': [
    'branch_punishment'
  ],

  'SG-E-REL-108': [
    'branch_harm'
  ],

  'SG-E-REL-109': [
    'branch_break'
  ],

  'SG-E-REL-110': [
    'branch_punishment'
  ],

  'SG-F-REL-001': [
    'branch_clash'
  ],

  'SG-F-REL-004': [
    'branch_punishment'
  ]
});


const TWELVE_STAGE_KEYS_BY_KNOWLEDGE_ID = Object.freeze({
  'SG-E-12STAGE-101': [
    'changsheng'
  ],

  'SG-E-12STAGE-102': [
    'muyu'
  ],

  'SG-E-12STAGE-103': [
    'guandai'
  ],

  'SG-E-12STAGE-104': [
    'linguan'
  ],

  'SG-E-12STAGE-105': [
    'diwang'
  ],

  'SG-E-12STAGE-106': [
    'shuai'
  ],

  'SG-E-12STAGE-107': [
    'bing'
  ],

  'SG-E-12STAGE-108': [
    'si'
  ],

  'SG-E-12STAGE-109': [
    'mu'
  ],

  'SG-E-12STAGE-110': [
    'jue'
  ],

  'SG-E-12STAGE-111': [
    'tai'
  ],

  'SG-E-12STAGE-112': [
    'yang'
  ]
});


const STRENGTH_BANDS_BY_KNOWLEDGE_ID = Object.freeze({
  'SG-B-002': [
    'very_strong'
  ],

  'SG-B-003': [
    'strong'
  ],

  'SG-B-004': [
    'balanced'
  ],

  'SG-B-005': [
    'weak'
  ],

  'SG-B-006': [
    'very_weak'
  ]
});


const TEN_GOD_GROUPS_BY_KNOWLEDGE_ID = Object.freeze({
  'SG-E-TENGOD-GROUP-001': [
    'peer'
  ],

  'SG-E-TENGOD-GROUP-002': [
    'output'
  ],

  'SG-E-TENGOD-GROUP-003': [
    'wealth'
  ],

  'SG-E-TENGOD-GROUP-004': [
    'officer'
  ],

  'SG-E-TENGOD-GROUP-005': [
    'resource'
  ]
});


const YONGSIN_MECHANISMS_BY_KNOWLEDGE_ID = Object.freeze({
  'SG-B-013': [
    'climate'
  ],

  'SG-B-026': [
    'regulation'
  ],

  'SG-B-027': [
    'bridge'
  ],

  'SG-B-028': [
    'disease_remedy'
  ]
});


// ============================================================================
// CLI
// ============================================================================

function printHelp() {
  console.log(`
SajuGrap Reviewed RAG Manifest Importer v${IMPORTER_VERSION}

사용법:
  node scripts/importReviewedRagManifest.js [options]

옵션:
  --input <csv>

  --production-output <jsonl>

  --evaluation-output <jsonl>

  --manifest-output <json>

  --no-strict

  --dry-run

  --help
`);
}


function parseArgs(argv) {
  const config = {
    ...DEFAULTS,

    dryRun: false
  };


  const requireValue = (
    index,
    flag
  ) => {
    const value =
      argv[index + 1];

    if (
      !value ||
      value.startsWith('--')
    ) {
      throw new Error(
        `${flag} 뒤에 값이 필요합니다.`
      );
    }

    return value;
  };


  for (
    let index = 0;
    index < argv.length;
    index += 1
  ) {
    const arg =
      argv[index];


    switch (arg) {
      case '--help':
        printHelp();

        process.exit(0);
        break;


      case '--dry-run':
        config.dryRun =
          true;
        break;


      case '--no-strict':
        config.strict =
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


      case '--production-output':
        config.productionOutput =
          path.resolve(
            PROJECT_ROOT,
            requireValue(
              index,
              arg
            )
          );

        index += 1;
        break;


      case '--evaluation-output':
        config.evaluationOutput =
          path.resolve(
            PROJECT_ROOT,
            requireValue(
              index,
              arg
            )
          );

        index += 1;
        break;


      case '--manifest-output':
        config.manifestOutput =
          path.resolve(
            PROJECT_ROOT,
            requireValue(
              index,
              arg
            )
          );

        index += 1;
        break;


      default:
        throw new Error(
          `알 수 없는 옵션입니다: ${arg}`
        );
    }
  }


  return config;
}


// ============================================================================
// CSV parser
// ----------------------------------------------------------------------------
// RFC4180 스타일:
// - quoted field
// - escaped quote ("")
// - multiline cell
//
// 외부 CSV dependency는 추가하지 않는다.
// ============================================================================

function parseCsv(text) {
  const rows = [];

  let row = [];
  let field = '';
  let inQuotes = false;


  for (
    let index = 0;
    index < text.length;
    index += 1
  ) {
    const char =
      text[index];

    const next =
      text[index + 1];


    if (
      inQuotes
    ) {
      if (
        char === '"' &&
        next === '"'
      ) {
        field += '"';

        index += 1;

        continue;
      }


      if (
        char === '"'
      ) {
        inQuotes =
          false;

        continue;
      }


      field +=
        char;

      continue;
    }


    if (
      char === '"'
    ) {
      inQuotes =
        true;

      continue;
    }


    if (
      char === ','
    ) {
      row.push(
        field
      );

      field = '';

      continue;
    }


    if (
      char === '\n'
    ) {
      row.push(
        field
      );

      rows.push(
        row
      );

      row = [];
      field = '';

      continue;
    }


    if (
      char === '\r'
    ) {
      if (
        next === '\n'
      ) {
        continue;
      }


      row.push(
        field
      );

      rows.push(
        row
      );

      row = [];
      field = '';

      continue;
    }


    field +=
      char;
  }


  if (
    inQuotes
  ) {
    throw new Error(
      'CSV quoted field가 닫히지 않았습니다.'
    );
  }


  if (
    field.length > 0 ||
    row.length > 0
  ) {
    row.push(
      field
    );

    rows.push(
      row
    );
  }


  return rows.filter(
    (item) =>
      item.some(
        (value) =>
          String(value)
            .trim() !== ''
      )
  );
}


function rowsToObjects(rows) {
  if (
    rows.length < 2
  ) {
    throw new Error(
      'CSV 데이터 행이 없습니다.'
    );
  }


  const headers =
    rows[0]
      .map(
        (
          value,
          index
        ) => {
          const cleaned =
            String(value)
              .replace(
                /^\uFEFF/,
                ''
              )
              .trim();


          if (
            !cleaned
          ) {
            throw new Error(
              `CSV header[${index}]가 비어 있습니다.`
            );
          }


          return cleaned;
        }
      );


  for (
    const required of
    REQUIRED_COLUMNS
  ) {
    if (
      !headers.includes(
        required
      )
    ) {
      throw new Error(
        `필수 CSV 컬럼이 없습니다: ${required}`
      );
    }
  }


  return rows
    .slice(1)
    .map(
      (
        values,
        rowIndex
      ) => {
        const result =
          {};


        for (
          let index = 0;
          index < headers.length;
          index += 1
        ) {
          result[
            headers[index]
          ] =
            values[index] ??
            '';
        }


        result.__rowNumber =
          rowIndex + 2;


        return result;
      }
    );
}


// ============================================================================
// Generic normalization
// ============================================================================

function cleanText(value) {
  return String(
    value ??
    ''
  ).trim();
}


function parseBoolean(
  value,
  defaultValue = null
) {
  const raw =
    cleanText(value)
      .toLowerCase();


  if (
    !raw
  ) {
    return defaultValue;
  }


  if (
    [
      'true',
      '1',
      'yes',
      'y'
    ].includes(raw)
  ) {
    return true;
  }


  if (
    [
      'false',
      '0',
      'no',
      'n'
    ].includes(raw)
  ) {
    return false;
  }


  return defaultValue;
}


function parseInteger(
  value,
  fallback = null
) {
  const raw =
    cleanText(value);


  if (
    !raw
  ) {
    return fallback;
  }


  const parsed =
    Number(raw);


  return Number.isInteger(
    parsed
  )
    ? parsed
    : fallback;
}


function parseRelatedKnowledgeIds(
  value
) {
  const raw =
    cleanText(
      value
    );


  if (
    !raw
  ) {
    return [];
  }


  try {
    const parsed =
      JSON.parse(
        raw
      );


    if (
      Array.isArray(
        parsed
      )
    ) {
      return [
        ...new Set(
          parsed
            .map(
              cleanText
            )
            .filter(
              Boolean
            )
        )
      ];
    }
  } catch {
    // delimiter parser fallback
  }


  return [
    ...new Set(
      raw
        .replace(
          /^\[|\]$/g,
          ''
        )
        .split(
          /[;,|]/
        )
        .map(
          (item) =>
            item
              .replace(
                /^["']|["']$/g,
                ''
              )
              .trim()
        )
        .filter(
          Boolean
        )
    )
  ];
}


function estimateTokens(text) {
  const normalized =
    cleanText(
      text
    );


  if (
    !normalized
  ) {
    return 0;
  }


  const hangul =
    (
      normalized.match(
        /[가-힣ㄱ-ㅎㅏ-ㅣ]/g
      ) ||
      []
    ).length;


  const cjk =
    (
      normalized.match(
        /[\u3400-\u9FFF]/g
      ) ||
      []
    ).length;


  const latin =
    (
      normalized.match(
        /[A-Za-z]+(?:['’-][A-Za-z]+)*/g
      ) ||
      []
    ).length;


  const numbers =
    (
      normalized.match(
        /\d+(?:[.,]\d+)*/g
      ) ||
      []
    ).length;


  return Math.max(
    1,

    Math.ceil(
      hangul * 0.78 +
      cjk * 0.95 +
      latin * 1.25 +
      numbers * 0.75
    )
  );
}


function sha256(text) {
  return crypto
    .createHash(
      'sha256'
    )
    .update(
      text,
      'utf8'
    )
    .digest(
      'hex'
    );
}


function unique(values) {
  return [
    ...new Set(
      values
        .map(
          cleanText
        )
        .filter(
          Boolean
        )
    )
  ];
}


// ============================================================================
// Schema compatibility
// ============================================================================

function assertSchemaCompatibility() {
  const missing =
    ENGINE_STAR_IDS
      .filter(
        (starId) =>
          !RAG_STAR_IDS.includes(
            starId
          )
      );


  if (
    missing.length > 0
  ) {
    throw new Error(
      [
        'ragDocumentSchema.js의 RAG_STAR_IDS가 Engine starId와 일치하지 않습니다.',

        `missing=${missing.join(', ')}`,

        'RAG_STAR_IDS를 Engine의 실제 ID(TIAN_YI, WEN_CHANG, YIMA, PEACH_BLOSSOM, HUA_GAI, YANG_REN, KUI_GANG, XUE_TANG)로 수정하세요.'
      ].join(' ')
    );
  }
}


// ============================================================================
// Deterministic reviewed metadata mapping
// ----------------------------------------------------------------------------
// 본문 text를 읽어서 metadata를 분류하지 않는다.
//
// 사용하는 것:
// - knowledgeId
// - category
// - title
// - reviewed manifest 구조
// ============================================================================

function mapFactType(row) {
  const category =
    cleanText(
      row.category
    );

  const lower =
    category
      .toLowerCase();


  if (
    lower.startsWith(
      'domain/'
    ) ||
    [
      'action_first',
      'response_architecture'
    ].includes(
      lower
    )
  ) {
    return 'strategy';
  }


  if (
    lower.startsWith(
      'cycle/'
    ) ||
    [
      'cycles',
      '시간축',
      'twelve_stage',
      '12운성'
    ].includes(
      lower
    )
  ) {
    return 'cycle';
  }


  if (
    [
      'strength',
      'strength_state',
      '강약',
      'special_structure'
    ].includes(
      lower
    )
  ) {
    return 'strength';
  }


  if (
    [
      'useful_god',
      'useful_god_mechanism',
      'useful_god_provenance',
      'candidate_interpretation',
      'climate',
      'imbalance',
      '용희한구기'
    ].includes(
      lower
    )
  ) {
    return 'useful_god';
  }


  if (
    [
      'ten_god',
      'ten_gods',
      'ten_god_group',
      '십신'
    ].includes(
      lower
    )
  ) {
    return 'ten_god';
  }


  if (
    [
      'stars',
      '귀인·신살'
    ].includes(
      lower
    )
  ) {
    return 'star';
  }


  if (
    [
      'relations',
      '관계 구조',
      'five_element_relation'
    ].includes(
      lower
    )
  ) {
    return 'relation';
  }


  if (
    [
      'wave_model',
      'low_point',
      'divergence',
      'sajugrap 파동'
    ].includes(
      lower
    )
  ) {
    return 'wave';
  }


  if (
    [
      'ethics_and_interpretation',
      'uncertainty',
      'tone_and_language',
      '출력 규칙',
      'governance'
    ].includes(
      lower
    )
  ) {
    return 'prohibition';
  }


  if (
    [
      'integration'
    ].includes(
      lower
    )
  ) {
    return 'combination';
  }


  return 'general';
}


function mapDomain(row) {
  const category =
    cleanText(
      row.category
    );


  const direct =
    {
      'Domain/총운':
        'all',

      'Domain/사업운':
        'career',

      'Domain/재물운':
        'wealth',

      'Domain/심신운':
        'mental',

      'Domain/연애운':
        'love',

      'Domain/Common':
        'shared',

      'Domain/Divergence':
        'shared',

      'Domain/Output':
        'shared'
    };


  return (
    direct[
      category
    ] ||
    'all'
  );
}


function mapCycleType(row) {
  const category =
    cleanText(
      row.category
    )
      .toLowerCase();


  if (
    !category.startsWith(
      'cycle/'
    )
  ) {
    return 'shared';
  }


  if (
    category ===
      'cycle/daewoon' ||
    category.startsWith(
      'cycle/daewoon/'
    )
  ) {
    return 'daewoon';
  }


  if (
    category ===
      'cycle/year' ||
    category.startsWith(
      'cycle/year/'
    )
  ) {
    return 'year';
  }


  if (
    category ===
      'cycle/month' ||
    category.startsWith(
      'cycle/month/'
    )
  ) {
    return 'month';
  }


  if (
    category ===
      'cycle/day' ||
    category.startsWith(
      'cycle/day/'
    )
  ) {
    return 'day';
  }


  if (
    category ===
      'cycle/hour' ||
    category.startsWith(
      'cycle/hour/'
    )
  ) {
    return 'hour';
  }


  return 'shared';
}


function strategyModesFor(row) {
  const category =
    cleanText(
      row.category
    )
      .toLowerCase();

  const title =
    cleanText(
      row.title
    );


  if (
    category.includes(
      '/expansion'
    ) ||
    title.includes(
      '발산'
    )
  ) {
    return [
      'expansion'
    ];
  }


  if (
    category.includes(
      '/contraction'
    ) ||
    title.includes(
      '수렴'
    ) ||
    title.includes(
      '저점'
    )
  ) {
    return [
      'contraction'
    ];
  }


  if (
    title.includes(
      '중립'
    )
  ) {
    return [
      'neutral'
    ];
  }


  return [];
}


function buildMetadata(row) {
  const knowledgeId =
    cleanText(
      row.knowledgeId
    );


  return {
    strengthBands:
      STRENGTH_BANDS_BY_KNOWLEDGE_ID[
        knowledgeId
      ] ||
      [],


    tenGodGroups:
      TEN_GOD_GROUPS_BY_KNOWLEDGE_ID[
        knowledgeId
      ] ||
      [],


    yongsinMechanisms:
      YONGSIN_MECHANISMS_BY_KNOWLEDGE_ID[
        knowledgeId
      ] ||
      [],


    starIds:
      STAR_IDS_BY_KNOWLEDGE_ID[
        knowledgeId
      ] ||
      [],


    relationTypes:
      RELATION_TYPES_BY_KNOWLEDGE_ID[
        knowledgeId
      ] ||
      [],


    twelveStageKeys:
      TWELVE_STAGE_KEYS_BY_KNOWLEDGE_ID[
        knowledgeId
      ] ||
      [],


    strategyModes:
      strategyModesFor(
        row
      ),


    keywords:
      unique([
        cleanText(
          row.category
        ),

        cleanText(
          row.documentName
        ),

        cleanText(
          row.knowledgeId
        ),

        cleanText(
          row.interpretationLayer
        )
      ]),


    aliases:
      unique([
        cleanText(
          row.title
        )
      ])
  };
}


function buildInterpretationPolicy(
  row,
  factType,
  domain,
  cycleType
) {
  return {
    factMeaning:
      true,


    strengthStateMeaning:
      [
        'strength',
        'useful_god',
        'ten_god'
      ].includes(
        factType
      ),


    combinationMeaning:
      [
        'relation',
        'combination'
      ].includes(
        factType
      ),


    timeAxisMeaning:
      cycleType !==
        'shared' ||
      [
        'cycle',
        'wave',
        'strategy'
      ].includes(
        factType
      ),


    actionStrategy:
      true,


    domainStrategy:
      domain !==
        'all' ||
      factType ===
        'strategy',


    prohibitedInterpretation:
      true,


    uncertaintyExpression:
      true
  };
}


// ============================================================================
// Reviewed row policy
// ============================================================================

function classifyReviewedRow(row) {
  const isActive =
    parseBoolean(
      row.isActive,
      true
    );


  const isNegative =
    parseBoolean(
      row.isNegative,
      false
    );


  // v1.3의 기존 검수 chunk는 retrievalAllowed가 비어 있는 행이 존재한다.
  //
  // 비어 있는 경우:
  // - negative가 아니고
  // - 검수 완료된 기존 production chunk라면
  //
  // "명시적 제외가 아님"으로 취급한다.
  const retrievalAllowed =
    parseBoolean(
      row.retrievalAllowed,
      !isNegative
    );


  const corpus =
    isNegative ||
    retrievalAllowed === false
      ? RAG_CORPUS
          .EVALUATION_NEGATIVE
      : RAG_CORPUS
          .PRODUCTION;


  const status =
    isActive
      ? RAG_DOCUMENT_STATUS
          .ACTIVE
      : RAG_DOCUMENT_STATUS
          .INACTIVE;


  return {
    isActive,
    isNegative,
    retrievalAllowed,
    corpus,
    status
  };
}


// ============================================================================
// Reviewed content integrity
// ============================================================================

function verifyReviewedIntegrity(
  row
) {
  const errors = [];
  const warnings = [];


  const content =
    String(
      row.text ??
      ''
    );


  const expectedCharCount =
    parseInteger(
      row.charCount
    );


  const expectedHash =
    cleanText(
      row.contentHash
    );


  if (
    !cleanText(
      row.chunkId
    )
  ) {
    errors.push(
      'chunkId missing'
    );
  }


  if (
    !cleanText(
      row.knowledgeId
    )
  ) {
    errors.push(
      'knowledgeId missing'
    );
  }


  if (
    !cleanText(
      row.documentId
    )
  ) {
    errors.push(
      'documentId missing'
    );
  }


  if (
    !cleanText(
      row.title
    )
  ) {
    errors.push(
      'title missing'
    );
  }


  if (
    !content.trim()
  ) {
    errors.push(
      'text missing'
    );
  }


  if (
    expectedCharCount !==
      null &&
    content.length !==
      expectedCharCount
  ) {
    errors.push(
      `charCount mismatch expected=${expectedCharCount} actual=${content.length}`
    );
  }


  if (
    expectedHash &&
    sha256(
      content
    ) !==
      expectedHash
  ) {
    errors.push(
      'contentHash mismatch'
    );
  }


  const chunkPart =
    parseInteger(
      row.chunkPart
    );


  const chunkTotal =
    parseInteger(
      row.chunkPartsTotal
    );


  if (
    chunkPart === null ||
    chunkPart < 1
  ) {
    errors.push(
      'invalid chunkPart'
    );
  }


  if (
    chunkTotal === null ||
    chunkTotal < 1
  ) {
    errors.push(
      'invalid chunkPartsTotal'
    );
  }


  if (
    chunkPart !== null &&
    chunkTotal !== null &&
    chunkPart >
      chunkTotal
  ) {
    errors.push(
      'chunkPart exceeds chunkPartsTotal'
    );
  }


  if (
    !cleanText(
      row.category
    )
  ) {
    warnings.push(
      'category missing; factType will be general'
    );
  }


  return {
    valid:
      errors.length ===
      0,

    errors,
    warnings
  };
}


// ============================================================================
// Row -> rag_document_v1
// ============================================================================

function convertRow(row) {
  const integrity =
    verifyReviewedIntegrity(
      row
    );


  if (
    !integrity.valid
  ) {
    const error =
      new Error(
        `row=${row.__rowNumber} chunkId=${row.chunkId || 'missing'}: ${integrity.errors.join(' | ')}`
      );


    error.code =
      'SG-RAG-IMPORT-INTEGRITY-001';


    throw error;
  }


  const reviewedPolicy =
    classifyReviewedRow(
      row
    );


  const factType =
    mapFactType(
      row
    );


  const domain =
    mapDomain(
      row
    );


  const cycleType =
    mapCycleType(
      row
    );


  const content =
    String(
      row.text ??
      ''
    ).trim();


  const chunkPart =
    parseInteger(
      row.chunkPart,
      1
    );


  const chunkTotal =
    parseInteger(
      row.chunkPartsTotal,
      1
    );


  const sourcePage =
    parseInteger(
      row.sourcePage
    );


  const priority =
    parseInteger(
      row.priority,
      50
    );


  const embeddingDimension =
    parseInteger(
      row.embeddingDimension
    );


  const document =
    createRagDocument({
      chunkId:
        cleanText(
          row.chunkId
        ),


      corpus:
        reviewedPolicy
          .corpus,


      status:
        reviewedPolicy
          .status,


      locale:
        'ko-KR',


      source: {
        sourceId:
          cleanText(
            row.documentId
          ),


        sourceVersion:
          cleanText(
            row.version
          ) ||
          '1.0',


        title:
          cleanText(
            row.documentName
          ),


        section:
          cleanText(
            row.knowledgeId
          ),


        subsection:
          cleanText(
            row.title
          ),


        pageStart:
          sourcePage,


        pageEnd:
          sourcePage,


        sourceType:
          'reviewed_manifest',


        sourceUri:
          cleanText(
            row.sourcePdf
          )
      },


      title:
        cleanText(
          row.title
        ),


      content,


      domain,
      cycleType,
      factType,


      metadata:
        buildMetadata(
          row
        ),


      interpretationPolicy:
        buildInterpretationPolicy(
          row,
          factType,
          domain,
          cycleType
        ),


      chunking: {
        strategy:
          cleanText(
            row.chunkMode
          ) ||
          'reviewed_manifest',


        chunkIndex:
          Math.max(
            0,
            chunkPart - 1
          ),


        chunkTotal,


        estimatedTokens:
          estimateTokens(
            content
          ),


        overlapGroup:
          cleanText(
            row.knowledgeId
          )
      },


      embedding: {
        dimensions:
          embeddingDimension,


        model:
          cleanText(
            row.embeddingModel
          ) &&
          cleanText(
            row.embeddingModel
          ) !==
            'TO_BE_FIXED_BY_APP'

            ? cleanText(
                row.embeddingModel
              )

            : null
      }
    });


  // --------------------------------------------------------------------------
  // Reviewed Manifest provenance
  // --------------------------------------------------------------------------
  //
  // 기존 검수 manifest의 중요한 필드를 버리지 않는다.
  //
  // later:
  // - ranking priority
  // - relatedKnowledgeIds
  // - source audit
  // - migration
  //
  // 에 사용할 수 있다.
  // --------------------------------------------------------------------------

  document.reviewedManifest = {
    knowledgeId:
      cleanText(
        row.knowledgeId
      ),


    documentId:
      cleanText(
        row.documentId
      ),


    documentName:
      cleanText(
        row.documentName
      ),


    category:
      cleanText(
        row.category
      ),


    priority,


    chunkMode:
      cleanText(
        row.chunkMode
      ),


    sourceBasis:
      cleanText(
        row.sourceBasis
      ),


    sourcePdf:
      cleanText(
        row.sourcePdf
      ),


    sourcePage,


    version:
      cleanText(
        row.version
      ),


    embeddingDimension,


    embeddingModel:
      cleanText(
        row.embeddingModel
      ),


    relatedKnowledgeIds:
      parseRelatedKnowledgeIds(
        row.relatedKnowledgeIds
      ),


    charCount:
      parseInteger(
        row.charCount,
        content.length
      ),


    contentHash:
      cleanText(
        row.contentHash
      ),


    isActive:
      reviewedPolicy
        .isActive,


    retrievalAllowed:
      reviewedPolicy
        .retrievalAllowed,


    isNegative:
      reviewedPolicy
        .isNegative,


    interpretationLayer:
      cleanText(
        row.interpretationLayer
      ) ||
      null,


    importedFromRow:
      row.__rowNumber
  };


  const validation =
    validateRagDocument(
      document
    );


  if (
    !validation.valid
  ) {
    const error =
      new Error(
        `row=${row.__rowNumber} chunkId=${document.chunkId}: ${
          validation.errors
            .map(
              (item) =>
                `${item.field}: ${item.message}`
            )
            .join(
              ' | '
            )
        }`
      );


    error.code =
      'SG-RAG-IMPORT-SCHEMA-001';


    throw error;
  }


  // embedding이 아직 없는 것은 이 단계에서는 정상이다.
  // 실제 embedding은 다음 embeddingProvider 단계에서 생성한다.
  const validationWarnings =
    validation.warnings
      .filter(
        (item) =>
          item.field !==
          'embedding.vector'
      )
      .map(
        (item) =>
          `${item.field}: ${item.message}`
      );


  return {
    document,


    pendingEmbedding:
      !Array.isArray(
        document.embedding
          ?.vector
      ) ||
      document.embedding
        .vector
        .length === 0,


    warnings: [
      ...integrity.warnings,
      ...validationWarnings
    ]
  };
}


// ============================================================================
// Corpus validation
// ============================================================================

function validateCorpus(
  documents
) {
  const errors = [];

  const seen =
    new Set();


  for (
    const document of
    documents
  ) {
    if (
      seen.has(
        document.chunkId
      )
    ) {
      errors.push(
        `duplicate chunkId=${document.chunkId}`
      );
    }


    seen.add(
      document.chunkId
    );


    if (
      document.corpus ===
        RAG_CORPUS
          .PRODUCTION &&
      document
        .reviewedManifest
        ?.isNegative ===
        true
    ) {
      errors.push(
        `negative in production=${document.chunkId}`
      );
    }


    if (
      document.corpus ===
        RAG_CORPUS
          .PRODUCTION &&
      document
        .reviewedManifest
        ?.retrievalAllowed ===
        false
    ) {
      errors.push(
        `retrieval-disallowed in production=${document.chunkId}`
      );
    }
  }


  return {
    valid:
      errors.length ===
      0,

    errors
  };
}


// ============================================================================
// Output helpers
// ============================================================================

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


async function writeJsonl(
  filePath,
  documents
) {
  await ensureParent(
    filePath
  );


  const text =
    documents
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
      documents.length > 0
        ? '\n'
        : ''
    );


  await fs.writeFile(
    filePath,
    text,
    'utf8'
  );
}


function countBy(
  documents,
  selector
) {
  const result =
    {};


  for (
    const document of
    documents
  ) {
    const key =
      selector(
        document
      ) ||
      'unknown';


    result[key] =
      (
        result[key] ||
        0
      ) + 1;
  }


  return result;
}


// ============================================================================
// Import Manifest
// ============================================================================

function buildImportManifest({
  config,
  sourceRowCount,
  documents,
  warnings,
  pendingEmbeddingCount
}) {
  const production =
    documents.filter(
      (item) =>
        item.corpus ===
        RAG_CORPUS
          .PRODUCTION
    );


  const evaluation =
    documents.filter(
      (item) =>
        item.corpus ===
        RAG_CORPUS
          .EVALUATION_NEGATIVE
    );


  return {
    schemaVersion:
      'rag_reviewed_import_manifest_v1',


    importerVersion:
      IMPORTER_VERSION,


    generatedAt:
      new Date()
        .toISOString(),


    input:
      path.relative(
        PROJECT_ROOT,
        config.input
      ),


    sourceRowCount,


    importedCount:
      documents.length,


    productionCount:
      production.length,


    evaluationCount:
      evaluation.length,


    warningCount:
      warnings.length,


    pendingEmbeddingCount,


    counts: {
      documentName:
        countBy(
          documents,

          (item) =>
            item
              .reviewedManifest
              ?.documentName
        ),


      category:
        countBy(
          documents,

          (item) =>
            item
              .reviewedManifest
              ?.category
        ),


      factType:
        countBy(
          documents,

          (item) =>
            item.factType
        ),


      domain:
        countBy(
          documents,

          (item) =>
            item.domain
        ),


      cycleType:
        countBy(
          documents,

          (item) =>
            item.cycleType
        )
    },


    outputs: {
      production:
        path.relative(
          PROJECT_ROOT,
          config
            .productionOutput
        ),


      evaluation:
        path.relative(
          PROJECT_ROOT,
          config
            .evaluationOutput
        )
    },


    policy: {
      source:
        'reviewed_manifest_only',


      proseMetadataInference:
        false,


      contentHashVerified:
        true,


      charCountVerified:
        true,


      negativeProductionMixing:
        false,


      blankRetrievalAllowedPolicy:
        'allowed_if_reviewed_non_negative'
    },


    warnings
  };
}


// ============================================================================
// Main
// ============================================================================

async function main() {
  const config =
    parseArgs(
      process.argv
        .slice(2)
    );


  assertSchemaCompatibility();


  const csvText =
    await fs.readFile(
      config.input,
      'utf8'
    );


  const sourceRows =
    rowsToObjects(
      parseCsv(
        csvText
      )
    );


  const documents = [];
  const warnings = [];
  const skipped = [];

  let pendingEmbeddingCount =
    0;


  for (
    const row of
    sourceRows
  ) {
    try {
      const converted =
        convertRow(
          row
        );


      documents.push(
        converted.document
      );


      if (
        converted
          .pendingEmbedding
      ) {
        pendingEmbeddingCount +=
          1;
      }


      for (
        const warning of
        converted.warnings
      ) {
        warnings.push({
          row:
            row.__rowNumber,


          chunkId:
            row.chunkId,


          warning
        });
      }

    } catch (error) {

      if (
        config.strict
      ) {
        throw error;
      }


      skipped.push({
        row:
          row.__rowNumber,


        chunkId:
          row.chunkId ||
          null,


        code:
          error.code ||
          'SG-RAG-IMPORT-ROW-001',


        message:
          error.message
      });
    }
  }


  const corpusValidation =
    validateCorpus(
      documents
    );


  if (
    !corpusValidation.valid
  ) {
    throw new Error(
      `Corpus validation failed: ${corpusValidation.errors.join(' | ')}`
    );
  }


  const production =
    documents.filter(
      (item) =>
        item.corpus ===
        RAG_CORPUS
          .PRODUCTION
    );


  const evaluation =
    documents.filter(
      (item) =>
        item.corpus ===
        RAG_CORPUS
          .EVALUATION_NEGATIVE
    );


  const importManifest =
    buildImportManifest({
      config,


      sourceRowCount:
        sourceRows.length,


      documents,


      warnings,


      pendingEmbeddingCount
    });


  importManifest.skippedCount =
    skipped.length;


  importManifest.skipped =
    skipped;


  console.log(
    ''
  );


  console.log(
    '=============================================='
  );


  console.log(
    ' SajuGrap Reviewed RAG Import'
  );


  console.log(
    '=============================================='
  );


  console.log(
    `source rows : ${sourceRows.length}`
  );


  console.log(
    `imported    : ${documents.length}`
  );


  console.log(
    `production  : ${production.length}`
  );


  console.log(
    `evaluation  : ${evaluation.length}`
  );


  console.log(
    `warnings    : ${warnings.length}`
  );


  console.log(
    `embed pending: ${pendingEmbeddingCount}`
  );


  console.log(
    `skipped     : ${skipped.length}`
  );


  console.log(
    `strict      : ${config.strict ? 'YES' : 'NO'}`
  );


  console.log(
    `dry run     : ${config.dryRun ? 'YES' : 'NO'}`
  );


  console.log(
    '=============================================='
  );


  console.log(
    ''
  );


  if (
    warnings.length > 0
  ) {
    console.log(
      '[Warnings]'
    );


    for (
      const item of
      warnings.slice(
        0,
        20
      )
    ) {
      console.log(
        `- row=${item.row} chunkId=${item.chunkId}: ${item.warning}`
      );
    }


    if (
      warnings.length > 20
    ) {
      console.log(
        `... ${warnings.length - 20} more`
      );
    }


    console.log(
      ''
    );
  }


  if (
    !config.dryRun
  ) {
    await writeJsonl(
      config.productionOutput,
      production
    );


    await writeJsonl(
      config.evaluationOutput,
      evaluation
    );


    await ensureParent(
      config.manifestOutput
    );


    await fs.writeFile(
      config.manifestOutput,

      JSON.stringify(
        importManifest,
        null,
        2
      ) + '\n',

      'utf8'
    );


    console.log(
      `production: ${config.productionOutput}`
    );


    console.log(
      `evaluation: ${config.evaluationOutput}`
    );


    console.log(
      `manifest  : ${config.manifestOutput}`
    );


    console.log(
      ''
    );
  }
}


// ============================================================================
// Error boundary
// ============================================================================

main()
  .catch(
    (error) => {
      console.error(
        ''
      );


      console.error(
        '=============================================='
      );


      console.error(
        ` ${error.code || 'SG-RAG-IMPORT-001'}`
      );


      console.error(
        ' stage: IMPORT_REVIEWED_RAG_MANIFEST'
      );


      console.error(
        ` message: ${error?.message || String(error)}`
      );


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
