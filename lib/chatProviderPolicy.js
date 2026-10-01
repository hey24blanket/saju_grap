// lib/chatProviderPolicy.js
// Prototype chat provider priority
// -----------------------------------------------------------------------------
// - Gemini is always first for the prototype user path.
// - OpenAI runs only when Gemini is blocked or fails.
// - Explicit openai (eval / future admin) is honored without Gemini-first retry.
// - Injected callProvider (tests) skips live fallback so fixtures stay deterministic.
// -----------------------------------------------------------------------------

export const PRIMARY_CHAT_PROVIDER = 'gemini';
export const FALLBACK_CHAT_PROVIDER = 'openai';

export function shouldAttemptOpenAIFallback({
  requestedProvider,
  injectedCallProvider
} = {}) {
  if (typeof injectedCallProvider === 'function') return false;
  const provider = String(requestedProvider || PRIMARY_CHAT_PROVIDER).toLowerCase();
  return provider === PRIMARY_CHAT_PROVIDER;
}

function summarizeProviderError(error) {
  if (!error) return null;
  return {
    message: error.message || 'gemini_failed',
    provider: error.provider || PRIMARY_CHAT_PROVIDER,
    providerStatus: error.providerStatus ?? null,
    providerCode: error.providerCode ?? null,
    status: error.status ?? null
  };
}

export async function invokeProviderWithPriority({
  requestedProvider,
  injectedCallProvider,
  callGemini,
  callOpenAI,
  options
}) {
  if (typeof injectedCallProvider === 'function') {
    return {
      ...(await injectedCallProvider(options)),
      fallbackUsed: false
    };
  }

  const provider = String(requestedProvider || PRIMARY_CHAT_PROVIDER).toLowerCase();

  if (provider === FALLBACK_CHAT_PROVIDER) {
    return {
      ...(await callOpenAI(options)),
      fallbackUsed: false
    };
  }

  try {
    return {
      ...(await callGemini(options)),
      fallbackUsed: false
    };
  } catch (primaryError) {
    try {
      return {
        ...(await callOpenAI(options)),
        fallbackUsed: true,
        fallbackFrom: PRIMARY_CHAT_PROVIDER,
        fallbackError: summarizeProviderError(primaryError)
      };
    } catch (fallbackError) {
      if (fallbackError && typeof fallbackError === 'object') {
        fallbackError.primaryError = primaryError;
      }
      throw fallbackError;
    }
  }
}

// Focused live comparison: constrained choices require stronger instruction adherence.
// Explicit evaluation/provider requests remain authoritative.
export function selectCounselingProvider(normalized = {}) {
  if (normalized.mode !== 'chat' || normalized.providerExplicit) return normalized.provider || PRIMARY_CHAT_PROVIDER;
  const state = normalized.counselingState || {};
  const active = [...(state.constraints || []), ...(state.attempts || [])]
    .filter(item => !['superseded', 'retracted'].includes(item?.status));
  const asksForDecision = /선택|우선|정리해|추천|어떻게\s*(?:할|해야)/u.test(normalized.userMessage || '');
  return active.length && asksForDecision ? FALLBACK_CHAT_PROVIDER : normalized.provider || PRIMARY_CHAT_PROVIDER;
}
