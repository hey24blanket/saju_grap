import chatHandler from '../api/chat.js';
import SajuGrapEngine from '../src/engine/SajuGrapEngine.js';

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
    throw new Error(`HTTP ${capture.statusCode} ${capture.body?.error?.code || ''} ${capture.body?.error?.detail || ''}`);
  }
  return capture.body;
}

const facts = SajuGrapEngine.analyze({
  name: '합성 평가 사용자', year: 1985, month: 10, day: 24,
  hour: 11, minute: 45, gender: 1, calendarType: 'solar',
  timezone: 'Asia/Seoul', referenceDateTime: '2026-09-16T12:00:00+09:00'
});
const legacy = SajuGrapEngine.toLegacyApiData(facts);
const daewoon = facts.cycles?.daewoon || [];
const cycleIndex = Math.max(0, daewoon.findIndex((cycle) =>
  Number(cycle?.startYear) <= 2026 && Number(cycle?.endYear) >= 2026
));
const sessionId = `e08-final-${Date.now()}`;
const counselingState = {
  schemaVersion: 'sg_counseling_state_v1',
  sessionId,
  revision: 4,
  lastAppliedMessageId: 'E08-u4',
  appliedMessageIds: ['E08-u1', 'E08-u2', 'E08-u3', 'E08-u4'],
  subjects: [{ id: 'self', label: '사용자', kind: 'self', status: 'current' }],
  observations: [],
  goals: [{ id: 'g1_1', text: '수입 감소에 대응할 현실적인 선택을 찾고 싶음', sourceMessageIds: ['E08-u1'], status: 'current', subjectId: 'self', kind: 'goal' }],
  constraints: [
    { id: 'k1_1', text: '부모님 돌봄 때문에 평일 저녁 시간 사용이 어려움', sourceMessageIds: ['E08-u1'], status: 'current', subjectId: 'self', kind: 'constraint' },
    { id: 'k2_1', text: '부업을 더 늘리지 않음', sourceMessageIds: ['E08-u2'], status: 'current', subjectId: 'self', kind: 'constraint' },
    { id: 'k4_1', text: '평일 저녁 시간 불가, 토요일 오전 시간 사용 가능', sourceMessageIds: ['E08-u4'], status: 'current', subjectId: 'self', kind: 'constraint' }
  ],
  attempts: [{ id: 'a2_1', text: '부업을 이미 두 번 해봄', sourceMessageIds: ['E08-u2'], status: 'current', subjectId: 'self', kind: 'attempt' }],
  hypotheses: [], corrections: [], openQuestions: []
};
const history = [
  { id: 'E08-u1', role: 'user', text: '수입이 줄었어. 새 일을 늘리고 싶지만 부모님 돌봄 때문에 시간이 없어.' },
  { id: 'E08-a1', role: 'model', text: '새 일을 늘리기 어려운 시간 제약이 있군요.' },
  { id: 'E08-u2', role: 'user', text: '부업은 이미 두 번 해봤고 더 늘리지는 않을 거야.' },
  { id: 'E08-a2', role: 'model', text: '부업을 더 늘리지 않는 경계를 반영하겠습니다.' },
  { id: 'E08-u3', role: 'user', text: '사주상 흐름만 먼저 설명해줘.' },
  { id: 'E08-a3', role: 'model', text: '사주 흐름을 설명했습니다.' },
  { id: 'E08-u4', role: 'user', text: '아까 시간이 없다는 건 평일 저녁이고, 토요일 오전은 쓸 수 있어.' },
  { id: 'E08-a4', role: 'model', text: '평일 저녁 불가, 토요일 오전 가능으로 정정했습니다.' }
];

const result = await invoke({
  mode: 'chat', provider: 'gemini', ragMode: 'off', cycle: '대운', cycleIndex,
  messageId: 'E08-u5', sessionId, baseRevision: 4, counselingState,
  userMessage: '이번에는 사주 설명 말고 내가 이미 말한 조건으로 선택을 정리해줘.',
  history, includeTrainingTrace: false,
  sajuContext: { name: '합성 평가 사용자', engineFacts: facts, cyclesData: legacy.cyclesData, timelineContexts: [] }
});

const reply = result.reply || '';
const unsupportedExpense = /(불필요한\s*(?:고정\s*)?지출|고정비|절약|소비\s*축소|지출\s*(?:구조|점검|삭감|절감))/u.test(reply);
const remembersSaturday = /토요일\s*오전/u.test(reply);
const staysInExistingWork = /(기존\s*(?:업무|일)|현재\s*(?:업무|일)|정산|단가|업무\s*범위|작업\s*방식)/u.test(reply);

console.log('=== E08 FINAL CHOICE ===');
console.log(reply);
console.log('=== CHECKS ===');
console.log(JSON.stringify({ unsupportedExpense, remembersSaturday, staysInExistingWork }, null, 2));

if (unsupportedExpense || !remembersSaturday || !staysInExistingWork) {
  console.error('E08 FINAL CHOICE GATE: FAIL');
  process.exit(1);
}
console.log('E08 FINAL CHOICE GATE: PASS');
