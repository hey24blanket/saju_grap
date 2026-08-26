// api/analyze.js
// SajuGrap Engine Facts v1 API Orchestration Layer
// -----------------------------------------------------------------------------
// IMPORTANT
// - No independent Saju calculation is allowed in this file.
// - SajuGrapEngine is the single Source of Truth.
// - This API only validates the request, invokes the Engine, builds a temporary
//   UI compatibility response, and returns structured diagnostics.
// - RAG/LLM must never recalculate Engine Facts.
// -----------------------------------------------------------------------------

const API_VERSION = 'analyze_api_v1';
const DEFAULT_TIMEZONE = 'Asia/Seoul';
const DEFAULT_CALENDAR_TYPE = 'solar';

const STAGE = Object.freeze({
  REQUEST: 'REQUEST_VALIDATION',
  ENGINE_IMPORT: 'ENGINE_IMPORT',
  ENGINE_ANALYZE: 'ENGINE_ANALYZE',
  ENGINE_VALIDATE: 'ENGINE_FACTS_VALIDATION',
  UI_PROJECTION: 'UI_COMPATIBILITY_PROJECTION',
  RESPONSE: 'RESPONSE_SERIALIZATION'
});

const ERROR_CODE = Object.freeze({
  METHOD_NOT_ALLOWED: 'SG-API-405',
  INVALID_JSON: 'SG-INPUT-001',
  INVALID_INPUT: 'SG-INPUT-002',
  ENGINE_IMPORT: 'SG-ENGINE-IMPORT-001',
  ENGINE_ANALYZE: 'SG-ENGINE-001',
  ENGINE_VALIDATE: 'SG-ENGINE-002',
  UI_PROJECTION: 'SG-UI-PROJECTION-001',
  RESPONSE: 'SG-API-500'
});

function makeRequestId() {
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `sg_${timePart}_${randomPart}`;
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

  // OpenAI-style keys
  text = text.replace(
    /sk-[A-Za-z0-9_\-]{12,}/g,
    '[REDACTED_OPENAI_KEY]'
  );

  // Google API key-style values
  text = text.replace(
    /AIza[A-Za-z0-9_\-]{20,}/g,
    '[REDACTED_GOOGLE_KEY]'
  );

  // Bearer tokens
  text = text.replace(
    /Bearer\s+[A-Za-z0-9._\-]+/gi,
    'Bearer [REDACTED]'
  );

  // Common env assignment leaks
  text = text.replace(
    /(OPENAI_API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY|FIREBASE_[A-Z0-9_]+)\s*=\s*[^\s,;]+/gi,
    '$1=[REDACTED]'
  );

  // Prevent huge error payloads from reaching the browser.
  if (text.length > 1200) {
    text = `${text.slice(0, 1200)}…`;
  }

  return text;
}

function safeErrorDetail(error) {
  if (!error) return 'Unknown error';

  if (typeof error === 'string') {
    return redactSecrets(error);
  }

  return redactSecrets(
    error.message ||
    error.name ||
    'Unknown error'
  );
}

function logServerError({
  requestId,
  stage,
  code,
  error
}) {
  // Full stack is kept on the server only.
  console.error(
    `[SajuGrap][${requestId}][${stage}][${code}]`,
    {
      name: error?.name,
      message: redactSecrets(error?.message),
      stack: redactSecrets(error?.stack)
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
    hint = null
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

    // Current index.html already reads this.
    message,

    error: {
      code,
      stage,
      message,
      detail: redactSecrets(
        detail || message
      ),
      hint,
      requestId,
      httpStatus,
      timestamp: nowIso(),
      apiVersion: API_VERSION
    }
  });
}

class InputValidationError extends Error {
  constructor(message, field = null) {
    super(message);

    this.name =
      'InputValidationError';

    this.field =
      field;
  }
}

function parseInteger(
  value,
  fieldName,
  {
    min,
    max
  }
) {
  const parsed =
    Number.parseInt(
      value,
      10
    );

  if (
    !Number.isInteger(parsed) ||
    parsed < min ||
    parsed > max
  ) {
    throw new InputValidationError(
      `${fieldName} 값이 올바르지 않습니다. 허용 범위: ${min}~${max}`,
      fieldName
    );
  }

  return parsed;
}

