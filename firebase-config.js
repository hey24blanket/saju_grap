// firebase-config.js
// Firebase 프로젝트 설정 (한 번만 입력해 두면 index.html에서 자동으로 불러옵니다)
window.firebaseConfig = {
  apiKey: "AIzaSyDhN4RjhOrqYAs3OdJdAfEQqlO60O5qXlQ",
  authDomain: "saju-grap.firebaseapp.com",
  projectId: "saju-grap",
  storageBucket: "saju-grap.firebasestorage.app",
  messagingSenderId: "498768758041",
  appId: "1:498768758041:web:aaa2f9ff0b4ffba26ef188",
  measurementId: "G-FD2WYJZYC1"
};

// Counseling P0 recovery -------------------------------------------------------
// The chat UI historically committed a user turn to chatHistory only after the
// provider returned a successful answer. A provider timeout could therefore
// make a visible user turn disappear from the next model request. Keep only
// failed/unabsorbed user turns in sessionStorage and inject them into the next
// chat request. This is same-tab recovery, not cloud persistence or RAG data.
(() => {
  if (
    typeof window === 'undefined' ||
    typeof window.fetch !== 'function' ||
    !window.sessionStorage ||
    window.__sajuCounselingRecoveryInstalled === true
  ) {
    return;
  }

  const nativeFetch = window.fetch.bind(window);
  const STORAGE_PREFIX = 'sg_pending_counseling_turns_v1:';
  const MAX_PENDING_TURNS = 8;
  const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000;

  function cleanText(value, maxLength = 5000) {
    return typeof value === 'string'
      ? value.trim().slice(0, maxLength)
      : '';
  }

  function cleanId(value) {
    return cleanText(value, 120).replace(/[^a-zA-Z0-9_.:-]/g, '');
  }

  function storageKey(sessionId) {
    const id = cleanId(sessionId);
    return id ? `${STORAGE_PREFIX}${id}` : '';
  }

  function loadPending(sessionId) {
    const key = storageKey(sessionId);
    if (!key) return [];

    try {
      const parsed = JSON.parse(window.sessionStorage.getItem(key) || '[]');
      const now = Date.now();
      return (Array.isArray(parsed) ? parsed : [])
        .map((item) => ({
          id: cleanId(item?.id),
          role: 'user',
          text: cleanText(item?.text),
          createdAt: Number(item?.createdAt) || now
        }))
        .filter((item) =>
          item.id &&
          item.text &&
          now - item.createdAt <= MAX_PENDING_AGE_MS
        )
        .slice(-MAX_PENDING_TURNS);
    } catch {
      return [];
    }
  }

  function savePending(sessionId, items) {
    const key = storageKey(sessionId);
    if (!key) return;

    const deduped = [];
    const seen = new Set();
    for (const item of Array.isArray(items) ? items : []) {
      const normalized = {
        id: cleanId(item?.id),
        role: 'user',
        text: cleanText(item?.text),
        createdAt: Number(item?.createdAt) || Date.now()
      };
      if (!normalized.id || !normalized.text || seen.has(normalized.id)) continue;
      seen.add(normalized.id);
      deduped.push(normalized);
    }

    const next = deduped.slice(-MAX_PENDING_TURNS);
    if (next.length === 0) {
      window.sessionStorage.removeItem(key);
      return;
    }
    window.sessionStorage.setItem(key, JSON.stringify(next));
  }

  function referencedMessageIds(state) {
    const ids = new Set();
    if (!state || typeof state !== 'object') return ids;

    for (const collection of [
      'observations',
      'goals',
      'constraints',
      'attempts',
      'hypotheses',
      'corrections',
      'openQuestions'
    ]) {
      const items = Array.isArray(state[collection]) ? state[collection] : [];
      for (const item of items) {
        const sources = Array.isArray(item?.sourceMessageIds)
          ? item.sourceMessageIds
          : [];
        for (const sourceId of sources) {
          const id = cleanId(sourceId);
          if (id) ids.add(id);
        }
      }
    }
    return ids;
  }

  function isChatApiRequest(input, init, payload) {
    if (!payload || payload.mode !== 'chat') return false;
    const method = String(
      init?.method ||
      (typeof input === 'object' && input ? input.method : '') ||
      'GET'
    ).toUpperCase();
    if (method !== 'POST') return false;

    const rawUrl = typeof input === 'string'
      ? input
      : (input?.url || '');
    try {
      const base = window.location?.href || 'https://saju-grap.invalid/';
      return new URL(rawUrl, base).pathname === '/api/chat';
    } catch {
      return rawUrl === '/api/chat';
    }
  }

  window.fetch = async function sajugrapCounselingRecoveryFetch(input, init = {}) {
    let payload = null;
    try {
      payload = typeof init?.body === 'string'
        ? JSON.parse(init.body)
        : null;
    } catch {
      payload = null;
    }

    if (!isChatApiRequest(input, init, payload)) {
      return nativeFetch(input, init);
    }

    const sessionId = cleanId(payload.sessionId);
    const messageId = cleanId(payload.messageId);
    const userMessage = cleanText(payload.userMessage);
    if (!sessionId || !messageId || !userMessage) {
      return nativeFetch(input, init);
    }

    const pending = loadPending(sessionId);
    const history = Array.isArray(payload.history) ? payload.history : [];
    const historyIds = new Set(
      history
        .map((item) => cleanId(item?.id))
        .filter(Boolean)
    );

    // A retry of the same message must not appear once in history and once as
    // userMessage. Only older failed turns are recovered before the new turn.
    const recovered = pending
      .filter((item) => item.id !== messageId && !historyIds.has(item.id))
      .map((item) => ({ id: item.id, role: 'user', text: item.text }));

    const patchedPayload = {
      ...payload,
      history: [...history, ...recovered].slice(-20)
    };

    // Commit the raw user turn before the provider call. It remains pending if
    // the network/provider fails and is removed when this turn succeeds.
    savePending(sessionId, [
      ...pending.filter((item) => item.id !== messageId),
      { id: messageId, role: 'user', text: userMessage, createdAt: Date.now() }
    ]);

    const response = await nativeFetch(input, {
      ...init,
      body: JSON.stringify(patchedPayload)
    });

    let responseJson = null;
    try {
      responseJson = await response.clone().json();
    } catch {
      responseJson = null;
    }

    if (response.ok && responseJson?.success === true && responseJson?.reply) {
      const absorbed = referencedMessageIds(responseJson.counselingState);
      const latestPending = loadPending(sessionId);
      savePending(
        sessionId,
        latestPending.filter((item) =>
          item.id !== messageId &&
          !absorbed.has(item.id)
        )
      );
    }

    return response;
  };

  window.__sajuCounselingRecoveryInstalled = true;
})();
