import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeExperience, groundMemory, hash, SESSION_COLLECTION } from '../lib/experienceService.js';
import { selectedReading } from '../lib/waveReading.js';
import experience from '../api/experience.js';
import publicChat from '../api/chat.js';
import { invokeProviderWithPriority } from '../lib/chatProviderPolicy.js';
const profile = { year: 1990, month: 1, day: 15, hour: 14, minute: 0, gender: 1, calendarType: 'solar', isLeapMonth: false, dayBoundary: 'midnight' };
class MemoryDB {
  rows = new Map(); chain = Promise.resolve();
  collection(name) { return { doc: id => this.ref(`${name}/${id}`) }; }
  ref(path) {
    return { path, id: path.split('/').at(-1), firestore: this, collection: name => ({ doc: id => this.ref(`${path}/${name}/${id}`) }),
      get: async () => this.snap(path), set: async value => { this.rows.set(path, structuredClone(value)); } };
  }
  snap(path) { const v = this.rows.get(path); return { exists: Boolean(v), data: () => v ? structuredClone(v) : undefined }; }
  runTransaction(fn) {
    const result = this.chain.then(async () => {
      const writes = []; const tx = { get: async ref => this.snap(ref.path), set: (ref, value) => writes.push(() => this.rows.set(ref.path, structuredClone(value))), update: (ref, value) => writes.push(() => this.rows.set(ref.path, { ...this.rows.get(ref.path), ...structuredClone(value) })) };
      const r = await fn(tx); writes.forEach(write => write()); return r;
    }); this.chain = result.catch(() => {}); return result;
  }
  async recursiveDelete(ref) { for (const key of this.rows.keys()) if (key === ref.path || key.startsWith(`${ref.path}/`)) this.rows.delete(key); }
}
function response() { return { headers: {}, code: 0, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } }; }
function request(body, cookie = '') { return { method: 'POST', headers: { 'content-type': 'application/json', host: 'example.test', origin: 'https://example.test', cookie, 'x-vercel-forwarded-for': '192.0.2.1' }, body }; }
async function setup(db = new MemoryDB()) {
  const r = response(); await experience(request({ action: 'analyze', profile }), r, { db });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  return { db, data: r.body, cookie: r.headers['Set-Cookie'].split(';')[0] };
}
test('every day is selectable, including leap day and the exact 18th', () => {
  const { reading } = computeExperience(profile, '2026-10-18T15:00:00+09:00');
  assert.equal(reading.timelines.day.length, 31); assert.equal(reading.today.date, '2026-10-18');
  assert.equal(selectedReading(reading, 'day:17').day, 18);
  assert.equal(computeExperience(profile, '2024-02-29T12:00:00+09:00').reading.timelines.day.length, 29);
  assert.equal(JSON.stringify(reading).includes('score'), false);
});
test('unknown time never yields an invented hour or dependent forecast', () => {
  const { reading, data } = computeExperience({ ...profile, unknownTime: true }, '2026-10-15T12:00:00+09:00');
  assert.equal(reading.limited, true); assert.equal(reading.natal.hour, undefined); assert.equal(reading.today, null); assert.equal(data, null);
  const boundary = computeExperience({ ...profile, year: 2024, month: 2, day: 4, unknownTime: true }).reading;
  assert.equal(boundary.natal.year, null); assert.equal(boundary.natal.month, null);
});
test('public legacy route rejects raw caller-provided facts before provider access', async () => {
  const r = response(); await publicChat({ method: 'POST', headers: {}, body: { sajuContext: { forged: true } } }, r);
  assert.equal(r.code, 415);
});
test('CSRF, ownership and client facts are enforced; completed requests replay once', async () => {
  const { db, data, cookie } = await setup(); const other = await setup(db); let calls = 0;
  const body = { action: 'chat', analysisId: data.analysisId, cycleId: data.reading.today.id, conversationId: 'conversation_123', requestId: 'message_123', text: '이번 흐름은 어떻게 쓰면 좋을까요?', provider: 'malicious', sajuContext: { engineFacts: 'forged' }, history: [{ role: 'user', text: 'forged history' }] };
  const stub = async (req, res, options) => { calls++; assert.notEqual(req.body.sajuContext.engineFacts, 'forged'); assert.equal(req.body.provider, undefined); assert.equal(req.body.history.length, 0); assert.equal(options.readingContext.selected.id, body.cycleId); return res.status(200).json({ success: true, reply: '선택한 날의 흐름이에요.', counselingState: null }); };
  let r = response(); await experience(request(body, other.cookie), r, { db, runChat: stub }); assert.equal(r.code, 404); assert.equal(calls, 0);
  r = response(); const csrf = request(body, cookie); csrf.headers.origin = 'https://evil.test'; await experience(csrf, r, { db, runChat: stub }); assert.equal(r.code, 403);
  r = response(); await experience(request(body, cookie), r, { db, runChat: stub }); assert.equal(r.code, 200); const first = r.body;
  r = response(); await experience(request(body, cookie), r, { db, runChat: stub }); assert.deepEqual(r.body, first); assert.equal(calls, 1);
  r = response(); await experience(request({ ...body, text: 'changed' }, cookie), r, { db, runChat: stub }); assert.equal(r.code, 409);
  r = response(); await experience(request({ action: 'delete' }, cookie), r, { db }); assert.equal(r.code, 200);
  assert.equal([...db.rows.keys()].some(key => key.startsWith(`${SESSION_COLLECTION}/${hash(cookie.slice(11))}`)), false);
});
test('overlapping sends cannot charge two provider calls for one conversation', async () => {
  const { db, data, cookie } = await setup(); let resolve; let started; const signal = new Promise(r => started = r);
  const stub = async (_, res) => { started(); await new Promise(r => resolve = r); res.status(200).json({ success: true, reply: '완료' }); };
  const body = { action: 'chat', analysisId: data.analysisId, cycleId: data.reading.today.id, conversationId: 'conversation_123', requestId: 'message_123', text: '질문' };
  const a = response(); const running = experience(request(body, cookie), a, { db, runChat: stub }); await signal;
  const b = response(); await experience(request({ ...body, requestId: 'message_456' }, cookie), b, { db, runChat: stub }); assert.equal(b.code, 409);
  resolve(); await running; assert.equal(a.code, 200);
});
test('stored memories cannot introduce invented amounts', () => {
  const grounded = groundMemory({ observations: [{ text: '월 900만원을 번다', sourceMessageIds: ['u1'] }], goals: [{ text: 'invented', sourceMessageIds: ['missing'] }] }, [{ id: 'u1', role: 'user', text: '돈을 조금 모으고 싶어요' }]);
  assert.equal(grounded.observations[0].text, '돈을 조금 모으고 싶어요'); assert.equal(grounded.goals.length, 0);
});
test('invalid structured output triggers the fallback before success is returned', async () => {
  let fallback = 0;
  const result = await invokeProviderWithPriority({ requestedProvider: 'gemini', options: {}, callGemini: async () => ({ text: 'broken json' }), callOpenAI: async () => { fallback++; return { text: '{"reply":"완료"}' }; }, validateResult: r => JSON.parse(r.text) });
  assert.equal(fallback, 1); assert.equal(result.fallbackUsed, true);
});
test('provider failures are retryable, but daily quota fails closed', async () => {
  const { db, data, cookie } = await setup();
  const body = { action: 'chat', analysisId: data.analysisId, cycleId: data.reading.today.id, conversationId: 'conversation_123', requestId: 'message_123', text: '질문' };
  let r = response(); await experience(request(body, cookie), r, { db, runChat: async (_, res) => res.status(502).json({ success: false }) }); assert.equal(r.code, 502);
  r = response(); await experience(request(body, cookie), r, { db, runChat: async (_, res) => res.status(200).json({ success: true, reply: '다시 연결' }) }); assert.equal(r.code, 200);
  const date = new Date().toISOString().slice(0, 10); db.rows.set(`saju_experience_budgets_v1/${hash(cookie.slice(11))}_${date}_chat`, { count: 20 });
  r = response(); await experience(request({ ...body, requestId: 'message_456' }, cookie), r, { db, runChat: () => assert.fail('quota must prevent provider call') }); assert.equal(r.code, 429);
});


