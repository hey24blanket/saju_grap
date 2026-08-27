// api/chat.js
// SajuGrap Engine Facts v1 - LLM Orchestration Layer
// -----------------------------------------------------------------------------
// IMPORTANT
// - This file does NOT calculate Saju facts.
// - SajuGrapEngine remains the only Source of Truth.
// - api/chat.js receives already-calculated Engine Facts and selects only the
//   facts needed for the LLM context.
// - The LLM is explicitly forbidden from recalculating or overriding facts.
// - Gemini remains the default provider for backward compatibility.
// - OpenAI is available only when explicitly selected; there is NO automatic
//   cross-provider fallback that could unexpectedly create extra cost.
// -----------------------------------------------------------------------------

import { CHAT_SYSTEM } from '../lib/sajuRulebook.js';
import {
  buildRagQuery,
  summarizeRagQuery
} from '../lib/ragQueryBuilder.js';
import {
  retrieveRag,
  buildRetrievedRagContext,
  summarizeRagRetrieval
} from '../lib/ragRetriever.js';

const API_VERSION = 'chat_api_v2_rag_strict';
const DEFAULT_PROVIDER = 'gemini';
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const REQUEST_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 45000);
const MAX_HISTORY_ITEMS = 20;
const MAX_HISTORY_TEXT = 4000;
const MAX_USER_MESSAGE = 5000;
const RAG_REQUIRED =
  String(process.env.RAG_REQUIRED || 'true').toLowerCase() !== 'false';
const RAG_TARGET_RESULTS =
  Number(process.env.RAG_TARGET_RESULTS || 6);
const RAG_CANDIDATE_LIMIT =
  Number(process.env.RAG_CANDIDATE_LIMIT || 100);
const RAG_MAX_CHARS_PER_CHUNK =
  Number(process.env.RAG_MAX_CHARS_PER_CHUNK || 3500);

const STAGE = Object.freeze({
  REQUEST: 'REQUEST_VALIDATION',
  FACT_CONTEXT: 'ENGINE_FACT_CONTEXT',
  RAG_QUERY: 'RAG_QUERY_BUILD',
  RAG_RETRIEVAL: 'RAG_VECTOR_RETRIEVAL',
  RAG_CONTEXT: 'RAG_CONTEXT_BUILD',
  PROMPT: 'PROMPT_BUILD',
  PROVIDER_CONFIG: 'PROVIDER_CONFIG',
  GEMINI_REQUEST: 'GEMINI_REQUEST',
  OPENAI_REQUEST: 'OPENAI_REQUEST',
  PROVIDER_RESPONSE: 'PROVIDER_RESPONSE',
  JSON_PARSE: 'MODEL_JSON_PARSE',
  RESPONSE: 'RESPONSE_SERIALIZATION'
});

const ERROR_CODE = Object.freeze({
  METHOD_NOT_ALLOWED: 'SG-CHAT-405',
  INVALID_INPUT: 'SG-CHAT-INPUT-001',
  INVALID_MODE: 'SG-CHAT-INPUT-002',
  INVALID_PROVIDER: 'SG-CHAT-PROVIDER-001',
  GEMINI_KEY_MISSING: 'SG-ENV-GEMINI-001',
  OPENAI_KEY_MISSING: 'SG-ENV-OPENAI-001',
  GEMINI_REQUEST: 'SG-GEMINI-001',
  OPENAI_REQUEST: 'SG-OPENAI-001',
  PROVIDER_EMPTY: 'SG-LLM-EMPTY-001',
  JSON_PARSE: 'SG-LLM-JSON-001',
  RAG_QUERY: 'SG-RAG-CHAT-001',
  RAG_RETRIEVAL: 'SG-RAG-CHAT-002',
  RAG_EMPTY: 'SG-RAG-CHAT-003',
  RAG_ENGINE_FACTS_MISSING: 'SG-RAG-CHAT-004',
  INTERNAL: 'SG-CHAT-500'
});

const ALLOWED_MODES = new Set([
  'prefetch',
  'summary',
  'detail',
  'chat'
]);

const ALLOWED_PROVIDERS = new Set([
  'gemini',
  'openai'
]);

const DOMAIN_KEY_BY_LABEL = Object.freeze({
  총운: 'all',
  사업운: 'career',
  재물운: 'wealth',
  심신운: 'mental',
  연애운: 'love'
});

const CYCLE_KEY_BY_LABEL = Object.freeze({
  대운: 'daewoon',
  연운: 'year',
  월운: 'month',
  일운: 'day',
  시운: 'hour'
});

class RequestValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = 'RequestValidationError';
    this.field = field;
  }
}

class ProviderRequestError extends Error {
  constructor({
    provider,
    message,
    status = 502,
    providerStatus = null,
    providerCode = null,
    stage = null
  }) {
    super(message);
    this.name = 'ProviderRequestError';
    this.provider = provider;
    this.status = status;
    this.providerStatus = providerStatus;
    this.providerCode = providerCode;
    this.stage = stage;
  }
}

function makeRequestId() {
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `sgchat_${timePart}_${randomPart}`;
}

function nowIso() {
  return new Date().toISOString();
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,OPTIONS,PATCH,DELETE,POST,PUT'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );
}

function redactSecrets(value) {
  if (value === null || value === undefined) return value;

  let text = String(value);

  text = text.replace(
    /sk-[A-Za-z0-9_\-]{12,}/g,
    '[REDACTED_OPENAI_KEY]'
  );

  text = text.replace(
    /AIza[A-Za-z0-9_\-]{20,}/g,
    '[REDACTED_GOOGLE_KEY]'
  );

  text = text.replace(
    /Bearer\s+[A-Za-z0-9._\-]+/gi,
    'Bearer [REDACTED]'
  );

  text = text.replace(
    /(OPENAI_API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY|FIREBASE_[A-Z0-9_]+)\s*=\s*[^\s,;]+/gi,
    '$1=[REDACTED]'
  );

  if (text.length > 1600) {
    text = `${text.slice(0, 1600)}…`;
  }

  return text;
}

function safeErrorDetail(error) {
  if (!error) return 'Unknown error';

  if (typeof error === 'string') {
    return redactSecrets(error);
  }

  return redactSecrets(
    error.message || error.name || 'Unknown error'
  );
}

function logServerError({
  requestId,
  stage,
  code,
  error
}) {
  console.error(
    `[SajuGrap][${requestId}][${stage}][${code}]`,
    {
      name: error?.name,
      message: redactSecrets(error?.message),
      stack: redactSecrets(error?.stack),
      provider: error?.provider,
      providerStatus: error?.providerStatus,
      providerCode: error?.providerCode
    }
  );
}

