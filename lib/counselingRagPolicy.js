export const RAG_POLICY_VERSION =
  'sajugrap_counseling_rag_policy_v1';

export const RAG_MODES = Object.freeze({
  OFF: 'off',
  OPTIONAL: 'optional',
  REQUIRED: 'required'
});

const VALID_MODES = new Set(Object.values(RAG_MODES));

function cleanMode(value) {
  const mode = typeof value === 'string'
    ? value.trim().toLowerCase()
    : '';
  return VALID_MODES.has(mode) ? mode : '';
}

export function resolveRagMode({
  requestMode,
  runtimeMode,
  environmentMode = process.env.RAG_MODE,
  legacyRequired = process.env.RAG_REQUIRED,
  chat = false
} = {}) {
  const explicit = cleanMode(runtimeMode) ||
    cleanMode(environmentMode) ||
    cleanMode(requestMode);

  if (explicit) return explicit;

  if (legacyRequired !== undefined && legacyRequired !== null && String(legacyRequired).trim() !== '') {
    return String(legacyRequired).toLowerCase() === 'false'
      ? RAG_MODES.OPTIONAL
      : RAG_MODES.REQUIRED;
  }

  return chat ? RAG_MODES.OPTIONAL : RAG_MODES.REQUIRED;
}

const KNOWLEDGE_FOCUS_TASKS = new Set([
  'timing',
  'explanation',
  'reality_bridge'
]);

const EXAMPLE_STRATEGY_FOCUS_TASKS = new Set([
  'timing',
  'explanation',
  'reality_bridge',
  'correction',
  'choice'
]);

export function shouldRetrieveKnowledgeForFocus({
  focus = null,
  evidencePacket = null,
  userMessage = ''
} = {}) {
  const task = focus?.task || '';
  if (KNOWLEDGE_FOCUS_TASKS.has(task)) return true;

  const evidenceCount = Array.isArray(evidencePacket?.evidence)
    ? evidencePacket.evidence.length
    : 0;
  if (
    task === 'general' &&
    focus?.inherited &&
    focus?.domain &&
    focus.domain !== 'all' &&
    evidenceCount > 0
  ) {
    return true;
  }

  return shouldRetrieveForChat(userMessage);
}

export function shouldRetrieveExampleStrategyForFocus({
  focus = null,
  userMessage = ''
} = {}) {
  const task = focus?.task || '';
  if (EXAMPLE_STRATEGY_FOCUS_TASKS.has(task)) return true;
  return shouldRetrieveForChat(userMessage);
}

export function shouldRetrieveForChat(message) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return false;

  if (/^(고마워|감사|알겠어|알겠습니다|응|네|그래|좋아|됐어)[.!?\s]*$/u.test(text)) {
    return false;
  }

  if (/^(아까|방금|정정|수정).{0,50}(아니|말고|맞아|틀려|였어|입니다)/u.test(text)) {
    return false;
  }

  if (/(근거|출처|연구|자료|이론|원리|의미|왜|설명|사주|용신|기신|십신|합충|운세|운이|연운|월운|대운|세운|금전운|재물운|사업운|연애운|심신운|언제\s*(?:쯤)?\s*(?:풀|좋|나아))/u.test(text)) {
    return true;
  }

  return text.length >= 24 && /[?？]|(어떻게|무엇|뭘|할까|좋을까|봐야|도와|조언)/u.test(text);
}

export function classifyRagError(error) {
  const code = String(error?.code || '').toLowerCase();
  const stage = String(error?.stage || error?.sajuRagStage || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();

  if (code.includes('embedding') || stage.includes('embedding') || message.includes('embedding')) {
    return 'embedding_error';
  }
  if (code.includes('config') || stage.includes('config') || message.includes('환경변수')) {
    return 'configuration_error';
  }
  return 'retrieval_error';
}

function withTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`RAG retrieval exceeded ${timeoutMs}ms`);
      error.code = 'SG-RAG-TIMEOUT';
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function executeRagPolicy({
  mode,
  needed = true,
  timeoutMs = 8000,
  retrieve
}) {
  const resolvedMode = cleanMode(mode) || RAG_MODES.OPTIONAL;

  if (resolvedMode === RAG_MODES.OFF) {
    return {
      status: 'disabled',
      mode: resolvedMode,
      required: false,
      query: null,
      retrieval: null,
      contextText: '',
      fallbackUsed: false
    };
  }

  if (!needed && resolvedMode === RAG_MODES.OPTIONAL) {
    return {
      status: 'skipped_not_needed',
      mode: resolvedMode,
      required: false,
      query: null,
      retrieval: null,
      contextText: '',
      fallbackUsed: false
    };
  }

  try {
    const value = await withTimeout(Promise.resolve().then(retrieve), timeoutMs);
    const status = value?.status || 'used';

    if (status === 'used' || status === 'ok') {
      return {
        ...value,
        status: 'used',
        mode: resolvedMode,
        required: resolvedMode === RAG_MODES.REQUIRED,
        fallbackUsed: false
      };
    }

    if (resolvedMode === RAG_MODES.REQUIRED) {
      const error = new Error(`RAG required but unavailable: ${status}`);
      error.code = 'SG-RAG-REQUIRED-UNAVAILABLE';
      error.sajuRagStage = 'RAG_VECTOR_RETRIEVAL';
      throw error;
    }

    return {
      ...value,
      status,
      mode: resolvedMode,
      required: false,
      contextText: '',
      fallbackUsed: true
    };
  } catch (error) {
    if (resolvedMode === RAG_MODES.REQUIRED) throw error;

    return {
      status: classifyRagError(error),
      mode: resolvedMode,
      required: false,
      query: null,
      retrieval: null,
      contextText: '',
      fallbackUsed: true,
      errorCode: typeof error?.code === 'string' ? error.code.slice(0, 120) : null
    };
  }
}

export default Object.freeze({
  RAG_POLICY_VERSION,
  RAG_MODES,
  resolveRagMode,
  shouldRetrieveForChat,
  shouldRetrieveKnowledgeForFocus,
  shouldRetrieveExampleStrategyForFocus,
  classifyRagError,
  executeRagPolicy
});
