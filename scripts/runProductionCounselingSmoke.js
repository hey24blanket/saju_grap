const BASE_URL = 'https://saju-grap.vercel.app';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(path, body, { retry429 = true } = {}) {
  for (let attempt = 1; attempt <= (retry429 ? 2 : 1); attempt += 1) {
    const started = Date.now();
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await response.json().catch(() => null);
    if (response.ok && json?.success) {
      return { json, elapsedMs: Date.now() - started };
    }
    const detail = String(json?.error?.detail || json?.error?.message || json?.message || '');
    if (response.status === 429 && attempt === 1 && retry429) {
      const seconds = Number(detail.match(/retry in\s+([0-9.]+)s/i)?.[1] || 30);
      console.log(`429 received; retrying once after ${Math.min(40, Math.max(5, Math.ceil(seconds) + 2))}s`);
      await sleep(Math.min(40, Math.max(5, Math.ceil(seconds) + 2)) * 1000);
      continue;
    }
    throw new Error(`${path} HTTP ${response.status} ${json?.error?.code || ''} ${detail}`);
  }
}

const profile = {
  name: '합성 운영 검증 사용자',
  year: 1985,
  month: 10,
  day: 24,
  hour: 11,
  minute: 45,
  gender: 1,
  calendarType: 'solar',
  timezone: 'Asia/Seoul'
};

const currentAnalysis = await post('/api/analyze', profile, { retry429: false });
const engineData = currentAnalysis.json.data;
const referenceYear = Number(engineData.engineFacts?.cycles?.reference?.year);
const nextYear = referenceYear + 1;
const nextAnalysis = await post('/api/analyze', {
  ...profile,
  referenceDateTime: `${nextYear}-09-15T12:00:00+09:00`
}, { retry429: false });

const timelineContexts = [{
  referenceYear: nextYear,
  engineFacts: {
    schemaVersion: nextAnalysis.json.data.engineFacts?.schemaVersion,
    engineVersion: nextAnalysis.json.data.engineFacts?.engineVersion,
    cycles: {
      reference: nextAnalysis.json.data.engineFacts?.cycles?.reference,
      month: nextAnalysis.json.data.engineFacts?.cycles?.month
    }
  },
  cyclesData: nextAnalysis.json.data.cyclesData?.month
    ? { month: nextAnalysis.json.data.cyclesData.month }
    : null
}];

const sajuContext = {
  name: profile.name,
  pillars: engineData.pillars,
  dayPillar: engineData.pillars?.day,
  dayHanja: engineData.pillars?.dayHanja,
  engineFacts: engineData.engineFacts,
  cyclesData: engineData.cyclesData,
  timelineContexts
};
const daewoon = engineData.engineFacts?.cycles?.daewoon || [];
const cycleIndex = Math.max(0, daewoon.findIndex((cycle) =>
  Number(cycle?.startYear) <= referenceYear && Number(cycle?.endYear) >= referenceYear
));

async function chatTurn({ sessionId, state, history, id, text }) {
  const result = await post('/api/chat', {
    mode: 'chat',
    provider: 'gemini',
    ragMode: 'off',
    cycle: '대운',
    cycleIndex,
    messageId: id,
    sessionId,
    baseRevision: Number(state?.revision || 0),
    counselingState: state,
    userMessage: text,
    history: history.slice(-20),
    includeTrainingTrace: false,
    sajuContext
  });
  return result;
}

const e07 = await chatTurn({
  sessionId: `prod-e07-${Date.now()}`,
  state: null,
  history: [],
  id: 'E07-u1',
  text: '내 금전운은 언제 풀릴까?'
});
console.log('\n=== PRODUCTION E07 ===');
console.log(e07.json.reply);
console.log(`elapsedMs=${e07.elapsedMs}`);

const e07Reply = String(e07.json.reply || '');
const e07Checks = {
  future2026Month: /2026년[^\n]*(10월|11월)|(10월|11월)[^\n]*2026년/u.test(e07Reply),
  nextYear: /2027년/u.test(e07Reply),
  noUnsupportedExpense: !/(고정비|불필요한\s*지출|과소비|지출을\s*줄|절약)/u.test(e07Reply),
  noGuarantee: !/(반드시\s*(?:받|벌|성공)|확실히\s*(?:받|벌|성공)|무조건\s*(?:받|벌|성공))/u.test(e07Reply)
};

const e08Turns = [
  '수입이 줄었어. 새 일을 늘리고 싶지만 부모님 돌봄 때문에 시간이 없어.',
  '부업은 이미 두 번 해봤고 더 늘리지는 않을 거야.',
  '사주상 흐름만 먼저 설명해줘.',
  '아까 시간이 없다는 건 평일 저녁이고, 토요일 오전은 쓸 수 있어.',
  '이번에는 사주 설명 말고 내가 이미 말한 조건으로 선택을 정리해줘.'
];
let e08State = null;
let e08History = [];
let e08FinalReply = '';
const e08SessionId = `prod-e08-${Date.now()}`;
for (let i = 0; i < e08Turns.length; i += 1) {
  if (i > 0) await sleep(3500);
  const id = `E08-u${i + 1}`;
  const result = await chatTurn({
    sessionId: e08SessionId,
    state: e08State,
    history: e08History,
    id,
    text: e08Turns[i]
  });
  e08State = result.json.counselingState || e08State;
  e08FinalReply = result.json.reply || '';
  e08History.push(
    { id, role: 'user', text: e08Turns[i] },
    { id: `E08-a${i + 1}`, role: 'model', text: e08FinalReply }
  );
  console.log(`\n=== PRODUCTION E08 TURN ${i + 1} ===`);
  console.log(e08FinalReply);
  console.log(`state=${JSON.stringify(result.json.diagnostic?.state || null)}`);
  console.log(`elapsedMs=${result.elapsedMs}`);
}

const activeText = (items) => (Array.isArray(items) ? items : [])
  .filter((item) => item?.status !== 'retracted' && item?.status !== 'superseded')
  .map((item) => String(item?.text || ''))
  .join(' ');
const constraintText = activeText(e08State?.constraints);
const attemptText = activeText(e08State?.attempts);
const e08Checks = {
  revisionAdvanced: Number(e08State?.revision || 0) >= 5,
  remembersNoMoreSideJobs: /부업/u.test(constraintText) && /(늘리지|하지\s*않|추가\s*불가)/u.test(constraintText),
  remembersSaturday: /토요일/u.test(constraintText) && /평일/u.test(constraintText),
  remembersAttempts: /(두\s*번|2번)/u.test(attemptText) && /부업/u.test(attemptText),
  concreteChoices: /(?:^|\n)\s*1[.)]/u.test(e08FinalReply) && /(?:^|\n)\s*2[.)]/u.test(e08FinalReply),
  noNewSideJob: !/(새\s*(?:부업|일)|단기\s*업무|추가\s*부업|토요일[^\n]{0,20}부업)/u.test(e08FinalReply),
  noUnsupportedExpense: !/(고정비|불필요한\s*지출|과소비|지출을\s*줄|절약)/u.test(e08FinalReply)
};

console.log('\n=== PRODUCTION SMOKE CHECKS ===');
console.log(JSON.stringify({ e07Checks, e08Checks, finalRevision: e08State?.revision || 0 }, null, 2));

const passed = Object.values(e07Checks).every(Boolean) && Object.values(e08Checks).every(Boolean);
if (!passed) {
  console.error('PRODUCTION COUNSELING SMOKE: FAIL');
  process.exit(1);
}
console.log('PRODUCTION COUNSELING SMOKE: PASS');