function sendError(
  res,
  {
    httpStatus,
    requestId,
    code,
    stage,
    message,
    detail,
    hint = null,
    provider = null,
    providerStatus = null,
    providerCode = null
  }
) {
  res.setHeader(
    'X-SajuGrap-Request-Id',
    requestId
  );

  res.setHeader(
    'X-SajuGrap-Error-Code',
    code
  );

  return res.status(httpStatus).json({
    success: false,

    message,

    error: {
      code,
      stage,
      message,
      detail: redactSecrets(
        detail ||
        message
      ),
      hint,
      provider,
      providerStatus,
      providerCode,
      requestId,
      httpStatus,
      timestamp: nowIso(),
      apiVersion: API_VERSION
    }
  });
}

function parseBody(body) {
  if (
    body === null ||
    body === undefined
  ) {
    return {};
  }

  if (
    typeof body ===
    'string'
  ) {
    try {
      return JSON.parse(body);
    } catch {
      throw new RequestValidationError(
        '요청 JSON을 읽을 수 없습니다.'
      );
    }
  }

  if (
    typeof body !== 'object' ||
    Array.isArray(body)
  ) {
    throw new RequestValidationError(
      '요청 본문은 JSON 객체여야 합니다.'
    );
  }

  return body;
}

function cleanText(
  value,
  maxLength
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

function normalizeProvider(value) {
  const provider =
    cleanText(
      value,
      20
    ).toLowerCase() ||
    DEFAULT_PROVIDER;

  if (
    !ALLOWED_PROVIDERS.has(
      provider
    )
  ) {
    throw new RequestValidationError(
      `지원하지 않는 LLM provider입니다: ${provider}`,
      'provider'
    );
  }

  return provider;
}

function normalizeMode(value) {
  const mode =
    cleanText(
      value,
      30
    ) ||
    'summary';

  if (
    !ALLOWED_MODES.has(
      mode
    )
  ) {
    throw new RequestValidationError(
      `지원하지 않는 chat mode입니다: ${mode}`,
      'mode'
    );
  }

  return mode;
}

function normalizeHistory(history) {
  if (
    !Array.isArray(
      history
    )
  ) {
    return [];
  }

  return history
    .slice(
      -MAX_HISTORY_ITEMS
    )
    .map(
      (item) => {
        if (
          !item ||
          typeof item !== 'object'
        ) {
          return null;
        }

        const role =
          item.role === 'user'
            ? 'user'
            : 'model';

        const text =
          cleanText(
            item.text,
            MAX_HISTORY_TEXT
          );

        if (
          !text
        ) {
          return null;
        }

        return {
          role,
          text
        };
      }
    )
    .filter(
      Boolean
    );
}

function normalizeRequest(body) {
  const mode =
    normalizeMode(
      body.mode
    );

  const provider =
    normalizeProvider(
      body.provider
    );

  const history =
    normalizeHistory(
      body.history
    );

  const userMessage =
    cleanText(
      body.userMessage,
      MAX_USER_MESSAGE
    );

  if (
    mode === 'chat' &&
    !userMessage
  ) {
    throw new RequestValidationError(
      '채팅 질문이 비어 있습니다.',
      'userMessage'
    );
  }

  const scoreNumber =
    Number(
      body.score
    );

  const cycleScores =
    body.cycleScores &&
    typeof body.cycleScores === 'object'
      ? {
          all: safeNumber(
            body.cycleScores.all
          ),
          career: safeNumber(
            body.cycleScores.career
          ),
          wealth: safeNumber(
            body.cycleScores.wealth
          ),
          mental: safeNumber(
            body.cycleScores.mental
          ),
          love: safeNumber(
            body.cycleScores.love
          )
        }
      : null;

  return {
    mode,
    provider,

    role:
      cleanText(
        body.role,
        80
      ),

    domain:
      cleanText(
        body.domain,
        80
      ) ||
      '총운',

    cycle:
      cleanText(
        body.cycle,
        80
      ) ||
      '대운',

    score:
      Number.isFinite(
        scoreNumber
      )
        ? scoreNumber
        : 0,

    cycleScores,

    cycleIndex:
      Number.isInteger(
        Number(
          body.cycleIndex
        )
      )
        ? Number(
            body.cycleIndex
          )
        : null,

    sajuContext:
      body.sajuContext &&
      typeof body.sajuContext === 'object'
        ? body.sajuContext
        : {},

    userMessage,
    history
  };
}

function safeNumber(value) {
  const n =
    Number(
      value
    );

  return Number.isFinite(
    n
  )
    ? n
    : 0;
}

function extractRoleFact(role) {
  if (
    !role ||
    typeof role !== 'object'
  ) {
    return null;
  }

  return {
    element:
      role.element ??
      null,

    tenGodGroup:
      role.tenGodGroup ??
      null,

    mechanisms:
      Array.isArray(
        role.mechanisms
      )
        ? role.mechanisms.slice(
            0,
            8
          )
        : [],

    need:
      role.need ??
      null,

    currentAvailability:
      role.currentAvailability ??
      null,

    confidence:
      role.confidence ??
      null
  };
}

function extractActiveCycleFact(
  engineFacts,
  cycleLabel,
  cycleIndex
) {
  if (
    !engineFacts?.cycles ||
    cycleIndex === null
  ) {
    return null;
  }

  const cycleKey =
    CYCLE_KEY_BY_LABEL[
      cycleLabel
    ] ||
    cycleLabel;

  const list =
    engineFacts
      .cycles
      ?.[cycleKey];

  if (
    !Array.isArray(
      list
    )
  ) {
    return null;
  }

  if (
    cycleIndex < 0 ||
    cycleIndex >=
      list.length
  ) {
    return null;
  }

  const cycle =
    list[
      cycleIndex
    ];

  if (
    !cycle ||
    typeof cycle !== 'object'
  ) {
    return null;
  }

  return {
    cycleType:
      cycle.cycleType ??
      cycleKey,

    ganzhi:
      cycle.ganzhi ??
      null,

    stem:
      cycle.stem ??
      null,

    branch:
      cycle.branch ??
      null,

    tenGod:
      cycle.tenGod
        ? {
            tenGod:
              cycle.tenGod.tenGod ??
              null,

            tenGodKo:
              cycle.tenGod.tenGodKo ??
              null,

            group:
              cycle.tenGod.group ??
              null
          }
        : null,

    twelveStage:
      cycle.twelveStage
        ? {
            stage:
              cycle.twelveStage.stage ??
              null,

            stageKey:
              cycle.twelveStage.stageKey ??
              null,

            methodId:
              cycle.twelveStage.methodId ??
              null
          }
        : null,

    relationsWithNatal:
      Array.isArray(
        cycle.relationsWithNatal
      )
        ? cycle.relationsWithNatal.map(
            (relation) => ({
              relationType:
                relation.relationType ??
                null,

              complete:
                relation.complete ??
                null,

              transformationStatus:
                relation.transformation
                  ?.status ??
                null,

              targetElement:
                relation.transformation
                  ?.targetElement ??
                null,

              methodId:
                relation.methodId ??
                null
            })
          )
        : [],

    usefulGodImpact:
      cycle.usefulGodImpact
        ? {
            yongsinImpact:
              cycle.usefulGodImpact
                .yongsinImpact ??
              null,

            gisinImpact:
              cycle.usefulGodImpact
                .gisinImpact ??
              null
          }
        : null,

    balanceImpact:
      cycle.balanceImpact
        ? {
            dominantImbalance:
              cycle.balanceImpact
                .dominantImbalance ??
              null,

            effect:
              cycle.balanceImpact
                .effect ??
              null,

            confidence:
              cycle.balanceImpact
                .confidence ??
              null
          }
        : null,

    wavePhase:
      cycle.wavePhase ??
      null
  };
}

function buildEngineFactPacket(
  sajuContext,
  cycleLabel,
  cycleIndex
) {
  const engineFacts =
    sajuContext
      ?.engineFacts;

  if (
    !engineFacts ||
    typeof engineFacts !== 'object'
  ) {
    return {
      availability:
        'missing',

      schemaVersion:
        null,

      engineVersion:
        null,

      compatibilityContextOnly: {
        name:
          cleanText(
            sajuContext?.name,
            80
          ) ||
          '내담자',

        pillars:
          sajuContext?.pillars &&
          typeof sajuContext.pillars === 'object'
            ? {
                yearHanja:
                  sajuContext
                    .pillars
                    .yearHanja ??
                  null,

                monthHanja:
                  sajuContext
                    .pillars
                    .monthHanja ??
                  null,

                dayHanja:
                  sajuContext
                    .pillars
                    .dayHanja ??
                  null,

                hourHanja:
                  sajuContext
                    .pillars
                    .hourHanja ??
                  null
              }
            : null
      },

      rule:
        'Engine Facts가 전달되지 않았으므로 누락된 명리 Fact를 추론하거나 재계산하지 않는다.'
    };
  }

  const useful =
    engineFacts
      .usefulGodProfile ||
    {};

  const tenGodGroups =
    engineFacts
      .tenGodProfile
      ?.groups ||
    {};

  const groupPacket =
    {};

  for (
    const group of
    [
      'peer',
      'output',
      'wealth',
      'officer',
      'resource'
    ]
  ) {
    const value =
      tenGodGroups[
        group
      ];

    if (
      !value
    ) {
      continue;
    }

    groupPacket[
      group
    ] = {
      strengthBand:
        value.strengthBand ??
        null,

      visibleCount:
        value.visibleCount ??
        null,

      hiddenCount:
        value.hiddenCount ??
        null,

      rooted:
        value.rooted ??
        null,

      monthCommandSupport:
        value.monthCommandSupport ??
        null
    };
  }

  const detectedStars =
    Array.isArray(
      engineFacts.stars
    )
      ? engineFacts.stars
          .filter(
            (star) =>
              star?.detected
          )
          .map(
            (star) => ({
              starId:
                star.starId ??
                null,

              canonicalName:
                star.canonicalName ??
                null,

              basisType:
                star.basisType ??
                null,

              basisValue:
                star.basisValue ??
                null,

              matches:
                Array.isArray(
                  star.matches
                )
                  ? star.matches.map(
                      (match) => ({
                        position:
                          match.position ??
                          null,

                        branch:
                          match.branch ??
                          null,

                        ganzhi:
                          match.ganzhi ??
                          null
                      })
                    )
                  : [],

              methodId:
                star.methodId ??
                null,

              confidence:
                star.confidence ??
                null
            })
          )
      : [];

  const relationItems =
    Array.isArray(
      engineFacts
        .relations
        ?.items
    )
      ? engineFacts
          .relations
          .items
          .map(
            (relation) => ({
              relationId:
                relation.relationId ??
                null,

              relationType:
                relation.relationType ??
                null,

              complete:
                relation.complete ??
                null,

              members:
                Array.isArray(
                  relation.members
                )
                  ? relation.members.map(
                      (member) => ({
                        position:
                          member.position ??
                          null,

                        value:
                          member.value ??
                          null
                      })
                    )
                  : [],

              transformation:
                relation.transformation
                  ? {
                      status:
                        relation
                          .transformation
                          .status ??
                        null,

                      targetElement:
                        relation
                          .transformation
                          .targetElement ??
                        null,

                      confidence:
                        relation
                          .transformation
                          .confidence ??
                        null
                    }
                  : null,

              methodId:
                relation.methodId ??
                null
            })
          )
      : [];

  return {
    availability:
      'engine_facts_v1',

    schemaVersion:
      engineFacts
        .schemaVersion ??
      null,

    engineVersion:
      engineFacts
        .engineVersion ??
      null,

    input: {
      name:
        engineFacts
          .input
          ?.name ??
        (
          cleanText(
            sajuContext?.name,
            80
          ) ||
          '내담자'
        )
    },

    natal:
      engineFacts.natal
        ? {
            year:
              engineFacts
                .natal
                .year ??
              null,

            month:
              engineFacts
                .natal
                .month ??
              null,

            day:
              engineFacts
                .natal
                .day ??
              null,

            hour:
              engineFacts
                .natal
                .hour ??
              null,

            dayMaster:
              engineFacts
                .natal
                .dayMaster ??
              null
          }
        : null,

    strength:
      engineFacts.strength
        ? {
            band:
              engineFacts
                .strength
                .band ??
              null,

            score:
              engineFacts
                .strength
                .score ??
              null,

            specialStructureCandidate:
              engineFacts
                .strength
                .specialStructureCandidate ??
              null,

            methodId:
              engineFacts
                .strength
                .methodId ??
              null,

            methodVersion:
              engineFacts
                .strength
                .methodVersion ??
              null,

            confidence:
              engineFacts
                .strength
                .confidence ??
              null
          }
        : null,

    usefulGodProfile: {
      dominantImbalance:
        useful
          .dominantImbalance ??
        null,

      climate:
        useful
          .climate ??
        null,

      yongsin:
        extractRoleFact(
          useful.yongsin
        ),

      heesin:
        Array.isArray(
          useful.heesin
        )
          ? useful.heesin
              .map(
                extractRoleFact
              )
              .filter(
                Boolean
              )
          : [],

      gisin:
        Array.isArray(
          useful.gisin
        )
          ? useful.gisin
              .map(
                extractRoleFact
              )
              .filter(
                Boolean
              )
          : [],

      gusin:
        Array.isArray(
          useful.gusin
        )
          ? useful.gusin
              .map(
                extractRoleFact
              )
              .filter(
                Boolean
              )
          : [],

      hansin:
        Array.isArray(
          useful.hansin
        )
          ? useful.hansin
              .map(
                extractRoleFact
              )
              .filter(
                Boolean
              )
          : [],

      methodId:
        useful.methodId ??
        null,

      methodVersion:
        useful.methodVersion ??
        null,

      confidence:
        useful.confidence ??
        null
    },

    tenGodGroups:
      groupPacket,

    detectedStars,

    relations: {
      dominantRelationId:
        engineFacts
          .relations
          ?.dominantRelationId ??
        null,

      items:
        relationItems
    },

    activeCycle:
      extractActiveCycleFact(
        engineFacts,
        cycleLabel,
        cycleIndex
      )

    // diagnostics intentionally excluded from LLM context.
  };
}

function buildWaveProjectionContext({
  domain,
  cycle,
  score,
  cycleScores
}) {
  return {
    source:
      'ui_compatibility_wave_projection',

    canonicalEngineFact:
      false,

    cycle,

    domain,

    score,

    cycleScores,

    warning:
      '이 점수는 전통 12운성 Fact가 아니며, 12운성 또는 길흉으로 역산/재계산해서는 안 된다.'
  };
}

function buildFactContract(
  engineFactPacket
) {
  const factJson =
    JSON.stringify(
      engineFactPacket,
      null,
      2
    );

  return `
[ENGINE FACTS v1 - 절대 준수 계약]
아래 JSON은 SajuGrapEngine이 이미 계산한 Fact 중 LLM에 필요한 항목만 선별한 것입니다.

${factJson}

[절대 규칙]
1. 위 Engine Facts를 수정, 재판정, 재계산하거나 뒤집지 마세요.
2. 사주팔자/천간지지/지장간/통근/투간/강약/특수격/용신/십신/12운성/귀인·신살/합충형파해/반합/합화/성국/relation dominance/대운·연운·월운·일운·시운 간지를 새로 계산하지 마세요.
3. Engine Facts에 없는 명리 Fact는 추측하지 말고 "현재 전달된 Engine Facts에는 해당 정보가 없습니다"라고 처리하세요.
4. 두 Fact가 같이 있다는 이유만으로 인과관계를 만들지 마세요. Engine에 mechanism/evidence가 없는 인과는 단정하지 마세요.
5. 용신=행운, 기신=불운, 충=나쁨, 신강=성공, 신약=약한 사람 같은 단정을 만들지 마세요.
6. 12운성을 파동 점수(-100~+100)와 직접 대응시키지 마세요.
7. 공식 Domain은 총운/사업운/재물운/심신운/연애운 5개뿐입니다. growth를 공식 6번째 Domain으로 만들지 마세요.
8. diagnostics는 LLM 해석 재료가 아닙니다. 이 요청에도 diagnostics는 전달하지 않습니다.
9. Engine Facts와 기존 룰북 문구가 충돌하면 Engine Facts v1 계약을 우선하세요.
`;
}

function buildPromptContext(
  normalized,
  engineFactPacket
) {
  const userName =
    engineFactPacket
      ?.input
      ?.name ||
    engineFactPacket
      ?.compatibilityContextOnly
      ?.name ||
    cleanText(
      normalized
        .sajuContext
        ?.name,
      80
    ) ||
    '내담자';

  const waveContext =
    buildWaveProjectionContext(
      normalized
    );

  return {
    userName,
    waveContext,
    engineFactPacket
  };
}

function buildTaskPrompt(
  normalized,
  promptContext
) {
  const {
    mode,
    role,
    domain,
    cycle,
    score,
    cycleScores
  } =
    normalized;

  const {
    userName,
    waveContext
  } =
    promptContext;

  const waveJson =
    JSON.stringify(
      waveContext,
      null,
      2
    );

  if (
    mode ===
    'prefetch'
  ) {
    return {
      isJsonMode:
        true,

      maxOutputTokens:
        2200,

      thinkingLevel:
        'low',

      userPrompt: `
${userName}님의 [${cycle}]에 대한 5개 공식 Domain 전략을 작성하세요.

[UI Wave Projection - Engine Fact 아님]
${waveJson}

현재 점수:
- 총운: ${cycleScores?.all ?? 0}
- 사업운: ${cycleScores?.career ?? 0}
- 재물운: ${cycleScores?.wealth ?? 0}
- 심신운: ${cycleScores?.mental ?? 0}
- 연애운: ${cycleScores?.love ?? 0}

[작성 규칙]
- Engine Facts는 그대로 사용하고 재계산하지 마세요.
- UI Wave Projection 점수는 행동 강도/완급을 표현하는 보조 컨텍스트일 뿐 명리 Fact로 역산하지 마세요.
- 각 영역은 상태 진단 → 흐름 설명 → 구체적 실행 제안의 순서를 따르세요.
- 길흉 예언 대신 행동 전략으로 표현하세요.
- 각 항목은 읽기 좋은 3~4문장으로 작성하세요.

반드시 아래 5개 key만 가진 JSON 객체로 응답하세요. Markdown 코드블록은 사용하지 마세요.
{
  "all": "총운 전략",
  "career": "사업운 전략",
  "wealth": "재물운 전략",
  "mental": "심신운 전략",
  "love": "연애운 전략"
}
`
    };
  }

  if (
    mode ===
    'summary'
  ) {
    if (
      role
    ) {
      return {
        isJsonMode:
          false,

        maxOutputTokens:
          1200,

        thinkingLevel:
          'low',

        userPrompt: `
${userName}님의 사주 원국에서 [${role}]에 대해 설명하세요.

중요:
- 전달된 Engine Facts에 실제 [${role}] 정보가 있을 때만 그 Fact를 설명하세요.
- 해당 Fact가 없으면 추정하거나 새로 계산하지 마세요.
- 의미 → 현재 구조에서의 작동 조건 → 실제 행동에 적용하는 방법 순서로 3~4문장 작성하세요.
`
      };
    }

    return {
      isJsonMode:
        false,

      maxOutputTokens:
        1200,

      thinkingLevel:
        'low',

      userPrompt: `
${userName}님의 [${cycle} · ${domain}] 전략을 작성하세요.

[UI Wave Projection - Engine Fact 아님]
${waveJson}

현재 UI 보조 점수: ${score >= 0 ? '+' : ''}${score}

Engine Facts에 근거하여 현재 구조를 설명하고, 점수는 행동의 완급을 조절하는 보조값으로만 사용하세요.
상태 진단 → 흐름 설명 → 구체적 실행 제안 순서로 3~4문장 작성하세요.
`
    };
  }

  if (
    mode ===
    'detail'
  ) {
    return {
      isJsonMode:
        false,

      maxOutputTokens:
        2600,

      thinkingLevel:
        'medium',

      userPrompt: `
${userName}님의 [${cycle} · ${domain || role || '총운'}] 심층 전략 리포트를 작성하세요.

[UI Wave Projection - Engine Fact 아님]
${waveJson}

현재 UI 보조 점수: ${score >= 0 ? '+' : ''}${score}

다음 3단계 구조로 작성하세요.
1. 현재 Engine Facts에서 확인되는 구조와 상태
2. 활용 가능한 기회와 관리할 마찰 요인
3. 향후 약 3개월 동안 실행할 수 있는 단계별 액션 플랜

Engine Facts에 없는 내용을 명리 계산으로 보충하지 마세요. 불확실한 부분은 조건부로 표현하세요.
`
    };
  }

  throw new RequestValidationError(
    `해당 mode에는 별도 task prompt가 없습니다: ${mode}`,
    'mode'
  );
}

function normalizeRagDomain(
  domainLabel
) {
  const raw =
    cleanText(
      domainLabel,
      80
    );

  if (
    DOMAIN_KEY_BY_LABEL[
      raw
    ]
  ) {
    return DOMAIN_KEY_BY_LABEL[
      raw
    ];
  }

  if (
    [
      'all',
      'career',
      'wealth',
      'mental',
      'love'
    ].includes(
      raw
    )
  ) {
    return raw;
  }

  return 'all';
}

function normalizeRagCycle(
  cycleLabel
) {
  const raw =
    cleanText(
      cycleLabel,
      80
    );

  if (
    CYCLE_KEY_BY_LABEL[
      raw
    ]
  ) {
    return CYCLE_KEY_BY_LABEL[
      raw
    ];
  }

  if (
    [
      'daewoon',
      'year',
      'month',
      'day',
      'hour'
    ].includes(
      raw
    )
  ) {
    return raw;
  }

  return null;
}

function buildRagUserQuery(
  normalized
) {
  if (
    normalized.mode ===
    'chat'
  ) {
    return normalized
      .userMessage;
  }

  if (
    normalized.mode ===
    'prefetch'
  ) {
    return `${normalized.cycle}의 총운, 사업운, 재물운, 심신운, 연애운을 Engine Facts에 맞춰 행동 전략으로 해석하는 기준`;
  }

  if (
    normalized.mode ===
      'summary' &&
    normalized.role
  ) {
    return `${normalized.role}의 의미, 현재 구조에서의 작동 조건, 행동 전략, 금지 해석`;
  }

  if (
    normalized.mode ===
    'summary'
  ) {
    return `${normalized.cycle} ${normalized.domain}의 현재 구조와 행동 전략`;
  }

  if (
    normalized.mode ===
    'detail'
  ) {
    return `${normalized.cycle} ${normalized.domain || normalized.role || '총운'}의 심층 전략, 기회, 마찰 요인, 실행 계획`;
  }

  return (
    normalized.userMessage ||
    `${normalized.cycle} ${normalized.domain}`
  );
}

function buildRagSystemContract(
  ragContextText
) {
  if (
    !ragContextText
  ) {
    return `
[RETRIEVED RAG KNOWLEDGE]
이번 요청에는 검색된 RAG 지식이 없습니다.
Engine Facts에 없는 명리 Fact를 새로 계산하거나 추측하지 마세요.
`;
  }

  return `
[RAG 사용 계약]
1. 아래 검색 지식은 Engine Facts를 해석하고 행동 전략으로 번역하기 위한 참고 지식입니다.
2. Engine Facts와 RAG가 충돌하면 Engine Facts를 우선하세요.
3. RAG 문장에 계산 예시나 synthetic case가 있어도 현재 사용자의 Fact로 복사하지 마세요.
4. 검색되지 않은 규칙을 임의로 보충하지 마세요.
5. RAG는 사주팔자, 강약, 용신, 십신, 12운성, 신살, 합충형파해, 운 간지를 재계산하는 근거가 아닙니다.

${ragContextText}
`;
}

async function buildRagRuntimeContext(
  normalized,
  {
    ragVersion = null,
    knowledgeLayer = null
  } = {}
) {
  const engineFacts =
    normalized
      .sajuContext
      ?.engineFacts;

  if (
    !engineFacts ||
    typeof engineFacts !==
      'object' ||
    engineFacts
      .schemaVersion !==
      'engine_facts_v1'
  ) {
    if (
      RAG_REQUIRED
    ) {
      const error =
        new Error(
          'RAG_REQUIRED=true 이지만 요청에 유효한 engine_facts_v1이 없습니다.'
        );

      error.code =
        ERROR_CODE
          .RAG_ENGINE_FACTS_MISSING;

      error.sajuRagStage =
        STAGE
          .RAG_QUERY;

      throw error;
    }

    return {
      status:
        'skipped_missing_engine_facts',

      required:
        RAG_REQUIRED,

      query:
        null,

      retrieval:
        null,

      contextText:
        '',

      fallbackUsed:
        false
    };
  }

  const domain =
    normalizeRagDomain(
      normalized.domain
    );

  const cycleType =
    normalizeRagCycle(
      normalized.cycle
    );

  const userQuery =
    buildRagUserQuery(
      normalized
    );

  let queryPacket;

  try {
    queryPacket =
      buildRagQuery(
        engineFacts,
        {
          domain,
          cycleType,
          cycleIndex:
            normalized
              .cycleIndex,
          userQuery
        }
      );
  } catch (
    error
  ) {
    error.sajuRagStage =
      STAGE.RAG_QUERY;

    throw error;
  }

  let retrieval;

  try {
    retrieval =
      await retrieveRag(
        queryPacket,
        {
          ragVersion,

          knowledgeLayer,

          targetResults:
            Number.isInteger(
              RAG_TARGET_RESULTS
            ) &&
            RAG_TARGET_RESULTS > 0
              ? Math.min(
                  RAG_TARGET_RESULTS,
                  10
                )
              : 6,

          maximumResults:
            Number.isInteger(
              RAG_TARGET_RESULTS
            ) &&
            RAG_TARGET_RESULTS > 0
              ? Math.min(
                  RAG_TARGET_RESULTS,
                  10
                )
              : 6,

          candidateLimit:
            Number.isInteger(
              RAG_CANDIDATE_LIMIT
            ) &&
            RAG_CANDIDATE_LIMIT > 0
              ? Math.min(
                  RAG_CANDIDATE_LIMIT,
                  200
                )
              : 100
        }
      );
  } catch (
    error
  ) {
    error.sajuRagStage =
      STAGE
        .RAG_RETRIEVAL;

    throw error;
  }

  if (
    !Array.isArray(
      retrieval
        ?.results
    ) ||
    retrieval
      .results
      .length === 0
  ) {
    const error =
      new Error(
        'RAG Query Builder의 retrieval policy를 적용한 결과가 0개입니다.'
      );

    error.code =
      ERROR_CODE
        .RAG_EMPTY;

    error.sajuRagStage =
      STAGE
        .RAG_RETRIEVAL;

    throw error;
  }

  let contextText;

  try {
    contextText =
      buildRetrievedRagContext(
        retrieval,
        {
          maxChunks:
            Number.isInteger(
              RAG_TARGET_RESULTS
            ) &&
            RAG_TARGET_RESULTS > 0
              ? Math.min(
                  RAG_TARGET_RESULTS,
                  10
                )
              : 6,

          maxCharsPerChunk:
            Number.isInteger(
              RAG_MAX_CHARS_PER_CHUNK
            ) &&
            RAG_MAX_CHARS_PER_CHUNK > 0
              ? RAG_MAX_CHARS_PER_CHUNK
              : 3500
        }
      );
  } catch (
    error
  ) {
    error.sajuRagStage =
      STAGE.RAG_CONTEXT;

    throw error;
  }

  return {
    status:
      'ok',

    required:
      RAG_REQUIRED,

    query:
      summarizeRagQuery(
        queryPacket
      ),

    retrieval:
      summarizeRagRetrieval(
        retrieval
      ),

    contextText,

    fallbackUsed:
      false
  };
}

function buildSystemInstruction(
  engineFactPacket,
  ragContextText = ''
) {
  return [
    CHAT_SYSTEM,

    buildFactContract(
      engineFactPacket
    ),

    buildRagSystemContract(
      ragContextText
    )
  ].join(
    '\n\n'
  );
}

function buildGeminiContents(
  normalized,
  userPrompt
) {
  if (
    normalized.mode !==
    'chat'
  ) {
    return [
      {
        role:
          'user',

        parts: [
          {
            text:
              userPrompt
          }
        ]
      }
    ];
  }

  const contents =
    normalized
      .history
      .map(
        (item) => ({
          role:
            item.role ===
            'user'
              ? 'user'
              : 'model',

          parts: [
            {
              text:
                item.text
            }
          ]
        })
      );

  contents.push({
    role:
      'user',

    parts: [
      {
        text:
          normalized
            .userMessage
      }
    ]
  });

  return contents;
}

function buildOpenAIInput(
  normalized,
  userPrompt
) {
  if (
    normalized.mode !==
    'chat'
  ) {
    return [
      {
        role:
          'user',

        content:
          userPrompt
      }
    ];
  }

  const input =
    normalized
      .history
      .map(
        (item) => ({
          role:
            item.role ===
            'user'
              ? 'user'
              : 'assistant',

          content:
            item.text
        })
      );

  input.push({
    role:
      'user',

    content:
      normalized
        .userMessage
  });

  return input;
}

async function fetchWithTimeout(
  url,
  options,
  timeoutMs =
    REQUEST_TIMEOUT_MS
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
    return await fetch(
      url,
      {
        ...options,
        signal:
          controller
            .signal
      }
    );
  } catch (
    error
  ) {
    if (
      error?.name ===
      'AbortError'
    ) {
      throw new Error(
        `LLM 요청 시간이 ${timeoutMs}ms를 초과했습니다.`
      );
    }

    throw error;
  } finally {
    clearTimeout(
      timer
    );
  }
}

