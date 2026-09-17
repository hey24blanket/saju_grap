import assert from 'node:assert/strict';

import SajuGrapEngine from '../src/engine/SajuGrapEngine.js';
import {
  buildCounselingConversationFocus
} from '../lib/counselingConversationFocus.js';
import {
  selectRelevantSajuEvidence,
  buildRelativeWindowRankingHints
} from '../lib/counselingEvidenceSelector.js';
import {
  buildCounselingKnowledgeRagQuery
} from '../lib/counselingKnowledgeRagQuery.js';
import {
  buildCounselingOrchestration,
  buildCounselingOrchestratorDiagnostic
} from '../lib/counselingOrchestrator.js';
import {
  buildCounselingFactContext
} from '../lib/counselingFactContext.js';
import {
  buildCounselingExampleContext,
  COUNSELING_EXAMPLE_SCHEMA_VERSION_V2
} from '../lib/counselingExampleStore.js';
import {
  buildCounselingTurnPrompt
} from '../lib/counselingPrompt.js';
import {
  executeCounselingExampleRag
} from '../lib/counselingExampleChatRag.js';

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
  return {
    engineFacts: facts,
    cyclesData: SajuGrapEngine.toLegacyApiData(facts).cyclesData
  };
}

function orchestrateTurn({
  userMessage,
  messageId,
  history = [],
  referenceYear = 2026
}) {
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

function testAcceptanceFlowWealthTimingFollowUps() {
  const turn1 = orchestrateTurn({
    userMessage: '내 금전운은 언제 좀 풀릴까요?',
    messageId: 'u1',
    history: []
  });
  assert.equal(turn1.focus.domain, 'wealth');
  assert.equal(turn1.focus.task, 'timing');
  assert.equal(turn1.focus.inherited, false);
  assert.ok(turn1.evidencePacket.evidence.length >= 2);
  assert.ok(
    turn1.evidencePacket.evidence.some((item) => item.scope === 'year' || item.scope === 'month'),
    'timing should include canonical cycle evidence slices'
  );

  const historyAfter1 = [
    { id: 'u1', role: 'user', text: '내 금전운은 언제 좀 풀릴까요?' }
  ];

  const turn2 = orchestrateTurn({
    userMessage: '그렇게 보는 명리적인 이유는 뭐야?',
    messageId: 'u2',
    history: historyAfter1
  });
  assert.equal(turn2.focus.domain, 'wealth');
  assert.equal(turn2.focus.task, 'explanation');
  assert.equal(turn2.focus.inherited, true);
  assert.ok(turn2.evidencePacket.evidence.length >= 2);

  const historyAfter2 = [
    ...historyAfter1,
    { id: 'a1', role: 'model', text: '2026년 10~11월이 상대적으로 완화됩니다.' },
    { id: 'u2', role: 'user', text: '그렇게 보는 명리적인 이유는 뭐야?' }
  ];

  const turn3 = orchestrateTurn({
    userMessage: '그럼 현실에서는 뭘 먼저 확인해야 해?',
    messageId: 'u3',
    history: historyAfter2
  });
  assert.equal(turn3.focus.domain, 'wealth');
  assert.equal(turn3.focus.task, 'reality_bridge');
  assert.equal(turn3.focus.inherited, true);

  const realityPrompt = buildCounselingTurnPrompt({
    userMessage: turn3.focus ? '그럼 현실에서는 뭘 먼저 확인해야 해?' : '',
    messageId: 'u3',
    counselingState: {},
    conversationFocus: turn3.focus,
    relevantEvidenceText: turn3.relevantEvidenceText,
    timingGrounded: turn3.timingGrounded
  });
  assert.match(realityPrompt, /\[RELEVANT SAJU EVIDENCE\]/);
  assert.match(realityPrompt, /일반 자기계발 체크리스트만으로 답하지 마세요/);
}

function testAcceptanceCorrectionTask() {
  const focus = buildCounselingConversationFocus({
    userMessage: '내가 그런 정산 문제 있다고 말한 적 없는데?',
    messageId: 'u4',
    history: [
      { id: 'u1', role: 'user', text: '내 금전운은 언제 풀릴까요?' }
    ]
  });
  assert.equal(focus.task, 'correction');
  assert.equal(focus.domain, 'wealth');
}

function testAcceptanceRealityBridgeColdStart() {
  const turn = orchestrateTurn({
    userMessage: '그럼 지금 현실에서는 뭘 먼저 확인해야 해?',
    messageId: 'u-only',
    history: []
  });
  assert.equal(turn.focus.domain, 'all');
  assert.equal(turn.focus.task, 'reality_bridge');
  assert.equal(turn.focus.inherited, false);
  assert.ok(turn.evidencePacket.evidence.some((item) => item.scope === 'natal'));
  assert.ok(turn.evidencePacket.evidence.some((item) => item.scope === 'daewoon'));
}

function testKnowledgeRagQueryUsesFocusAndEvidence() {
  const orchestration = orchestrateTurn({
    userMessage: '내 금전운은 언제 좀 풀릴까요?',
    messageId: 'u1',
    history: []
  });
  const query = buildCounselingKnowledgeRagQuery({
    userMessage: '내 금전운은 언제 좀 풀릴까요?',
    history: [],
    focus: orchestration.focus,
    evidencePacket: orchestration.evidencePacket,
    sajuContext: analyzeFixture(2026)
  });
  assert.match(query, /focus domain=wealth task=timing/);
  assert.match(query, /knowledgeDomain=wealth/);
  assert.match(query, /question:/);
  assert.doesNotMatch(query, /합성 평가 사용자/);
}

function testExampleStrategyOnlyContext() {
  const mockExample = {
    exampleId: 'ex.v2.1',
    schemaVersion: COUNSELING_EXAMPLE_SCHEMA_VERSION_V2,
    domain: 'wealth',
    scenarioTitle: '정산 지연',
    arcType: 'constraint_first',
    plotPhases: ['opening'],
    strategy: {
      counselingGoal: '현실 조건 확인',
      counselingArc: { start: 'opening', development: 'deepen' },
      turnGuidance: [{
        plotPhase: 'opening',
        counselingGoal: ['현실 조건 확인'],
        interpretationBridge: ['Engine Fact는 현재 사용자 것만'],
        forbiddenInference: ['예시의 가상 수입을 현재 사용자 사실로']
      }]
    },
    turns: [
      { user: '예시 사용자 질문', assistant: '2026년 10월 입금 예시', plotPhase: 'opening' }
    ]
  };
  const context = buildCounselingExampleContext([mockExample], {
    maxExamples: 1,
    strategyOnly: true
  });
  assert.match(context, /COUNSELING STRATEGY EXAMPLE/);
  assert.match(context, /Strategy only/);
  assert.doesNotMatch(context, /EXAMPLE DIALOGUE/);
  assert.doesNotMatch(context, /ASSISTANT EXAMPLE/);
  assert.doesNotMatch(context, /2026년 10월 입금/);
}

async function testExampleRagLiveStrategyOnly() {
  const used = await executeCounselingExampleRag({
    needed: true,
    query: 'wealth timing',
    search: async () => ({
      preferredSchema: COUNSELING_EXAMPLE_SCHEMA_VERSION_V2,
      results: [{
        exampleId: 'mock',
        schemaVersion: COUNSELING_EXAMPLE_SCHEMA_VERSION_V2,
        domain: 'wealth',
        scenarioTitle: 'mock',
        arcType: 'test',
        plotPhases: [],
        strategy: {
          turnGuidance: [{
            plotPhase: 'a',
            counselingGoal: ['goal'],
            interpretationBridge: [],
            forbiddenInference: []
          }]
        },
        turns: [{ user: 'u1', assistant: 'a1', plotPhase: 'a' }]
      }]
    })
  });
  assert.equal(used.status, 'used');
  assert.match(used.contextText, /COUNSELING STRATEGY EXAMPLE/);
  assert.doesNotMatch(used.contextText, /ASSISTANT EXAMPLE/);
}

function testOrchestratorDiagnosticShape() {
  const orchestration = orchestrateTurn({
    userMessage: '내 금전운은 언제 좀 풀릴까요?',
    messageId: 'u1',
    history: []
  });
  const diagnostic = buildCounselingOrchestratorDiagnostic({
    focus: orchestration.focus,
    evidencePacket: orchestration.evidencePacket,
    ragRuntime: { status: 'used' },
    exampleRagRuntime: { status: 'no_relevant_results' }
  });
  assert.equal(diagnostic.focus.domain, 'wealth');
  assert.equal(diagnostic.focus.task, 'timing');
  assert.ok(diagnostic.evidenceCount >= 2);
  assert.equal(diagnostic.knowledgeRagUsed, true);
  assert.equal(diagnostic.exampleStrategyUsed, false);
  assert.equal(typeof diagnostic.timingGrounded, 'boolean');
}

function testTimingPeriodSelectionUsesCanonicalExplainability() {
  const sajuContext = analyzeFixture(2026);
  const counselingFactContext = buildCounselingFactContext({
    sajuContext,
    userMessage: '내 금전운은 언제 좀 풀릴까요?',
    history: [],
    selectedDomain: '총운'
  });

  const packet = selectRelevantSajuEvidence({
    engineFacts: sajuContext.engineFacts,
    focus: {
      domain: 'wealth',
      task: 'timing',
      targetYears: [2026, 2027],
      inherited: false
    },
    counselingFactContext
  });

  const monthHighlights = packet.evidence.filter(
    (item) => item.scope === 'month' && item.selectionRole === 'highlight'
  );
  for (const item of monthHighlights) {
    assert.ok(item.explainability?.canonicalEngineFact);
    assert.ok(item.explainability?.score >= 2);
    assert.ok(Array.isArray(item.explainability?.signals));
  }

  if (packet.timingMonthGrounded) {
    assert.ok(monthHighlights.length > 0);
  } else {
    assert.equal(monthHighlights.length, 0);
  }

  const relativeOnly = JSON.stringify(packet);
  assert.doesNotMatch(relativeOnly, /relativelyStronger/u);
  assert.doesNotMatch(relativeOnly, /waveProjection/u);
}

function testRelativeWindowsAreRankingHintsOnly() {
  const sajuContext = analyzeFixture(2026);
  const counselingFactContext = buildCounselingFactContext({
    sajuContext,
    userMessage: '내 금전운은 언제 좀 풀릴까요?',
    history: [],
    selectedDomain: '총운'
  });
  const hints = buildRelativeWindowRankingHints(
    counselingFactContext.timeline?.relativeWindows,
    {
      targetYears: [2026, 2027],
      referenceYear: 2026,
      referenceMonth: 9
    }
  );
  assert.equal(hints.canonicalEngineFact, false);
  assert.ok(hints.monthRank.size >= 0);
}

function testEvidenceSelectorDoesNotInterpret() {
  const sajuContext = analyzeFixture(2026);
  const packet = selectRelevantSajuEvidence({
    engineFacts: sajuContext.engineFacts,
    focus: { domain: 'wealth', task: 'timing', targetYears: [2026, 2027] },
    counselingFactContext: buildCounselingFactContext({
      sajuContext,
      userMessage: '내 금전운은 언제 풀릴까요?',
      history: [],
      selectedDomain: '총운'
    })
  });
  const serialized = JSON.stringify(packet);
  assert.doesNotMatch(serialized, /풀린다|좋다|나쁘다|들어온다/u);
}

async function main() {
  testAcceptanceFlowWealthTimingFollowUps();
  testAcceptanceCorrectionTask();
  testAcceptanceRealityBridgeColdStart();
  testKnowledgeRagQueryUsesFocusAndEvidence();
  testExampleStrategyOnlyContext();
  await testExampleRagLiveStrategyOnly();
  testOrchestratorDiagnosticShape();
  testTimingPeriodSelectionUsesCanonicalExplainability();
  testRelativeWindowsAreRankingHintsOnly();
  testEvidenceSelectorDoesNotInterpret();
  console.log('testCounselingOrchestratorAcceptance: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
