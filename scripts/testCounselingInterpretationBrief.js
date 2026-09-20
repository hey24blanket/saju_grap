import assert from 'node:assert/strict';

import SajuGrapEngine from '../src/engine/SajuGrapEngine.js';
import {
  compactRelation,
  compactCycle,
  buildCounselingFactContext
} from '../lib/counselingFactContext.js';
import {
  selectRelevantSajuEvidence,
  pickDomainNatalEvidence,
  pickOverallNatalEvidence,
  scoreCanonicalTimingSalience,
  inferCanonicalTimingDirection
} from '../lib/counselingEvidenceSelector.js';
import {
  buildCounselingInterpretationBrief,
  analyzeQuestionCoverage,
  summarizeInterpretationBrief,
  formatInterpretationBriefForPrompt
} from '../lib/counselingInterpretationBrief.js';
import {
  buildCounselingOrchestration,
  buildCounselingOrchestratorDiagnostic
} from '../lib/counselingOrchestrator.js';
import { buildCounselingTurnPrompt } from '../lib/counselingPrompt.js';

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

// ---------------------------------------------------------------------------
// Section 2 — information loss fix: relation members/positions are preserved.
// ---------------------------------------------------------------------------
function testCompactRelationPreservesMembers() {
  const compact = compactRelation({
    relationType: 'branch_harm',
    complete: true,
    members: [
      { position: 'cycle_branch', value: '午' },
      { position: 'natal_day_branch', value: '申' }
    ],
    transformation: { status: 'none', targetElement: null }
  });
  assert.equal(compact.type, 'branch_harm');
  assert.ok(Array.isArray(compact.members));
  assert.equal(compact.members.length, 2);
  assert.deepEqual(compact.members[0], { position: 'cycle_branch', value: '午' });
  assert.ok(
    compact.members.some((m) => m.position === 'natal_day_branch'),
    'day-branch position must survive into counseling evidence'
  );

  // Real engine cycle relations must carry positional members through compaction.
  const { engineFacts } = analyzeFixture(2026);
  const currentDaewoon = (engineFacts.cycles.daewoon || []).find(
    (cycle) => cycle.startYear <= 2026 && cycle.endYear >= 2026
  );
  const compactDaewoon = compactCycle(currentDaewoon, 'daewoon');
  const relation = (compactDaewoon.relationsWithNatal || [])[0];
  assert.ok(relation, 'daewoon should expose at least one relation');
  assert.ok(
    Array.isArray(relation.members) && relation.members.length >= 1,
    'cycle relationsWithNatal must keep member positions after fix'
  );
  assert.ok(
    relation.members.every((m) => typeof m.position === 'string'),
    'each preserved member should carry a chart position'
  );
}

// ---------------------------------------------------------------------------
// Section 3 — domain-specific natal evidence.
// ---------------------------------------------------------------------------
function testDomainNatalEvidenceRomance() {
  const { engineFacts } = analyzeFixture(2026);
  const facts = pickDomainNatalEvidence(engineFacts, 'romance');
  assert.ok(facts, 'romance should produce domain natal evidence');
  assert.equal(facts.dayBranch, engineFacts.natal.day.branch);
  assert.equal(facts.dayPillar, engineFacts.natal.day.ganzhi);
  assert.ok(facts.relationStarGroup, 'male romance should surface wealth spouse-star group');
  assert.equal(facts.relationStarGroup.group, 'wealth');
  assert.ok(
    facts.detectedStars.some((s) => s.starId === 'PEACH_BLOSSOM'),
    'detected 도화 must be surfaced for romance'
  );
  assert.ok(
    facts.tenGodPositions.length > 0,
    'relation-relevant ten-god positions must be surfaced'
  );
}

function testDomainNatalEvidenceCareerWealth() {
  const { engineFacts } = analyzeFixture(2026);
  const career = pickDomainNatalEvidence(engineFacts, 'career');
  assert.ok(career);
  assert.ok(career.relevantGroups.some((g) => g.group === 'officer'));
  assert.ok(career.tenGodPositions.length > 0);
  // career is not a relationship domain — no day-branch labeling.
  assert.equal(career.dayBranch, undefined);

  const wealth = pickDomainNatalEvidence(engineFacts, 'wealth');
  assert.ok(wealth);
  assert.ok(wealth.relevantGroups.some((g) => g.group === 'wealth'));

  // domain 'all' surfaces no extra domain item.
  assert.equal(pickDomainNatalEvidence(engineFacts, 'all'), null);
  const overall = pickOverallNatalEvidence(engineFacts);
  assert.ok(overall);
  assert.ok(overall.dayBranch);
  assert.ok(overall.relevantGroups.length >= 3);
}