function providerHttpStatus(
  status
) {
  if (
    Number.isInteger(
      status
    ) &&
    status >= 400 &&
    status <= 599
  ) {
    return status;
  }

  return 502;
}

async function callGemini({
  normalized,
  systemInstruction,
  userPrompt,
  isJsonMode,
  maxOutputTokens,
  thinkingLevel
}) {
  const apiKey =
    process.env
      .GEMINI_API_KEY;

  if (
    !apiKey
  ) {
    throw new ProviderRequestError({
      provider:
        'gemini',

      message:
        'Vercel 환경변수 GEMINI_API_KEY가 설정되어 있지 않습니다.',

      status:
        500,

      providerCode:
        ERROR_CODE
          .GEMINI_KEY_MISSING,

      stage:
        STAGE
          .PROVIDER_CONFIG
    });
  }

  const requestBody = {
    systemInstruction: {
      parts: [
        {
          text:
            systemInstruction
        }
      ]
    },

    contents:
      buildGeminiContents(
        normalized,
        userPrompt
      ),

    generationConfig: {
      maxOutputTokens,

      thinkingConfig: {
        thinkingLevel
      }
    }
  };

  if (
    isJsonMode
  ) {
    requestBody
      .generationConfig
      .responseMimeType =
      'application/json';
  }

  let response;

  try {
    response =
      await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(DEFAULT_GEMINI_MODEL)}:generateContent`,
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
              requestBody
            )
        }
      );
  } catch (
    error
  ) {
    throw new ProviderRequestError({
      provider:
        'gemini',

      message:
        safeErrorDetail(
          error
        ),

      status:
        502,

      providerCode:
        ERROR_CODE
          .GEMINI_REQUEST,

      stage:
        STAGE
          .GEMINI_REQUEST
    });
  }

  let data =
    null;

  try {
    data =
      await response.json();
  } catch {
    data =
      null;
  }

  if (
    !response.ok
  ) {
    throw new ProviderRequestError({
      provider:
        'gemini',

      message:
        data?.error?.message ||
        `Gemini API HTTP ${response.status}`,

      status:
        providerHttpStatus(
          response.status
        ),

      providerStatus:
        response.status,

      providerCode:
        data?.error?.status ||
        data?.error?.code ||
        null,

      stage:
        STAGE
          .GEMINI_REQUEST
    });
  }

  const text =
    Array.isArray(
      data
        ?.candidates
        ?.[0]
        ?.content
        ?.parts
    )
      ? data
          .candidates[0]
          .content
          .parts
          .map(
            (part) =>
              typeof part?.text ===
                'string'
                ? part.text
                : ''
          )
          .join('')
          .trim()
      : '';

  if (
    !text
  ) {
    const finishReason =
      data
        ?.candidates
        ?.[0]
        ?.finishReason ||
      null;

    const blockReason =
      data
        ?.promptFeedback
        ?.blockReason ||
      null;

    throw new ProviderRequestError({
      provider:
        'gemini',

      message:
        `Gemini 응답 본문이 비어 있습니다.` +
        ` finishReason=${finishReason || '-'}, blockReason=${blockReason || '-'}`,

      status:
        502,

      providerCode:
        ERROR_CODE
          .PROVIDER_EMPTY,

      stage:
        STAGE
          .PROVIDER_RESPONSE
    });
  }

  return {
    text,

    provider:
      'gemini',

    model:
      DEFAULT_GEMINI_MODEL,

    usage:
      data
        ?.usageMetadata ||
      null
  };
}

function extractOpenAIText(
  data
) {
  if (
    typeof data
      ?.output_text ===
      'string' &&
    data
      .output_text
      .trim()
  ) {
    return data
      .output_text
      .trim();
  }

  if (
    !Array.isArray(
      data?.output
    )
  ) {
    return '';
  }

  const chunks =
    [];

  for (
    const outputItem of
    data.output
  ) {
    if (
      !Array.isArray(
        outputItem
          ?.content
      )
    ) {
      continue;
    }

    for (
      const contentItem of
      outputItem.content
    ) {
      if (
        contentItem?.type ===
          'output_text' &&
        typeof contentItem?.text ===
          'string'
      ) {
        chunks.push(
          contentItem.text
        );
      }
    }
  }

  return chunks
    .join('')
    .trim();
}

async function callOpenAI({
  normalized,
  systemInstruction,
  userPrompt,
  maxOutputTokens
}) {
  const apiKey =
    process.env
      .OPENAI_API_KEY;

  if (
    !apiKey
  ) {
    throw new ProviderRequestError({
      provider:
        'openai',

      message:
        'Vercel 환경변수 OPENAI_API_KEY가 설정되어 있지 않습니다.',

      status:
        500,

      providerCode:
        ERROR_CODE
          .OPENAI_KEY_MISSING,

      stage:
        STAGE
          .PROVIDER_CONFIG
    });
  }

  const requestBody = {
    model:
      DEFAULT_OPENAI_MODEL,

    instructions:
      systemInstruction,

    input:
      buildOpenAIInput(
        normalized,
        userPrompt
      ),

    max_output_tokens:
      maxOutputTokens
  };

  let response;

  try {
    response =
      await fetchWithTimeout(
        'https://api.openai.com/v1/responses',
        {
          method:
            'POST',

          headers: {
            'Content-Type':
              'application/json',

            Authorization:
              `Bearer ${apiKey}`
          },

          body:
            JSON.stringify(
              requestBody
            )
        }
      );
  } catch (
    error
  ) {
    throw new ProviderRequestError({
      provider:
        'openai',

      message:
        safeErrorDetail(
          error
        ),

      status:
        502,

      providerCode:
        ERROR_CODE
          .OPENAI_REQUEST,

      stage:
        STAGE
          .OPENAI_REQUEST
    });
  }

  let data =
    null;

  try {
    data =
      await response.json();
  } catch {
    data =
      null;
  }

  if (
    !response.ok
  ) {
    throw new ProviderRequestError({
      provider:
        'openai',

      message:
        data?.error?.message ||
        `OpenAI API HTTP ${response.status}`,

      status:
        providerHttpStatus(
          response.status
        ),

      providerStatus:
        response.status,

      providerCode:
        data?.error?.code ||
        data?.error?.type ||
        null,

      stage:
        STAGE
          .OPENAI_REQUEST
    });
  }

  const text =
    extractOpenAIText(
      data
    );

  if (
    !text
  ) {
    throw new ProviderRequestError({
      provider:
        'openai',

      message:
        `OpenAI 응답 본문이 비어 있습니다. status=${data?.status || '-'}`,

      status:
        502,

      providerCode:
        ERROR_CODE
          .PROVIDER_EMPTY,

      stage:
        STAGE
          .PROVIDER_RESPONSE
    });
  }

  return {
    text,

    provider:
      'openai',

    model:
      DEFAULT_OPENAI_MODEL,

    usage:
      data?.usage ||
      null
  };
}

function parseJsonReply(
  rawReply
) {
  const cleaned =
    String(
      rawReply ||
      ''
    )
      .replace(
        /^```json\s*/i,
        ''
      )
      .replace(
        /^```\s*/i,
        ''
      )
      .replace(
        /\s*```$/i,
        ''
      )
      .trim();

  const parsed =
    JSON.parse(
      cleaned
    );

  if (
    !parsed ||
    typeof parsed !==
      'object' ||
    Array.isArray(
      parsed
    )
  ) {
    throw new Error(
      '모델 JSON 응답이 객체 형식이 아닙니다.'
    );
  }

  const required = [
    'all',
    'career',
    'wealth',
    'mental',
    'love'
  ];

  for (
    const key of
    required
  ) {
    if (
      typeof parsed[
        key
      ] !== 'string' ||
      !parsed[
        key
      ].trim()
    ) {
      throw new Error(
        `모델 JSON 응답에 ${key} 문자열이 없습니다.`
      );
    }
  }

  return {
    all:
      parsed
        .all
        .trim(),

    career:
      parsed
        .career
        .trim(),

    wealth:
      parsed
        .wealth
        .trim(),

    mental:
      parsed
        .mental
        .trim(),

    love:
      parsed
        .love
        .trim()
  };
}