function normalizeGender(value) {
  if (
    value === 'male' ||
    value === 'M' ||
    value === 'm' ||
    Number(value) === 1
  ) {
    return 'male';
  }

  if (
    value === 'female' ||
    value === 'F' ||
    value === 'f' ||
    Number(value) === 0 ||
    Number(value) === 2
  ) {
    return 'female';
  }

  throw new InputValidationError(
    'gender 값이 올바르지 않습니다. 1/male 또는 0·2/female 형식을 사용하세요.',
    'gender'
  );
}

function validateRealDate(
  year,
  month,
  day
) {
  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );

  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  if (!valid) {
    throw new InputValidationError(
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}는 유효한 날짜가 아닙니다.`,
      'birthDate'
    );
  }
}

function validateAndNormalizeRequest(
  body
) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body)
  ) {
    throw new InputValidationError(
      '요청 본문(JSON)이 없거나 올바르지 않습니다.'
    );
  }

  const year =
    parseInteger(
      body.year,
      'year',
      {
        min: 1900,
        max: 2100
      }
    );

  const month =
    parseInteger(
      body.month,
      'month',
      {
        min: 1,
        max: 12
      }
    );

  const day =
    parseInteger(
      body.day,
      'day',
      {
        min: 1,
        max: 31
      }
    );

  const hour =
    parseInteger(
      body.hour ?? 12,
      'hour',
      {
        min: 0,
        max: 23
      }
    );

  const minute =
    parseInteger(
      body.minute ?? 0,
      'minute',
      {
        min: 0,
        max: 59
      }
    );

  validateRealDate(
    year,
    month,
    day
  );

  const gender =
    normalizeGender(
      body.gender ?? 1
    );

  const name =
    typeof body.name === 'string' &&
    body.name.trim()
      ? body.name
          .trim()
          .slice(0, 80)
      : '사용자';

  const calendarType =
    body.calendarType === 'lunar'
      ? 'lunar'
      : DEFAULT_CALENDAR_TYPE;

  const timezone =
    typeof body.timezone === 'string' &&
    body.timezone.trim()
      ? body.timezone.trim()
      : DEFAULT_TIMEZONE;

  return {
    name,
    year,
    month,
    day,
    hour,
    minute,
    second: 0,
    gender,
    calendarType,
    timezone,

    referenceDateTime:
      typeof body.referenceDateTime ===
      'string'
        ? body.referenceDateTime
        : null
  };
}

function elementLabel(
  element
) {
  return (
    {
      wood: '목',
      fire: '화',
      earth: '토',
      metal: '금',
      water: '수'
    }[element] ||
    element ||
    '-'
  );
}

function mechanismLabel(
  mechanism
) {
  return (
    {
      regulation: '억부',
      climate: '조후',
      bridge: '통관',
      disease_remedy: '병약',
      special_structure: '특수구조',
      mixed: '복합'
    }[mechanism] ||
    mechanism
  );
}

function factRoleLine(
  label,
  role
) {
  if (!role) {
    return `${label} Fact: 없음`;
  }

  const mechanisms =
    Array.isArray(
      role.mechanisms
    )
      ? role.mechanisms
          .map(
            mechanismLabel
          )
          .join(', ')
      : '-';

  return [
    `${label} Fact`,
    `오행=${elementLabel(role.element)}`,
    `십신그룹=${role.tenGodGroup || '-'}`,
    `mechanism=${mechanisms}`,
    `need=${role.need || '-'}`,
    `availability=${role.currentAvailability || '-'}`,
    `confidence=${role.confidence ?? '-'}`
  ].join(' · ');
}

function buildFactOnlyAiCompatibility(
  engineFacts,
  legacyData
) {
  // Temporary compatibility for current index.html.
  //
  // IMPORTANT:
  // These are NOT interpretations.
  // These are NOT RAG knowledge.
  // These strings only expose already-calculated Engine Facts.

  const useful =
    engineFacts.usefulGodProfile;

  const strength =
    engineFacts.strength;

  const firstDaewoon =
    engineFacts.cycles
      ?.daewoon?.[0] ||
    null;

  return {
    yongsin:
      factRoleLine(
        '용신',
        useful?.yongsin
      ),

    heesin:
      factRoleLine(
        '희신',
        useful?.heesin?.[0]
      ),

    gisin:
      factRoleLine(
        '기신',
        useful?.gisin?.[0]
      ),

    gusin:
      factRoleLine(
        '구신',
        useful?.gusin?.[0]
      ),

    strength: [
      '강약 Engine Fact',
      `band=${strength?.band || '-'}`,
      `score=${strength?.score ?? '-'}`,
      `method=${strength?.methodId || '-'}`,
      `confidence=${strength?.confidence ?? '-'}`
    ].join(' · '),

    flow:
      firstDaewoon
        ? [
            '대운 Engine Fact',
            `direction=${
              legacyData
                ?.meta
                ?.isForward
                ? 'forward'
                : 'reverse'
            }`,
            `first=${firstDaewoon.ganzhi}`,
            `startAge=${firstDaewoon.ageRange?.start ?? '-'}`,
            `twelveStage=${firstDaewoon.twelveStage?.stage || '-'}`
          ].join(' · ')
        : '대운 Engine Fact: 계산 결과 없음',

    masterInsight: [
      'Engine Facts v1 계산 완료',
      `강약=${strength?.band || '-'}`,
      `용신=${elementLabel(useful?.yongsin?.element)}`,
      `schema=${engineFacts.schemaVersion}`,
      `engine=${engineFacts.engineVersion}`
    ].join(' · ')
  };
}

async function loadEngine() {
  // Dynamic import is deliberate.
  //
  // If SajuGrapEngine itself fails to import,
  // this API can still return a structured
  // SG-ENGINE-IMPORT-001 JSON response.

  return import(
    '../src/engine/SajuGrapEngine.js'
  );
}

export default async function handler(
  req,
  res
) {
  const requestId =
    makeRequestId();

  let stage =
    STAGE.REQUEST;

  setCorsHeaders(res);

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
    req.method === 'OPTIONS'
  ) {
    return res
      .status(200)
      .end();
  }

  if (
    req.method !== 'POST'
  ) {
    return sendError(
      res,
      {
        httpStatus: 405,
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
          'index.html의 /api/analyze fetch method가 POST인지 확인하세요.'
      }
    );
  }

  let normalizedInput;

  try {
    stage =
      STAGE.REQUEST;

    normalizedInput =
      validateAndNormalizeRequest(
        req.body
      );
  } catch (error) {
    const code =
      error instanceof
      InputValidationError
        ? ERROR_CODE.INVALID_INPUT
        : ERROR_CODE.INVALID_JSON;

    return sendError(
      res,
      {
        httpStatus: 400,
        requestId,
        code,
        stage,

        message:
          '입력값을 확인해 주세요.',

        detail:
          safeErrorDetail(error),

        hint:
          error?.field
            ? `문제 필드: ${error.field}`
            : '이름, 생년월일시, 성별 입력값을 확인하세요.'
      }
    );
  }

  let engineModule;

  try {
    stage =
      STAGE.ENGINE_IMPORT;

    engineModule =
      await loadEngine();
  } catch (error) {
    logServerError({
      requestId,
      stage,

      code:
        ERROR_CODE
          .ENGINE_IMPORT,

      error
    });

    return sendError(
      res,
      {
        httpStatus: 500,
        requestId,

        code:
          ERROR_CODE
            .ENGINE_IMPORT,

        stage,

        message:
          '사주 계산 엔진을 불러오지 못했습니다.',

        detail:
          safeErrorDetail(error),

        hint:
          'src/engine/SajuGrapEngine.js의 import 문법, ESM 설정, lunar-javascript 설치 상태를 확인하세요.'
      }
    );
  }

  const SajuGrapEngine =
    engineModule
      ?.SajuGrapEngine ||
    engineModule
      ?.default;

  if (
    !SajuGrapEngine ||
    typeof SajuGrapEngine
      .analyze !==
      'function'
  ) {
    return sendError(
      res,
      {
        httpStatus: 500,
        requestId,

        code:
          ERROR_CODE
            .ENGINE_IMPORT,

        stage:
          STAGE.ENGINE_IMPORT,

        message:
          'SajuGrapEngine 인터페이스를 찾지 못했습니다.',

        detail:
          'Expected SajuGrapEngine.analyze() export is missing.',

        hint:
          'src/engine/SajuGrapEngine.js의 export default / named export를 확인하세요.'
      }
    );
  }

  let engineFacts;

  try {
    stage =
      STAGE.ENGINE_ANALYZE;

    engineFacts =
      SajuGrapEngine.analyze(
        normalizedInput
      );
  } catch (error) {
    logServerError({
      requestId,
      stage,

      code:
        ERROR_CODE
          .ENGINE_ANALYZE,

      error
    });

    return sendError(
      res,
      {
        httpStatus: 500,
        requestId,

        code:
          ERROR_CODE
            .ENGINE_ANALYZE,

        stage,

        message:
          'SajuGrapEngine 계산 중 오류가 발생했습니다.',

        detail:
          safeErrorDetail(error),

        hint:
          '이 오류창의 code, stage, detail, requestId를 그대로 복사해서 전달해 주세요.'
      }
    );
  }

  try {
    stage =
      STAGE.ENGINE_VALIDATE;

    if (
      typeof SajuGrapEngine
        .validate !==
      'function'
    ) {
      throw new Error(
        'SajuGrapEngine.validate() export is missing.'
      );
    }

    const validation =
      SajuGrapEngine.validate(
        engineFacts
      );

    if (
      !validation?.valid
    ) {
      const fields =
        Array.isArray(
          validation?.errors
        )
          ? validation.errors.join(
              ', '
            )
          : 'unknown validation error';

      throw new Error(
        `Engine Facts schema validation failed: ${fields}`
      );
    }
  } catch (error) {
    logServerError({
      requestId,
      stage,

      code:
        ERROR_CODE
          .ENGINE_VALIDATE,

      error
    });

    return sendError(
      res,
      {
        httpStatus: 500,
        requestId,

        code:
          ERROR_CODE
            .ENGINE_VALIDATE,

        stage,

        message:
          'Engine Facts v1 검증에 실패했습니다.',

        detail:
          safeErrorDetail(error),

        hint:
          'schemaVersion, strength.band, stars.methodId, cycles.twelveStage.methodId 등을 확인하세요.'
      }
    );
  }

  let data;

  try {
    stage =
      STAGE.UI_PROJECTION;

    if (
      typeof SajuGrapEngine
        .toLegacyApiData !==
      'function'
    ) {
      throw new Error(
        'SajuGrapEngine.toLegacyApiData() export is missing.'
      );
    }

    data =
      SajuGrapEngine
        .toLegacyApiData(
          engineFacts
        );

    // Temporary index.html compatibility.
    //
    // No hardcoded fortune interpretation
    // is generated here.
    data.aiPack =
      buildFactOnlyAiCompatibility(
        engineFacts,
        data
      );

    // Development diagnostics.
    data.runtimeDiagnostics = {
      status:
        'OK',

      requestId,

      apiVersion:
        API_VERSION,

      schemaVersion:
        engineFacts.schemaVersion,

      engineVersion:
        engineFacts.engineVersion,

      schemaValidation:
        'PASS',

      warningCount:
        engineFacts
          .diagnostics
          ?.warnings
          ?.length ??
        0,

      conflictCount:
        engineFacts
          .diagnostics
          ?.conflicts
          ?.length ??
        0,

      timestamp:
        nowIso()
    };
  } catch (error) {
    logServerError({
      requestId,
      stage,

      code:
        ERROR_CODE
          .UI_PROJECTION,

      error
    });

    return sendError(
      res,
      {
        httpStatus: 500,
        requestId,

        code:
          ERROR_CODE
            .UI_PROJECTION,

        stage,

        message:
          '기존 화면용 데이터 변환 중 오류가 발생했습니다.',

        detail:
          safeErrorDetail(error),

        hint:
          'Engine 계산은 성공했지만 index.html 호환 projection에서 실패했습니다.'
      }
    );
  }

  try {
    stage =
      STAGE.RESPONSE;

    return res
      .status(200)
      .json({
        success: true,

        data,

        diagnostic: {
          status:
            'OK',

          requestId,

          stage:
            'COMPLETE',

          apiVersion:
            API_VERSION,

          schemaVersion:
            engineFacts
              .schemaVersion,

          engineVersion:
            engineFacts
              .engineVersion,

          schemaValidation:
            'PASS',

          timestamp:
            nowIso()
        }
      });
  } catch (error) {
    logServerError({
      requestId,
      stage,

      code:
        ERROR_CODE
          .RESPONSE,

      error
    });

    return sendError(
      res,
      {
        httpStatus: 500,
        requestId,

        code:
          ERROR_CODE
            .RESPONSE,

        stage,

        message:
          'API 응답 생성 중 오류가 발생했습니다.',

        detail:
          safeErrorDetail(error),

        hint:
          '응답 데이터에 JSON 직렬화가 불가능한 값이 있는지 확인하세요.'
      }
    );
  }
}
