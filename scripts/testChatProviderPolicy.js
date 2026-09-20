import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FALLBACK_CHAT_PROVIDER,
  PRIMARY_CHAT_PROVIDER,
  invokeProviderWithPriority,
  shouldAttemptOpenAIFallback
} from '../lib/chatProviderPolicy.js';

test('prototype path prefers Gemini and falls back to OpenAI when Gemini is blocked', () => {
  assert.equal(PRIMARY_CHAT_PROVIDER, 'gemini');
  assert.equal(FALLBACK_CHAT_PROVIDER, 'openai');
  assert.equal(shouldAttemptOpenAIFallback({ requestedProvider: 'gemini' }), true);
  assert.equal(shouldAttemptOpenAIFallback({ requestedProvider: undefined }), true);
  assert.equal(shouldAttemptOpenAIFallback({ requestedProvider: 'openai' }), false);
  assert.equal(shouldAttemptOpenAIFallback({
    requestedProvider: 'gemini',
    injectedCallProvider: async () => ({})
  }), false);
});

test('injected callProvider skips live Gemini/OpenAI fallback', async () => {
  const result = await invokeProviderWithPriority({
    requestedProvider: 'gemini',
    injectedCallProvider: async () => ({
      text: 'mock-reply',
      provider: 'mock',
      model: 'mock-model'
    }),
    callGemini: async () => {
      throw new Error('gemini should not run');
    },
    callOpenAI: async () => {
      throw new Error('openai should not run');
    },
    options: {}
  });

  assert.equal(result.provider, 'mock');
  assert.equal(result.fallbackUsed, false);
});

test('explicit openai stays on OpenAI without trying Gemini first', async () => {
  const result = await invokeProviderWithPriority({
    requestedProvider: 'openai',
    callGemini: async () => {
      throw new Error('gemini should not run');
    },
    callOpenAI: async () => ({
      text: 'gpt-reply',
      provider: 'openai',
      model: 'gpt-test'
    }),
    options: {}
  });

  assert.equal(result.provider, 'openai');
  assert.equal(result.text, 'gpt-reply');
  assert.equal(result.fallbackUsed, false);
});

test('Gemini success does not call OpenAI', async () => {
  let openaiCalls = 0;
  const result = await invokeProviderWithPriority({
    requestedProvider: 'gemini',
    callGemini: async () => ({
      text: 'gemini-reply',
      provider: 'gemini',
      model: 'gemini-test'
    }),
    callOpenAI: async () => {
      openaiCalls += 1;
      return { text: 'gpt-reply', provider: 'openai', model: 'gpt-test' };
    },
    options: {}
  });

  assert.equal(result.provider, 'gemini');
  assert.equal(result.text, 'gemini-reply');
  assert.equal(result.fallbackUsed, false);
  assert.equal(openaiCalls, 0);
});

test('blocked Gemini falls through to OpenAI', async () => {
  const geminiError = Object.assign(new Error('Gemini 429'), {
    provider: 'gemini',
    providerCode: 'RESOURCE_EXHAUSTED',
    providerStatus: 429,
    status: 429
  });

  const result = await invokeProviderWithPriority({
    requestedProvider: 'gemini',
    callGemini: async () => {
      throw geminiError;
    },
    callOpenAI: async () => ({
      text: 'gpt-fallback',
      provider: 'openai',
      model: 'gpt-test'
    }),
    options: {}
  });

  assert.equal(result.provider, 'openai');
  assert.equal(result.text, 'gpt-fallback');
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.fallbackFrom, 'gemini');
  assert.equal(result.fallbackError.providerCode, 'RESOURCE_EXHAUSTED');
});

test('both providers failing surfaces the OpenAI error and keeps the Gemini cause', async () => {
  const geminiError = Object.assign(new Error('Gemini blocked'), {
    provider: 'gemini',
    providerCode: 'SG-ENV-GEMINI-001'
  });
  const openaiError = Object.assign(new Error('OpenAI blocked'), {
    provider: 'openai',
    providerCode: 'SG-ENV-OPENAI-001'
  });

  await assert.rejects(
    () => invokeProviderWithPriority({
      requestedProvider: 'gemini',
      callGemini: async () => {
        throw geminiError;
      },
      callOpenAI: async () => {
        throw openaiError;
      },
      options: {}
    }),
    (error) => {
      assert.equal(error.providerCode, 'SG-ENV-OPENAI-001');
      assert.equal(error.primaryError, geminiError);
      return true;
    }
  );
});
