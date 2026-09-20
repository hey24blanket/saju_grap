import assert from 'node:assert/strict';

import SajuGrapEngine from '../src/engine/SajuGrapEngine.js';
import { buildCounselingFactContext } from '../lib/counselingFactContext.js';
import {
  buildCounselingOrchestration,
  buildCounselingOrchestratorDiagnostic
} from '../lib/counselingOrchestrator.js';
import {
  COUNSELING_CHAT_SYSTEM,
  COUNSELING_PROMPT_VERSION,
  buildCounselingTurnPrompt
} from '../lib/counselingPrompt.js';
import {
  INTERPRETATION_COMMITMENT_DEFAULT,
  COUNSELING_CHAT_MAX_OUTPUT_TOKENS
} from '../lib/counselingInterpretationPolicy.js';

function analyzeFixture(referenceYear = 2026) {
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
  return {
    engineFacts: facts,
    cyclesData: SajuGrapEngine.toLegacyApiData(facts).cyclesData
  };
}

function orchestrate({ userMessage, messageId = 'u1', history = [], referenceYear = 2026 }) {
  const sajuContext = analyzeFixture(referenceYear);
  const counselingFactContext = buildCounselingFactContext({
    sajuContext,
    userMessage,
    history,
    selectedDomain: '총운'
  });
  return buildCounselingOrchestration({
    userMessage,
    messageId,
    history,
    sajuContext,
    counselingFactContext,
    selectedDomain: '총운'
  });
}

function hasYear(orchestration, year) {
  return orchestration.evidencePacket.evidence.some(
    (item) => item.scope === 'year' && String(item.period) === String(year)
  );
}

function testCaseA_Year2027Overall() {
  const turn = orchestrate({ userMessage: '2027년 총운 봐줘' });
  assert.equal(turn.focus.coverageIntent, 'overall');
  assert.ok(hasYear(turn, 2027), 'year-2027 must be selected');
  assert.ok(turn.evidencePacket.evidence.some((item) => item.id === 'daewoon-current'));
  assert.ok(turn.evidencePacket.evidence.some((item) => item.id === 'natal-overall'));
  assert.equal(turn.interpretationBrief.requestedPeriodCoverage.complete, true);
  assert.ok(turn.interpretationBrief.requestedPeriodCoverage.selected.includes('year-2027'));
  const prompt = buildCounselingTurnPrompt({
    userMessage: '2027년 총운 봐줘',
    messageId: 'u1',
    counselingState: {},
    conversationFocus: turn.focus,
    relevantEvidenceText: turn.relevantEvidenceText,
    interpretationBrief: turn.interpretationBrief
  });
  assert.match(prompt, /분야를 되묻지 마세요/);
  assert.equal(turn.interpretationBrief.askClarifyingQuestion, false);
}

function testCaseB_CompareYears() {
  const turn = orchestrate({
    userMessage: '2026년과 2027년 비교해줘'
  });
  assert.ok(hasYear(turn, 2026), 'year-2026 must be selected');
  assert.ok(hasYear(turn, 2027), 'year-2027 must be selected');
  assert.deepEqual(
    turn.interpretationBrief.requestedPeriodCoverage.requested.sort(),
    ['year-2026', 'year-2027']
  );
  assert.equal(turn.interpretationBrief.requestedPeriodCoverage.complete, true);
  assert.ok(turn.interpretationBrief.answerPlan.includes('comparison'));
}

function testCaseC_FollowupExpand() {
  const history = [
    { id: 'u1', role: 'user', text: '내년 내 총운 봐줘' }
  ];
  const turn = orchestrate({
    userMessage: '조금 더 자세히 말해줘',
    messageId: 'u2',
    history
  });
  assert.equal(turn.focus.followupMode, 'expand');
  assert.ok(turn.focus.targetYears.includes(2027));
  assert.ok(hasYear(turn, 2027));
  const prompt = buildCounselingTurnPrompt({
    userMessage: '조금 더 자세히 말해줘',
    messageId: 'u2',
    counselingState: {},
    conversationFocus: turn.focus,
    relevantEvidenceText: turn.relevantEvidenceText,
    interpretationBrief: turn.interpretationBrief
  });
  assert.match(prompt, /expand follow-up/);
}

function testCaseD_OverallNoClarification() {
  const history = [
    { id: 'u1', role: 'user', text: '내년 내 총운 봐줘' }
  ];
  const turn = orchestrate({
    userMessage: '전체적인 운을 말해줘',
    messageId: 'u3',
    history
  });
  assert.equal(turn.focus.coverageIntent, 'overall');
  assert.equal(turn.focus.followupMode, 'broaden');
  assert.equal(turn.focus.domain, 'all');
  assert.equal(turn.interpretationBrief.askClarifyingQuestion, false);
  assert.ok(turn.interpretationBrief.answerPlan.includes('career_sweep'));
  const prompt = buildCounselingTurnPrompt({
    userMessage: '전체적인 운을 말해줘',
    messageId: 'u3',
    counselingState: {},
    conversationFocus: turn.focus,
    relevantEvidenceText: turn.relevantEvidenceText,
    interpretationBrief: turn.interpretationBrief
  });
  assert.match(prompt, /분야를 되묻지 마세요/);
  assert.match(COUNSELING_CHAT_SYSTEM, /습관적으로 붙이지 않습니다/);
}

function testCaseE_SuccessNotGuaranteed() {
  const turn = orchestrate({
    userMessage: '2027년에 사업 성공하지?'
  });
  assert.ok(hasYear(turn, 2027) || turn.focus.domain === 'career');
  assert.ok(
    turn.interpretationBrief.forbiddenInferences.some((item) => /성공/.test(item))
  );
  const prompt = buildCounselingTurnPrompt({
    userMessage: '2027년에 사업 성공하지?',
    messageId: 'e1',
    counselingState: {},
    conversationFocus: turn.focus,
    relevantEvidenceText: turn.relevantEvidenceText,
    interpretationBrief: turn.interpretationBrief
  });
  assert.match(prompt, /현실 사건 발생을 보장하지 마세요/);
}