function testEvidenceSelectorStillNoInterpretation() {
  const sajuContext = analyzeFixture(2026);
  const packet = selectRelevantSajuEvidence({
    engineFacts: sajuContext.engineFacts,
    focus: { domain: 'romance', task: 'timing', targetYears: [2026, 2027] },
    counselingFactContext: buildCounselingFactContext({
      sajuContext,
      userMessage: '배우자 기운이 언제 들어올까?',
      history: [],
      selectedDomain: '총운'
    })
  });
  const serialized = JSON.stringify(packet);
  assert.doesNotMatch(serialized, /풀린다|좋다|나쁘다|들어온다/u);
  assert.doesNotMatch(serialized, /relativelyStronger|waveProjection/u);
  // domain natal item is present for romance.
  assert.ok(packet.evidence.some((e) => e.id === 'natal-domain'));
  assert.ok(packet.evidence.some((e) => e.id === 'natal-core'));
}

// ---------------------------------------------------------------------------
// Section 4 — domain-specific timing salience (salience != direction).
// ---------------------------------------------------------------------------
function testDomainTimingSalience() {
  const romanceFacts = {
    ganzhi: '甲子',
    tenGod: { group: 'officer' },
    twelveStage: { stage: '장생' },
    relationsWithNatal: [
      { type: 'clash', members: [{ position: 'natal_day_branch', value: '申' }] }
    ],
    balanceImpact: { effect: 'neutral' }
  };
  const romance = scoreCanonicalTimingSalience(romanceFacts, 'romance');
  assert.ok(romance.signals.includes('tenGod:romance'));
  assert.ok(romance.signals.includes('relationOnDayBranch'));
  assert.ok(romance.score >= 3);

  // Direction still depends ONLY on balanceImpact, never on salience.
  assert.equal(inferCanonicalTimingDirection(romanceFacts).value, 'unknown');
  assert.equal(
    inferCanonicalTimingDirection({ balanceImpact: { effect: 'relieves' } }).value,
    'supportive'
  );

  // Wealth salience path is unchanged (regression guard).
  const wealth = scoreCanonicalTimingSalience(
    { ganzhi: '甲子', tenGod: { group: 'wealth' }, twelveStage: { stage: '장생' } },
    'wealth'
  );
  assert.ok(wealth.signals.includes('tenGodWealth'));
}

// ---------------------------------------------------------------------------
// Section 5/6/13 — Interpretation Brief shape and constraints.
// ---------------------------------------------------------------------------
function testInterpretationBriefShape() {
  const orchestration = orchestrate({
    userMessage: '올해 돈이 언제 풀리고 왜 그렇게 보는지 알려줘.'
  });
  const brief = orchestration.interpretationBrief;
  assert.equal(brief.schemaVersion, 'counseling_interpretation_brief_v1');
  assert.ok(Array.isArray(brief.questionCoverage));
  assert.ok(Array.isArray(brief.selectedEvidence));
  assert.ok(brief.selectedEvidence.every((e) => e.evidenceId && e.source === 'engine'));
  assert.ok(Array.isArray(brief.supportedMeanings));
  assert.ok(
    brief.supportedMeanings.every(
      (item) =>
        item.statement &&
        Array.isArray(item.supportEvidenceIds) &&
        item.supportEvidenceIds.length > 0
    )
  );
  assert.ok(Array.isArray(brief.forbiddenInferences) && brief.forbiddenInferences.length > 0);
  assert.ok(brief.answerPlan.includes('direct_answer'));

  const summary = summarizeInterpretationBrief(brief);
  assert.equal(summary.questionCount, brief.questionCoverage.length);
  assert.equal(typeof summary.answerableCount, 'number');
  assert.ok(Array.isArray(summary.evidenceIds));
}

// ---------------------------------------------------------------------------
// Section 14 — CASE A..E.
// ---------------------------------------------------------------------------
function testCaseA_SimpleFactualNoDecomposition() {
  const orchestration = orchestrate({
    userMessage: '내 사주에서 재성이 강한 편이야?'
  });
  const brief = orchestration.interpretationBrief;
  assert.equal(brief.questionCoverage.length, 1, 'simple factual must not be decomposed');
  assert.equal(brief.questionCoverage[0].status, 'answerable');
  assert.ok(orchestration.evidencePacket.evidence.some((e) => e.scope === 'natal'));
  assert.ok(brief.answerPlan[0] === 'direct_answer');
}

