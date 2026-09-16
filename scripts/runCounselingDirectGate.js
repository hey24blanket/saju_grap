import chatHandler from '../api/chat.js';
import SajuGrapEngine from '../src/engine/SajuGrapEngine.js';

function analyzeFixture(referenceYear) {
  const facts = SajuGrapEngine.analyze({
    name: '합성 평가 사용자',
    year: 1985,
    month: 10,
    day: 24,
    hour: 11,
    minute: 45,
    gender: 1,
    calendarType: 'solar',
    timezone: 'Asia/Seoul',
    referenceDateTime: `${referenceYear}-09-16T12:00:00+09:00`
  });
  const legacy = SajuGrapEngine.toLegacyApiData(facts);
  return { engineFacts: facts, cyclesData: legacy.cyclesData };
}

function timelineContext(fixture, referenceYear) {
  return {
    referenceYear,
    engineFacts: {
      schemaVersion: fixture.engineFacts.schemaVersion,
      engineVersion: fixture.engineFacts.engineVersion,
      cycles: {
        reference: fixture.engineFacts.cycles?.reference,
        month: fixture.engineFacts.cycles?.month
      }
    },
    cyclesData: fixture.cyclesData?.month
      ? { month: fixture.cyclesData.month }
      : null
  };
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
  await chatHandler(
    { method: 'POST', body },
    res,
    {
      ragMode: 'off',
      counselingPrototypeEnabled: true
    }
  );
  if (capture.statusCode >= 400 || !capture.body?.success) {
    const error = new Error(
      `chat failed HTTP ${capture.statusCode} ${capture.body?.error?.code || ''} ${capture.body?.error?.detail || capture.body?.message || ''}`
    );
    error.capture = capture;
    throw error;
  }
  return capture.body;
}

const current = analyzeFixture(2026);
const next = analyzeFixture(2027);
const daewoon = Array.isArray(current.engineFacts.cycles?.daewoon)
  ? current.engineFacts.cycles.daewoon
  : [];
const currentDaewoonIndex = Math.max(0, daewoon.findIndex((cycle) =>
  Number(cycle?.startYear) <= 2026 && Number(cycle?.endYear) >= 2026
));

const sajuContext = {
  name: '합성 평가 사용자',
  engineFacts: current.engineFacts,
  cyclesData: current.cyclesData,
  timelineContexts: [timelineContext(next, 2027)]
};

async function runScenario(id, turns) {
  const sessionId = `direct-gate-${id}-${Date.now()}`;
  let state = null;
  let history = [];
  const outputs = [];

  for (let index = 0; index < turns.length; index += 1) {
    const userMessage = turns[index];
    const messageId = `${id}-u${index + 1}`;
    let result;
    let attempt = 0;
    while (attempt < 2) {
      attempt += 1;
      try {
        result = await invoke({
          mode: 'chat',
          provider: 'gemini',
          ragMode: 'off',
          cycle: '대운',
          cycleIndex: currentDaewoonIndex,
          messageId,
          sessionId,
          baseRevision: Number(state?.revision || 0),
          counselingState: state,
          userMessage,
          history: history.slice(-20),
          includeTrainingTrace: false,
          sajuContext
        });
        break;
      } catch (error) {
        console.log(`[${id} turn ${index + 1}] attempt ${attempt} failed: ${error.message}`);
        if (attempt >= 2) throw error;
      }
    }

    const reply = result.reply || '';
    state = result.counselingState || state;
    history = [
      ...history,
      { id: messageId, role: 'user', text: userMessage },
      { id: `${id}-a${index + 1}`, role: 'model', text: reply }
    ];
    outputs.push({ turn: index + 1, userMessage, reply, state });
    console.log(`\n=== ${id} TURN ${index + 1} ===`);
    console.log(`USER: ${userMessage}`);
    console.log(`AI: ${reply}`);
  }
  return outputs;
}

const e07 = await runScenario('E07', [
  '내 금전운은 언제 풀릴까?'
]);

const e08 = await runScenario('E08', [
  '수입이 줄었어. 새 일을 늘리고 싶지만 부모님 돌봄 때문에 시간이 없어.',
  '부업은 이미 두 번 해봤고 더 늘리지는 않을 거야.',
  '사주상 흐름만 먼저 설명해줘.',
  '아까 시간이 없다는 건 평일 저녁이고, 토요일 오전은 쓸 수 있어.',
  '이번에는 사주 설명 말고 내가 이미 말한 조건으로 선택을 정리해줘.'
]);

const e07Reply = e07[0]?.reply || '';
const e08Final = e08.at(-1)?.reply || '';
const e08State = e08.at(-1)?.state || {};
const allStateText = JSON.stringify(e08State);

const checks = {
  e07Has2026FutureMonth: /2026[^\n]{0,80}(10|11)월|10[–~-]11월/.test(e07Reply),
  e07Has2027Window: /2027/.test(e07Reply) && /(2|3|4|5)월/.test(e07Reply),
  e08RemembersNoMoreSideJobs: /부업/.test(allStateText) && /(늘리지|더 늘리|추가)/.test(allStateText),
  e08RemembersSaturdayMorning: /토요일 오전/.test(`${allStateText}\n${e08Final}`),
  e08FinalHasConcreteChoiceShape: /(1\.|2\.|①|②|첫째|둘째|선택지)/.test(e08Final)
};

console.log('\n=== QUALITY GATE CHECKS ===');
console.log(JSON.stringify(checks, null, 2));

if (Object.values(checks).some((value) => value !== true)) {
  console.error('DIRECT QUALITY GATE: FAIL');
  process.exitCode = 1;
} else {
  console.log('DIRECT QUALITY GATE: PASS');
}