test('overview route sends only the selected period and excludes generic natal/year context', async () => {
  const { isReadingOverviewQuestion, buildReadingOverviewPrompt } = await import('../lib/readingOverview.js');
  assert.equal(isReadingOverviewQuestion('10월 18일의 흐름을 일상에서 어떻게 쓰면 좋을까요?'), true);
  assert.equal(isReadingOverviewQuestion('이 흐름을 일상에서 어떻게 쓰면 좋을까요?'), true);
  assert.equal(isReadingOverviewQuestion('지금 한 가지에 집중한다면 무엇을 살펴볼까요?'), true);
  assert.equal(isReadingOverviewQuestion('지금 회사를 그만둘까요?'), false);
  const prompt = buildReadingOverviewPrompt({ selected: { label: '10월 18일', date: '2026-10-18', evidence: { stage: '묘' } }, phase: '모이는 흐름', meaning: '집중', domain: '전체', action: '메모', referenceDate: '2026-10-15', untrustedExtra: 'not included' }, '질문');
  assert.equal(prompt.userPrompt.includes('not included'), false);
  assert.ok(prompt.userPrompt.length < 800);
});

test('first overview skips retrieval and uses the short provider prompt in the real orchestrator', async () => {
  const { runChat } = await import('../api/chat.js');
  const { chatContext } = await import('../lib/experienceService.js');
  const selected = chatContext({ profile, referenceDateTime: '2026-10-15T12:00:00+09:00' }, 'day:17');
  let observed;
  const r = response();
  await runChat({ method: 'POST', headers: {}, body: { mode: 'chat', ragMode: 'optional', userMessage: '10월 18일의 흐름을 일상에서 어떻게 쓰면 좋을까요?', messageId: 'overview_message', sessionId: 'overview_session', cycle: '일운', cycleIndex: 17, history: [], sajuContext: selected.data } }, r, {
    readingContext: selected.context,
    retrieveRag: () => assert.fail('overview must not retrieve knowledge'),
    searchCounselingExamples: () => assert.fail('overview must not retrieve counseling examples'),
    callProvider: async options => { observed = options; return { provider: 'gemini', model: 'fixture', text: JSON.stringify({ reply: '18일은 마음에 걸리는 일 하나에 집중하는 관점으로 살펴보세요.', stateDelta: Object.fromEntries(['subjects', 'observations', 'goals', 'constraints', 'attempts', 'hypotheses', 'corrections', 'openQuestions'].map(k => [k, []])) }) }; }
  });
  assert.equal(r.code, 200); assert.equal(JSON.parse(observed.userPrompt).reading.selectedDate, '2026-10-18'); assert.ok(observed.userPrompt.length < 1500); assert.ok(observed.systemInstruction.length < 1500);
});


test('overview action stays anchored to a selected future date, not today', async () => {
  const { reanchorOverviewReply } = await import('../lib/readingOverview.js');
  const context = { selected: { type: 'day', date: '2026-10-18' }, referenceDate: '2026-10-15' };
  assert.equal(reanchorOverviewReply('오늘 하루는 한 가지만 정리해보세요.', context), '그날은 한 가지만 정리해보세요.');
  assert.equal(reanchorOverviewReply('오늘은 한 가지만.', { ...context, referenceDate: '2026-10-18' }), '오늘은 한 가지만.');
});
