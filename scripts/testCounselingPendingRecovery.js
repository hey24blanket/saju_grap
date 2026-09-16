import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class SessionStorageMock {
  constructor() {
    this.map = new Map();
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(key, String(value));
  }

  removeItem(key) {
    this.map.delete(key);
  }
}

const calls = [];
const queued = [];

const nativeFetch = async (_input, init) => {
  calls.push(JSON.parse(init.body));
  const next = queued.shift();
  return new Response(JSON.stringify(next.body), {
    status: next.status,
    headers: { 'content-type': 'application/json' }
  });
};

const context = {
  URL,
  Date,
  JSON,
  Set,
  Response,
  window: {
    fetch: nativeFetch,
    sessionStorage: new SessionStorageMock(),
    location: { href: 'https://example.test/' }
  }
};
context.window.window = context.window;

vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../firebase-config.js', import.meta.url), 'utf8'), context);

async function send(body, result) {
  queued.push(result);
  return context.window.fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

const base = {
  mode: 'chat',
  sessionId: 'session-1',
  counselingState: null,
  baseRevision: 0,
  history: []
};

await send(
  {
    ...base,
    messageId: 'u1',
    userMessage: '부업을 더 늘리지는 않겠다.'
  },
  {
    status: 502,
    body: { success: false, error: { code: 'timeout' } }
  }
);
assert.deepEqual(calls[0].history, []);

await send(
  {
    ...base,
    messageId: 'u2',
    userMessage: '그 조건 안에서 선택지를 줘.'
  },
  {
    status: 200,
    body: {
      success: true,
      reply: '선택지를 정리할게요.',
      counselingState: {
        constraints: [
          {
            sourceMessageIds: ['u1'],
            text: '부업을 늘리지 않음'
          }
        ]
      }
    }
  }
);
assert.deepEqual(calls[1].history, [
  {
    id: 'u1',
    role: 'user',
    text: '부업을 더 늘리지는 않겠다.'
  }
]);

await send(
  {
    ...base,
    messageId: 'u3',
    userMessage: '마지막으로 두 개만 골라줘.'
  },
  {
    status: 200,
    body: {
      success: true,
      reply: '두 가지입니다.',
      counselingState: {}
    }
  }
);
assert.deepEqual(calls[2].history, []);

await send(
  {
    ...base,
    messageId: 'u4',
    userMessage: '재시도할 문장'
  },
  {
    status: 502,
    body: { success: false }
  }
);

await send(
  {
    ...base,
    messageId: 'u4',
    userMessage: '재시도할 문장'
  },
  {
    status: 200,
    body: {
      success: true,
      reply: '복구됨',
      counselingState: {}
    }
  }
);
assert.deepEqual(calls[4].history, []);

console.log('counseling pending-turn recovery: PASS');