function testCaseF_BreakupNotPredicted() {
  const turn = orchestrate({
    userMessage: '9월에 헤어질까?'
  });
  const prompt = buildCounselingTurnPrompt({
    userMessage: '9월에 헤어질까?',
    messageId: 'f1',
    counselingState: {},
    conversationFocus: turn.focus,
    relevantEvidenceText: turn.relevantEvidenceText,
    interpretationBrief: turn.interpretationBrief
  });
  assert.match(prompt, /현실 사건 발생을 보장하지 마세요/);
  assert.ok(
    turn.interpretationBrief.forbiddenInferences.some((item) => /이별|성공/.test(item))
  );
}

function testCareerKeepsBothYears() {
  const turn = orchestrate({
    userMessage:
      '2026 하반기에 이직, 새 계약, 중요한 프로젝트 중 무엇을 움직여도 되는지와 2027과 비교해줘.'
  });
  assert.equal(turn.focus.domain, 'career');
  assert.ok(hasYear(turn, 2026));
  assert.ok(hasYear(turn, 2027));
}

function testFourTurnProfileFlow() {
  const t1 = orchestrate({ userMessage: '내년 내 총운 봐줘', messageId: 'u1' });
  assert.ok(hasYear(t1, 2027));
  assert.equal(t1.focus.coverageIntent, 'overall');
  assert.ok(t1.interpretationBrief.supportedMeanings.length >= 1);

  const history1 = [{ id: 'u1', role: 'user', text: '내년 내 총운 봐줘' }];
  const t2 = orchestrate({
    userMessage: '조금 더 자세히 말해줘',
    messageId: 'u2',
    history: history1
  });
  assert.equal(t2.focus.followupMode, 'expand');
  assert.ok(hasYear(t2, 2027));

  const history2 = [
    ...history1,
    { id: 'a1', role: 'model', text: '2027년은 역할 주제가 선명합니다.' },
    { id: 'u2', role: 'user', text: '조금 더 자세히 말해줘' }
  ];
  const t3 = orchestrate({
    userMessage: '전체적인 운을 말해줘',
    messageId: 'u3',
    history: history2
  });
  assert.equal(t3.focus.followupMode, 'broaden');
  assert.equal(t3.interpretationBrief.askClarifyingQuestion, false);

  const history3 = [
    ...history2,
    { id: 'a2', role: 'model', text: '일 재물 관계 심신을 훑었습니다.' },
    { id: 'u3', role: 'user', text: '전체적인 운을 말해줘' }
  ];
  const t4 = orchestrate({
    userMessage: '사업운 알려줘',
    messageId: 'u4',
    history: history3
  });
  assert.equal(t4.focus.domain, 'career');
  assert.ok(t4.focus.targetYears.includes(2027));
  assert.ok(hasYear(t4, 2027));
  assert.ok(t4.evidencePacket.evidence.some((item) => item.id === 'natal-domain'));
}

function testDiagnosticAndPromptBudget() {
  const turn = orchestrate({ userMessage: '내년 내 총운 봐줘' });
  const diagnostic = buildCounselingOrchestratorDiagnostic({
    focus: turn.focus,
    evidencePacket: turn.evidencePacket,
    ragRuntime: { status: 'used' },
    exampleRagRuntime: { status: 'skipped' },
    interpretationBrief: turn.interpretationBrief
  });
  assert.equal(diagnostic.interpretationCommitment, INTERPRETATION_COMMITMENT_DEFAULT);
  assert.equal(typeof diagnostic.answerDirectness, 'string');
  assert.equal(diagnostic.requestedPeriodCoverage.complete, true);
  assert.ok(diagnostic.supportedMeaningCount >= 1);
  assert.equal(COUNSELING_CHAT_MAX_OUTPUT_TOKENS, 2800);
  assert.match(COUNSELING_PROMPT_VERSION, /grounded_directness/);
  assert.doesNotMatch(COUNSELING_CHAT_SYSTEM, /사주는 참고 가능한 해석 틀이며/);
  assert.match(COUNSELING_CHAT_SYSTEM, /명리 해석은 선명하게/);

  const prompt = buildCounselingTurnPrompt({
    userMessage: '내년 내 총운 봐줘',
    messageId: 'u1',
    counselingState: {},
    conversationFocus: turn.focus,
    relevantEvidenceText: turn.relevantEvidenceText,
    interpretationBrief: turn.interpretationBrief
  });
  assert.ok(prompt.length < 20000, `turn prompt too large: ${prompt.length}`);
  assert.ok(COUNSELING_CHAT_SYSTEM.length < 6500, `system prompt too large: ${COUNSELING_CHAT_SYSTEM.length}`);
}

function testMonthsRequested() {
  const turn = orchestrate({
    userMessage: '9월과 10월 비교해줘'
  });
  assert.deepEqual(turn.focus.targetMonths.sort((a, b) => a - b), [9, 10]);
}

function main() {
  testCaseA_Year2027Overall();
  testCaseB_CompareYears();
  testCaseC_FollowupExpand();
  testCaseD_OverallNoClarification();
  testCaseE_SuccessNotGuaranteed();
  testCaseF_BreakupNotPredicted();
  testCareerKeepsBothYears();
  testFourTurnProfileFlow();
  testDiagnosticAndPromptBudget();
  testMonthsRequested();
  console.log('testCounselingGroundedDirectness: ok');
}

main();