function testCaseB_RomanceDeepMultiQuestion() {
  const message =
    '현재 만나는 인연과의 관계가 앞으로 어떻게 발전할지, ' +
    '새로운 인연이나 귀인이 들어오는 시기가 언제인지, ' +
    '배우자 기운, 상대를 고를 때 중요한 점, ' +
    '갈등 시기와 대응법을 알려줘.';
  const orchestration = orchestrate({ userMessage: message });
  assert.equal(orchestration.focus.domain, 'romance');
  const brief = orchestration.interpretationBrief;

  assert.ok(brief.questionCoverage.length >= 4, 'multiple sub-questions must be detected');
  const topicIds = brief.questionCoverage.map((q) => q.topicId);
  assert.ok(topicIds.includes('spouse_pattern'));
  assert.ok(topicIds.includes('partner_selection'));

  // every sub-question is explicitly classified (never silently dropped).
  assert.ok(
    brief.questionCoverage.every((q) =>
      ['answerable', 'insufficient_evidence', 'needs_reality_input'].includes(q.status)
    )
  );
  // at least one answerable (natal spouse pattern) so we do not retreat wholesale.
  assert.ok(brief.questionCoverage.some((q) => q.status === 'answerable'));
  // partner selection depends on real-world input.
  const partner = brief.questionCoverage.find((q) => q.topicId === 'partner_selection');
  assert.equal(partner.status, 'needs_reality_input');

  // romance-specific evidence: day branch + relevant stars preserved.
  const domainItem = orchestration.evidencePacket.evidence.find(
    (e) => e.id === 'natal-domain'
  );
  assert.ok(domainItem && domainItem.facts.dayBranch);

  // no unsupported future certainty: new-relationship precise timing is insufficient.
  const newTiming = brief.questionCoverage.find(
    (q) => q.topicId === 'new_relationship_timing'
  );
  if (newTiming) {
    assert.equal(newTiming.status, 'insufficient_evidence');
  }
}

function testCaseC_CareerActionsNotMerged() {
  const message =
    '2026 하반기에 이직, 새 계약, 중요한 프로젝트 중 무엇을 움직여도 되는지와 2027과 비교해줘.';
  const orchestration = orchestrate({ userMessage: message });
  assert.equal(orchestration.focus.domain, 'career');
  const topicIds = orchestration.interpretationBrief.questionCoverage.map(
    (q) => q.topicId
  );
  // 이직 / 계약 / 프로젝트 must NOT be collapsed into a single problem.
  assert.ok(topicIds.includes('move_job'));
  assert.ok(topicIds.includes('new_contract'));
  assert.ok(topicIds.includes('project'));
  // comparison across years is planned.
  assert.ok(orchestration.interpretationBrief.answerPlan.includes('comparison'));
}

function testCaseD_WealthTimingAndReason() {
  const orchestration = orchestrate({
    userMessage: '올해 돈이 언제 풀리고 왜 그렇게 보는지 알려줘.'
  });
  assert.equal(orchestration.focus.domain, 'wealth');
  const topicIds = orchestration.interpretationBrief.questionCoverage.map(
    (q) => q.topicId
  );
  assert.ok(topicIds.includes('wealth_timing'));
  assert.ok(topicIds.includes('wealth_reason'));
  assert.ok(orchestration.evidencePacket.evidence.some((e) => e.scope === 'natal'));
}

function testCaseE_InsufficientEvidenceKeepsPartialAnswer() {
  // Synthetic romance turn where no supportive month direction exists.
  const coverage = analyzeQuestionCoverage({
    userMessage:
      '새로운 인연이 들어오는 특정 월이 언제인지, 그리고 제 배우자 기운은 어떤지 알려줘.',
    focus: { domain: 'romance', task: 'timing', inherited: false },
    evidencePacket: {
      task: 'timing',
      timingMonthDirectional: false,
      timingYearDirectional: false,
      timingFallbackLevel: 'undifferentiated',
      evidence: [{ scope: 'natal', id: 'natal-core' }, { scope: 'daewoon', id: 'd' }]
    }
  });
  const newTiming = coverage.find((q) => q.topicId === 'new_relationship_timing');
  const spouse = coverage.find((q) => q.topicId === 'spouse_pattern');
  assert.ok(newTiming && newTiming.status === 'insufficient_evidence');
  assert.ok(spouse && spouse.status === 'answerable');

  const brief = buildCounselingInterpretationBrief({
    userMessage:
      '새로운 인연이 들어오는 특정 월이 언제인지, 그리고 제 배우자 기운은 어떤지 알려줘.',
    focus: { domain: 'romance', task: 'timing', inherited: false },
    evidencePacket: {
      task: 'timing',
      timingMonthDirectional: false,
      timingYearDirectional: false,
      timingFallbackLevel: 'undifferentiated',
      evidence: [{ scope: 'natal', id: 'natal-core' }, { scope: 'daewoon', id: 'd' }]
    }
  });
  assert.ok(brief.insufficientAreas.length > 0, 'insufficient areas must be named');
  // partial answer still possible: at least one answerable topic + direct answer plan.
  assert.ok(brief.questionCoverage.some((q) => q.status === 'answerable'));
  assert.equal(brief.answerPlan[0], 'direct_answer');
}

