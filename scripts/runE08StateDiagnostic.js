import chatHandler from '../api/chat.js';
import SajuGrapEngine from '../src/engine/SajuGrapEngine.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function analyzeFixture(referenceYear) {
  const facts = SajuGrapEngine.analyze({
    name: '합성 평가 사용자', year: 1985, month: 10, day: 24,
    hour: 11, minute: 45, gender: 1, calendarType: 'solar',
    timezone: 'Asia/Seoul', referenceDateTime: `${referenceYear}-09-16T12:00:00+09:00`
  });
  const legacy = SajuGrapEngine.toLegacyApiData(facts);
  return { engineFacts: facts, cyclesData: legacy.cyclesData };
}

function createResponseCapture() {
  const capture = { statusCode: 200, headers: {}, body: null };
  return {
    capture,
    res: {
      setHeader(name, value) { capture.headers[name] = value; },
      status(code) { capture.statusCode = code; return this; },
      json(value) { capture.body = value; return value; },
      end() { return null; }
    }
  };
}

async function invoke(body) {
  const { capture, res } = createResponseCapture();
  await chatHandler({ method: 'POST', body }, res, {
    ragMode: 'off', counselingPrototypeEnabled: true
  });
  if (capture.statusCode >= 400 || !capture.body?.success) {
    const error = new Error(`HTTP ${capture.statusCode} ${capture.body?.error?.code || ''} ${capture.body?.error?.detail || ''}`);
    error.statusCode = capture.statusCode;
    throw error;
  }
  return capture.body;
}

const current = analyzeFixture(2026);
const daewoon = current.engineFacts.cycles?.daewoon || [];
const cycleIndex = Math.max(0, daewoon.findIndex((cycle) =>
  Number(cycle?.startYear) <= 2026 && Number(cycle?.endYear) >= 2026
));
const sajuContext = {
  name: '합성 평가 사용자', engineFacts: current.engineFacts,
  cyclesData: current.cyclesData, timelineContexts: []
};
const turns = [
  '수입이 줄었어. 새 일을 늘리고 싶지만 부모님 돌봄 때문에 시간이 없어.',
  '부업은 이미 두 번 해봤고 더 늘리지는 않을 거야.',
  '사주상 흐름만 먼저 설명해줘.',
  '아까 시간이 없다는 건 평일 저녁이고, 토요일 오전은 쓸 수 있어.',
  '이번에는 사주 설명 말고 내가 이미 말한 조건으로 선택을 정리해줘.'
];

let state = null;
let history = [];
const sessionId = `e08-state-${Date.now()}`;

for (let index = 0; index < turns.length; index += 1) {
  const messageId = `E08-u${index + 1}`;
  const userMessage = turns[index];
  let result;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      result = await invoke({
        mode: 'chat', provider: 'gemini', ragMode: 'off', cycle: '대운',
        cycleIndex, messageId, sessionId,
        baseRevision: Number(state?.revision || 0), counselingState: state,
        userMessage, history: history.slice(-20), includeTrainingTrace: false, sajuContext
      });
      break;
    } catch (error) {
      console.log(`TURN ${index + 1} ATTEMPT ${attempt} ERROR: ${error.message}`);
      if (attempt === 2) throw error;
      if (error.statusCode === 429 || /HTTP 429/.test(error.message)) {
        console.log('Gemini 429: waiting 30 seconds before one retry.');
        await sleep(30000);
      } else {
        await sleep(1500);
      }
    }
  }
  state = result.counselingState || state;
  history = [...history,
    { id: messageId, role: 'user', text: userMessage },
    { id: `E08-a${index + 1}`, role: 'model', text: result.reply || '' }
  ];
  console.log(`\n=== E08 TURN ${index + 1} ===`);
  console.log(`USER: ${userMessage}`);
  console.log(`AI: ${result.reply || ''}`);
  console.log(`STATE_DIAGNOSTIC: ${JSON.stringify(result.diagnostic?.state || null)}`);
  console.log(`CONSTRAINTS: ${JSON.stringify(state?.constraints || [])}`);
  console.log(`ATTEMPTS: ${JSON.stringify(state?.attempts || [])}`);
}

const finalConstraints = state?.constraints || [];
const finalAttempts = state?.attempts || [];
const rememberedNoMoreSideJobs = finalConstraints.some((item) =>
  /(부업|새 일)/u.test(item?.text || '') && /(늘리지|추가하지|하지 않|안 함|중단)/u.test(item?.text || '')
);
const rememberedSaturdayMorning = finalConstraints.some((item) =>
  /토요일/u.test(item?.text || '') && /오전/u.test(item?.text || '')
);
const rememberedPriorAttempts = finalAttempts.some((item) =>
  /부업/u.test(item?.text || '') && /(두 번|2번|두차례|2회)/u.test(item?.text || '')
);

console.log('\n=== FINAL STATE ===');
console.log(JSON.stringify({
  revision: state?.revision,
  constraints: finalConstraints,
  attempts: finalAttempts,
  goals: state?.goals || [],
  checks: {
    rememberedNoMoreSideJobs,
    rememberedSaturdayMorning,
    rememberedPriorAttempts
  }
}, null, 2));

if (!rememberedNoMoreSideJobs || !rememberedSaturdayMorning || !rememberedPriorAttempts) {
  console.error('E08 STATE GATE: FAIL');
  process.exit(1);
}
console.log('E08 STATE GATE: PASS');