async function callSelectedProvider(
  options
) {
  if (
    options
      .normalized
      .provider ===
    'openai'
  ) {
    return callOpenAI(
      options
    );
  }

  return callGemini(
    options
  );
}

export default async function handler(
  req,
  res,
  runtimeOptions = {}
) {
  const requestId =
    makeRequestId();

  let stage =
    STAGE.REQUEST;

  setCorsHeaders(
    res
  );

  res.setHeader(
    'X-SajuGrap-Request-Id',
    requestId
  );

  res.setHeader(
    'X-SajuGrap-Api-Version',
    API_VERSION
  );

  res.setHeader(
    'Cache-Control',
    'no-store'
  );

  if (
    req.method ===
    'OPTIONS'
  ) {
    return res
      .status(200)
      .end();
  }

  if (
    req.method !==
    'POST'
  ) {
    return sendError(
      res,
      {
        httpStatus:
          405,

        requestId,

        code:
          ERROR_CODE
            .METHOD_NOT_ALLOWED,

        stage:
          STAGE.REQUEST,

        message:
          'POST 요청만 허용됩니다.',

        detail:
          `received method=${req.method}`,

        hint:
          'index.html의 /api/chat fetch method가 POST인지 확인하세요.'
      }
    );
  }

  let normalized;

  try {
    stage =
      STAGE.REQUEST;

    const body =
      parseBody(
        req.body
      );

    normalized =
      normalizeRequest(
        body
      );
  } catch (
    error
  ) {
    return sendError(
      res,
      {
        httpStatus:
          400,

        requestId,

        code:
          error?.field ===
            'provider'
            ? ERROR_CODE
                .INVALID_PROVIDER
            : error?.field ===
                'mode'
              ? ERROR_CODE
                  .INVALID_MODE
              : ERROR_CODE
                  .INVALID_INPUT,

        stage,

        message:
          '채팅 요청값을 확인해 주세요.',

        detail:
          safeErrorDetail(
            error
          ),

        hint:
          error?.field
            ? `문제 필드: ${error.field}`
            : null
      }
    );
  }

  let engineFactPacket;
  let promptContext;
  let systemInstruction;
  let task;

  let ragRuntime = {
    status:
      'not_started',

    required:
      RAG_REQUIRED,

    query:
      null,

    retrieval:
      null,

    contextText:
      '',

    fallbackUsed:
      false
  };

  try {
    stage =
      STAGE
        .FACT_CONTEXT;

    engineFactPacket =
      buildEngineFactPacket(
        normalized
          .sajuContext,
        normalized
          .cycle,
        normalized
          .cycleIndex
      );

    promptContext =
      buildPromptContext(
        normalized,
        engineFactPacket
      );

    stage =
      STAGE
        .RAG_QUERY;

    ragRuntime =
      await buildRagRuntimeContext(
        normalized,
        {
          ragVersion:
            runtimeOptions.ragVersion ||
            null,

          knowledgeLayer:
            runtimeOptions.knowledgeLayer ||
            null
        }
      );

    if (
      RAG_REQUIRED &&
      ragRuntime.status !==
        'ok'
    ) {
      const error =
        new Error(
          `RAG required but unavailable: ${ragRuntime.status}`
        );

      error.code =
        ERROR_CODE
          .RAG_RETRIEVAL;

      error.sajuRagStage =
        STAGE
          .RAG_RETRIEVAL;

      throw error;
    }

    stage =
      STAGE
        .PROMPT;

    systemInstruction =
      buildSystemInstruction(
        engineFactPacket,
        ragRuntime
          .contextText
      );

    if (
      normalized.mode ===
      'chat'
    ) {
      task = {
        isJsonMode:
          false,

        maxOutputTokens:
          1400,

        thinkingLevel:
          'low',

        userPrompt:
          ''
      };
    } else {
      task =
        buildTaskPrompt(
          normalized,
          promptContext
        );
    }
  } catch (
    error
  ) {
    const ragStage =
      error
        ?.sajuRagStage ||
      null;

    const isRagError =
      ragStage ===
        STAGE.RAG_QUERY ||
      ragStage ===
        STAGE.RAG_RETRIEVAL ||
      ragStage ===
        STAGE.RAG_CONTEXT;

    const code =
      isRagError
        ? error?.code ||
          (
            ragStage ===
            STAGE.RAG_QUERY
              ? ERROR_CODE
                  .RAG_QUERY
              : ERROR_CODE
                  .RAG_RETRIEVAL
          )
        : ERROR_CODE
            .INTERNAL;

    const errorStage =
      ragStage ||
      stage;

    logServerError({
      requestId,
      stage:
        errorStage,
      code,
      error
    });

    return sendError(
      res,
      {
        httpStatus:
          isRagError
            ? 502
            : 500,

        requestId,

        code,

        stage:
          errorStage,

        message:
          isRagError
            ? 'RAG 지식 검색 또는 컨텍스트 구성 중 오류가 발생했습니다.'
            : 'Engine Fact 컨텍스트 또는 프롬프트 구성 중 오류가 발생했습니다.',

        detail:
          safeErrorDetail(
            error
          ),

        hint:
          isRagError
            ? 'Firestore Vector Index, Firebase 인증, GEMINI_API_KEY, RAG 환경변수를 확인하고 오류 정보를 전달해 주세요.'
            : '이 오류의 code, stage, detail, requestId를 그대로 전달해 주세요.'
      }
    );
  }

  let providerResult;

  try {
    stage =
      normalized.provider ===
        'openai'
        ? STAGE
            .OPENAI_REQUEST
        : STAGE
            .GEMINI_REQUEST;

    providerResult =
      await callSelectedProvider({
        normalized,
        systemInstruction,

        userPrompt:
          task.userPrompt,

        isJsonMode:
          task.isJsonMode,

        maxOutputTokens:
          task.maxOutputTokens,

        thinkingLevel:
          task.thinkingLevel
      });
  } catch (
    error
  ) {
    const isProviderError =
      error instanceof
      ProviderRequestError;

    const provider =
      error?.provider ||
      normalized
        .provider;

    const code =
      error?.providerCode ===
        ERROR_CODE
          .GEMINI_KEY_MISSING ||
      error?.providerCode ===
        ERROR_CODE
          .OPENAI_KEY_MISSING ||
      error?.providerCode ===
        ERROR_CODE
          .PROVIDER_EMPTY
        ? error.providerCode
        : provider ===
            'openai'
          ? `SG-OPENAI-${error?.providerStatus || '001'}`
          : `SG-GEMINI-${error?.providerStatus || '001'}`;

    const errorStage =
      error?.stage ||
      stage;

    logServerError({
      requestId,
      stage:
        errorStage,
      code,
      error
    });

    return sendError(
      res,
      {
        httpStatus:
          isProviderError
            ? error.status
            : 502,

        requestId,

        code,

        stage:
          errorStage,

        message:
          provider ===
            'openai'
            ? 'OpenAI 답변 생성 중 오류가 발생했습니다.'
            : 'Gemini 답변 생성 중 오류가 발생했습니다.',

        detail:
          safeErrorDetail(
            error
          ),

        hint:
          '오류창의 code, stage, detail, providerStatus, requestId를 그대로 복사해서 전달해 주세요.',

        provider,

        providerStatus:
          error
            ?.providerStatus ??
          null,

        providerCode:
          error
            ?.providerCode ??
          null
      }
    );
  }

  if (
    task.isJsonMode
  ) {
    try {
      stage =
        STAGE
          .JSON_PARSE;

      const jsonResult =
        parseJsonReply(
          providerResult
            .text
        );

      return res
        .status(200)
        .json({
          success:
            true,

          data:
            jsonResult,

          diagnostic: {
            status:
              'OK',

            requestId,

            stage:
              'COMPLETE',

            apiVersion:
              API_VERSION,

            provider:
              providerResult
                .provider,

            model:
              providerResult
                .model,

            engineFactsStatus:
              engineFactPacket
                .availability,

            rag: {
              status:
                ragRuntime
                  .status,

              required:
                ragRuntime
                  .required,

              fallbackUsed:
                ragRuntime
                  .fallbackUsed,

              query:
                ragRuntime
                  .query,

              retrieval:
                ragRuntime
                  .retrieval
            },

            timestamp:
              nowIso()
          }
        });
    } catch (
      error
    ) {
      logServerError({
        requestId,
        stage,

        code:
          ERROR_CODE
            .JSON_PARSE,

        error
      });

      return sendError(
        res,
        {
          httpStatus:
            502,

          requestId,

          code:
            ERROR_CODE
              .JSON_PARSE,

          stage,

          message:
            'AI 응답을 5대 영역 JSON으로 변환하지 못했습니다.',

          detail:
            safeErrorDetail(
              error
            ),

          hint:
            'provider/model과 raw response 형식 문제일 수 있습니다.',

          provider:
            providerResult
              .provider
        }
      );
    }
  }

  try {
    stage =
      STAGE
        .RESPONSE;

    return res
      .status(200)
      .json({
        success:
          true,

        reply:
          providerResult
            .text,

        diagnostic: {
          status:
            'OK',

          requestId,

          stage:
            'COMPLETE',

          apiVersion:
            API_VERSION,

          provider:
            providerResult
              .provider,

          model:
            providerResult
              .model,

          engineFactsStatus:
            engineFactPacket
              .availability,

          rag: {
            status:
              ragRuntime
                .status,

            required:
              ragRuntime
                .required,

            fallbackUsed:
              ragRuntime
                .fallbackUsed,

            query:
              ragRuntime
                .query,

            retrieval:
              ragRuntime
                .retrieval
          },

          timestamp:
            nowIso()
        }
      });
  } catch (
    error
  ) {
    logServerError({
      requestId,
      stage,

      code:
        ERROR_CODE
          .INTERNAL,

      error
    });

    return sendError(
      res,
      {
        httpStatus:
          500,

        requestId,

        code:
          ERROR_CODE
            .INTERNAL,

        stage,

        message:
          '채팅 API 응답 생성 중 오류가 발생했습니다.',

        detail:
          safeErrorDetail(
            error
          ),

        hint:
          '이 오류의 code, stage, detail, requestId를 그대로 전달해 주세요.'
      }
    );
  }
}