// ---------------------------------------------------------------------------
// Section 11/13 — prompt wiring (dynamic domain, brief block, diagnostics).
// ---------------------------------------------------------------------------
function testPromptIncludesBriefAndDynamicDomain() {
  const orchestration = orchestrate({
    userMessage:
      '현재 만나는 인연과의 관계가 앞으로 어떻게 발전할지, 배우자 기운, 상대를 고를 때 중요한 점을 알려줘.'
  });
  const prompt = buildCounselingTurnPrompt({
    userMessage: 'x',
    messageId: 'b1',
    counselingState: {},
    conversationFocus: orchestration.focus,
    relevantEvidenceText: orchestration.relevantEvidenceText,
    interpretationBrief: orchestration.interpretationBrief
  });
  assert.match(prompt, /\[INTERPRETATION BRIEF/);
  assert.match(prompt, /questionCoverage/);

  // correction frame uses the dynamic focus domain label, not a hardcoded one.
  const romanceCorrection = buildCounselingTurnPrompt({
    userMessage: '내가 그런 얘기 한 적 없는데?',
    messageId: 'c1',
    counselingState: {},
    conversationFocus: { domain: 'romance', task: 'correction', inherited: false },
    correctionAudit: {
      challengedTerms: ['이별'],
      priorAssistantMatch: false,
      matchedAssistantMessageIds: []
    }
  });
  assert.match(romanceCorrection, /현재 연애 상담 주제로/);
  assert.doesNotMatch(romanceCorrection, /현재 wealth 상담 주제로/);
  assert.doesNotMatch(romanceCorrection, /현재 재물 상담 주제로/);
}

function testDiagnosticIncludesBrief() {
  const orchestration = orchestrate({
    userMessage: '올해 돈이 언제 풀리고 왜 그렇게 보는지 알려줘.'
  });
  const diagnostic = buildCounselingOrchestratorDiagnostic({
    focus: orchestration.focus,
    evidencePacket: orchestration.evidencePacket,
    ragRuntime: { status: 'used' },
    exampleRagRuntime: { status: 'no_relevant_results' },
    interpretationBrief: orchestration.interpretationBrief,
    includeRawInterpretationBrief: false
  });
  assert.ok(diagnostic.interpretationBrief, 'diagnostic must summarize the brief');
  assert.equal(typeof diagnostic.interpretationBrief.questionCount, 'number');
  assert.equal(typeof diagnostic.interpretationBrief.answerableCount, 'number');
  assert.ok(Array.isArray(diagnostic.interpretationBrief.evidenceIds));
  // raw brief withheld unless training trace is enabled.
  assert.equal(diagnostic.interpretationBriefRaw, undefined);

  const withRaw = buildCounselingOrchestratorDiagnostic({
    focus: orchestration.focus,
    evidencePacket: orchestration.evidencePacket,
    ragRuntime: { status: 'used' },
    exampleRagRuntime: { status: 'no_relevant_results' },
    interpretationBrief: orchestration.interpretationBrief,
    includeRawInterpretationBrief: true
  });
  assert.ok(withRaw.interpretationBriefRaw);
  assert.equal(
    withRaw.interpretationBriefRaw.schemaVersion,
    'counseling_interpretation_brief_v1'
  );
}

function main() {
  testCompactRelationPreservesMembers();
  testDomainNatalEvidenceRomance();
  testDomainNatalEvidenceCareerWealth();
  testEvidenceSelectorStillNoInterpretation();
  testDomainTimingSalience();
  testInterpretationBriefShape();
  testCaseA_SimpleFactualNoDecomposition();
  testCaseB_RomanceDeepMultiQuestion();
  testCaseC_CareerActionsNotMerged();
  testCaseD_WealthTimingAndReason();
  testCaseE_InsufficientEvidenceKeepsPartialAnswer();
  testPromptIncludesBriefAndDynamicDomain();
  testDiagnosticIncludesBrief();
  console.log('testCounselingInterpretationBrief: ok');
}

main();
