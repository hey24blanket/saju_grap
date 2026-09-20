import assert from 'node:assert/strict';

import SajuGrapEngine from '../src/engine/SajuGrapEngine.js';
import { buildCounselingFactContext } from '../lib/counselingFactContext.js';
import { buildCounselingOrchestration, finalizeCounselingOrchestrationAfterRag } from '../lib/counselingOrchestrator.js';
import { buildCounselingKnowledgeRagQuery } from '../lib/counselingKnowledgeRagQuery.js';

function sajuContext(referenceYear = 2026) {
  const engineFacts = SajuGrapEngine.analyze({
    name: '품질 테스트',
    year: 1985,
    month: 10,
    day: 24,
    hour: 11,
    minute: 45,
    gender: 1,
    calendarType: 'solar',
    timezone: 'Asia/Seoul',
    referenceDateTime: `${referenceYear}-09-20T12:00:00+09:00`
  });
  return {
    engineFacts,
    cyclesData: SajuGrapEngine.toLegacyApiData(engineFacts).cyclesData
  };
}

function buildTurn(message) {
  const ctx = sajuContext();
  const factContext = buildCounselingFactContext({
    sajuContext: ctx,
    userMessage: message,
    history: [],
    selectedDomain: '총운'
  });
  return {
    ctx,
    factContext,
    turn: buildCounselingOrchestration({
      userMessage: message,
      messageId: 'u1',
      history: [],
      sajuContext: ctx,
      counselingFactContext: factContext,
      selectedDomain: '총운'
    })
  };
}

function main() {
  const { ctx, turn } = buildTurn('내년 재물운은?');

  assert.equal(turn.focus.domain, 'wealth');
  assert.ok(turn.focus.targetYears.includes(2027));
  assert.equal(turn.interpretationBrief.responseMode, 'reading');
  assert.ok(
    turn.interpretationBrief.questionCoverage.some((q) => q.topicId === 'wealth_timing'),
    'short wealth reading must not collapse to general'
  );

  const planIds = turn.interpretationBrief.evidenceUsePlan.items.map((item) => item.evidenceId);
  assert.ok(planIds.includes('natal-domain'), 'wealth reading must carry domain natal evidence');
  assert.ok(planIds.includes('daewoon-current'), 'wealth reading must carry current daewoon');
  assert.ok(planIds.some((id) => id === 'year-2027' || id.startsWith('year-2027')), 'requested 2027 evidence must be used');
  assert.ok(turn.interpretationBrief.evidenceUsePlan.minUseCount >= 2);

  assert.equal(
    turn.interpretationBrief.answerContract.includeEventBoundary,
    false,
    'plain fortune reading should not force a disclaimer'
  );

  const ragQuery = buildCounselingKnowledgeRagQuery({
    userMessage: '내년 재물운은?',
    history: [],
    focus: turn.focus,
    evidencePacket: turn.evidencePacket,
    sajuContext: ctx
  });
  assert.match(ragQuery, /natalGroup:/);
  assert.match(ragQuery, /natalTenGodGroup:/);

  const finalized = finalizeCounselingOrchestrationAfterRag({
    orchestration: turn,
    userMessage: '내년 재물운은?',
    knowledgeHits: [{ id: 'chunk-wealth-1', title: '재성·비겁·식상 해석' }],
    knowledgeRagUsed: true
  });
  assert.equal(finalized.interpretationBrief.responseMode, 'reading');
  assert.ok(
    finalized.interpretationBrief.supportedMeanings.some((item) =>
      item.supportRagIds.includes('chunk-wealth-1')
    ),
    'final brief must be rebuilt after RAG'
  );

  const risky = buildTurn('내년에 사업 성공하지?').turn;
  assert.equal(risky.interpretationBrief.answerContract.includeEventBoundary, true);

  console.log('testCounselingReadingQuality: ok');
}

main();
