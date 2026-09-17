const BASE_URL = 'https://saju-grap.vercel.app';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(path, body, { retry = false } = {}) {
  const maxAttempts = retry ? 2 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const started = Date.now();
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await response.json().catch(() => null);
    if (response.ok && json?.success) return { json, elapsedMs: Date.now() - started, attempt };

    const code = String(json?.error?.code || '');
    const detail = String(json?.error?.detail || json?.error?.message || json?.message || '');
    const retryable429 = response.status === 429;
    const retryableTimeout = response.status === 502 && (code === 'SG-GEMINI-001' || /60000ms|시간.*초과|timeout/i.test(detail));
    if (attempt < maxAttempts && (retryable429 || retryableTimeout)) {
      let delayMs = 2500;
      if (retryable429) {
        const seconds = Number(detail.match(/retry in\s+([0-9.]+)s/i)?.[1] || 30);
        delayMs = Math.min(40000, Math.max(5000, (Math.ceil(seconds) + 2) * 1000));
      }
      console.log(`retryable provider failure: HTTP ${response.status} ${code}; retrying same messageId once`);
      await sleep(delayMs);
      continue;
    }
    throw new Error(`${path} HTTP ${response.status} ${code} ${detail}`);
  }
}

const profile = {
  name: '합성 운영 검증 사용자',
  year: 1985, month: 10, day: 24, hour: 11, minute: 45,
  gender: 1, calendarType: 'solar', timezone: 'Asia/Seoul'
};
const analysis = await post('/api/analyze', profile);
const engineData = analysis.json.data;
const referenceYear = Number(engineData.engineFacts?.cycles?.reference?.year);
const daewoon = engineData.engineFacts?.cycles?.daewoon || [];
const cycleIndex = Math.max(0, daewoon.findIndex((cycle) =>
  Number(cycle?.startYear) <= referenceYear && Number(cycle?.endYear) >= referenceYear
));
const sajuContext = {
  name: profile.name,
  pillars: engineData.pillars,
  dayPillar: engineData.pillars?.day,
  dayHanja: engineData.pillars?.dayHanja,
  engineFacts: engineData.engineFacts,
  cyclesData: engineData.cyclesData,
  timelineContexts: []
};

const sessionId = `prod-e08-resume-${Date.now()}`;
let state = {
  schemaVersion: 'sg_counseling_state_v1',
  sessionId,
  revision: 1,
  lastAppliedMessageId: 'E08-u1',
  appliedMessageIds: ['E08-u1'],
  subjects: [{ id: 'self', label: '사용자', kind: 'self', status: 'current' }],
  observations: [],
  goals: [],
  constraints: [{
    id: 'k1_1',
    text: '수입이 줄었어. 새 일을 늘리고 싶지만 부모님 돌봄 때문에 시간이 없어.',
    sourceMessageIds: ['E08-u1'],
    status: 'current',
    subjectId: 'self',
    kind: 'user_statement_fallback'
  }],
  attempts: [], hypotheses: [], corrections: [], openQuestions: []
};
let history = [
  { id: 'E08-u1', role: 'user', text: '수입이 줄었어. 새 일을 늘리고 싶지만 부모님 돌봄 때문에 시간이 없어.' },
  { id: 'E08-a1', role: 'model', text: '새로운 일을 더 늘리지 않으면서 현재 여건 안에서 대응 방향을 정리해 보겠습니다.' }
];
const turns = [
  ['E08-u2', '부업은 이미 두 번 해봤고 더 늘리지는 않을 거야.'],
  ['E08-u3', '사주상 흐름만 먼저 설명해줘.'],
  ['E08-u4', '아까 시간이 없다는 건 평일 저녁이고, 토요일 오전은 쓸 수 있어.'],
  ['E08-u5', '이번에는 사주 설명 말고 내가 이미 말한 조건으로 선택을 정리해줘.']
];
let finalReply = '';
for (let index = 0; index < turns.length; index += 1) {
  if (index > 0) await sleep(3500);
  const [messageId, userMessage] = turns[index];
  const result = await post('/api/chat', {
    mode: 'chat', provider: 'gemini', ragMode: 'off', cycle: '대운', cycleIndex,
    messageId, sessionId, baseRevision: Number(state.revision || 0), counselingState: state,
    userMessage, history: history.slice(-20), includeTrainingTrace: false, sajuContext
  }, { retry: true });
  state = result.json.counselingState || state;
  finalReply = String(result.json.reply || '');
  history.push(
    { id: messageId, role: 'user', text: userMessage },
    { id: `E08-a${index + 2}`, role: 'model', text: finalReply }
  );
  console.log(`\n=== PRODUCTION E08 RESUME TURN ${index + 2} ===`);
  console.log(finalReply);
  console.log(`attempt=${result.attempt} state=${JSON.stringify(result.json.diagnostic?.state || null)}`);
}

const activeText = (items) => (Array.isArray(items) ? items : [])
  .filter((item) => item?.status !== 'retracted' && item?.status !== 'superseded')
  .map((item) => String(item?.text || ''))
  .join(' ');
const constraintText = activeText(state.constraints);
const attemptText = activeText(state.attempts);
const checks = {
  revisionAdvanced: Number(state.revision || 0) >= 5,
  remembersNoMoreSideJobs: /부업/u.test(constraintText) && /(늘리지|하지\s*않|추가\s*불가)/u.test(constraintText),
  remembersSaturday: /토요일/u.test(constraintText) && /평일/u.test(constraintText),
  remembersAttempts: /부업/u.test(attemptText) && /(두\s*번|2번)/u.test(attemptText),
  concreteChoices: /(?:^|\n)\s*1[.)]/u.test(finalReply) && /(?:^|\n)\s*2[.)]/u.test(finalReply),
  noNewSideJob: !/(새\s*(?:부업|일)|단기\s*업무|추가\s*부업|토요일[^\n]{0,20}부업)/u.test(finalReply),
  noUnsupportedExpense: !/(고정비|불필요한\s*지출|과소비|지출을\s*줄|절약)/u.test(finalReply)
};
console.log('\n=== PRODUCTION E08 RESUME CHECKS ===');
console.log(JSON.stringify({ checks, revision: state.revision, constraints: state.constraints, attempts: state.attempts }, null, 2));
if (!Object.values(checks).every(Boolean)) {
  console.error('PRODUCTION E08 RESUME SMOKE: FAIL');
  process.exit(1);
}
console.log('PRODUCTION E08 RESUME SMOKE: PASS');
