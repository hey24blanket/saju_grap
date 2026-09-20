// counselingInterpretationBrief.js
// -----------------------------------------------------------------------------
// Interpretation Brief v1 — a TRANSIENT per-turn "editing work desk".
//
// It is NOT persistent state and is NOT an inference engine. It only:
//   - classifies the user's turn into sub-questions (question coverage),
//   - maps already-selected Engine Fact evidence to those questions,
//   - marks which areas are insufficient,
//   - lists forbidden inferences,
//   - proposes an answer plan (ordering hint).
//
// It MUST NOT create new myeongri Facts, invent reality events, estimate other
// people's minds, or re-run 합충/십신. Meaning is produced by the model using
// Engine Facts + Knowledge RAG; the Brief only organizes what already exists.
// -----------------------------------------------------------------------------

import {
  INTERPRETATION_COMMITMENT_DEFAULT,
  buildRequestedPeriodCoverage,
  resolveInterpretationStrength,
  answerDirectnessLabel,
  shouldAskClarifyingQuestion,
  buildSupportedMeanings,
  buildEvidenceUsePlan,
  detectResponseMode,
  buildAnswerContract
} from './counselingInterpretationPolicy.js';

export const COUNSELING_INTERPRETATION_BRIEF_VERSION =
  'counseling_interpretation_brief_v1';

const MAX_SUB_QUESTIONS = 8;

const STATUS = Object.freeze({
  ANSWERABLE: 'answerable',
  INSUFFICIENT: 'insufficient_evidence',
  NEEDS_REALITY: 'needs_reality_input'
});

function cleanText(value, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function isSingleFactualSajuQuestion(text) {
  const raw = cleanText(text, 2000);
  if (!raw) return false;
  const factual =
    /(재성|재물|십신|용신|기신|일간|오행|원국|관성|비겁|식상|인성|신강|신약|편재|정재|편관|정관)/u.test(
      raw
    ) && /(강|약|많|적|어떤|뭐|편|있|없|인가|일까)/u.test(raw);
  const enumerated =
    /(그리고|또|,|、|·|\n)/u.test(raw) ||
    (raw.match(/[?？]/gu) || []).length > 1;
  return factual && !enumerated && raw.length <= 60;
}

// Domain-specific sub-topic taxonomy. Kept intentionally small (section 7:
// "정확한 taxonomy는 최소한으로"). `kind` decides how status is resolved.
//   kind: 'natal'          → answerable when natal evidence exists
//         'timing_precise' → needs supportive month/year direction
//         'timing_broad'   → answerable when any cycle evidence exists
//         'explanation'    → answerable when natal or cycle evidence exists
//         'reality'        → needs_reality_input (depends on real-world facts)
const SUBTOPICS = Object.freeze({
  romance: [
    {
      id: 'current_relationship',
      kind: 'reality',
      pattern:
        /(현재\s*만나|만나는\s*(?:인연|사람|상대)|지금\s*(?:만나|사귀|연애)|관계가\s*앞으로|어떻게\s*발전|발전할지)/u
    },
    {
      id: 'new_relationship_timing',
      kind: 'timing_precise',
      pattern:
        /(새로운\s*(?:인연|사람)|새\s*인연|귀인(?:이|가)?\s*(?:들어|오|생)|인연이\s*(?:들어|생)|들어오는\s*시기)/u
    },
    {
      id: 'spouse_pattern',
      kind: 'natal',
      pattern: /(배우자|결혼운|혼인|배필|연애운의?\s*특징|연애\s*스타일)/u
    },
    {
      id: 'partner_selection',
      kind: 'reality',
      pattern:
        /(상대(?:방)?를?\s*(?:고를|선택|볼\s*때)|어떤\s*사람|중요하게\s*(?:고려|볼|봐야)|관계를\s*유지)/u
    },
    {
      id: 'conflict_timing',
      kind: 'timing_broad',
      pattern: /(갈등|다툼|싸움|충돌).{0,8}(?:시기|때|쉬운|잦|생기)/u
    },
    {
      id: 'conflict_strategy',
      kind: 'reality',
      pattern: /(극복|대응|지혜롭게|해결|풀어가|헤쳐)/u
    }
  ],
  career: [
    {
      id: 'overall_flow',
      kind: 'timing_broad',
      pattern:
        /(전체적으로|일과\s*사업\s*운|사업\s*운이|일\s*운이|어떻게\s*흘러|흐름이\s*어)/u
    },
    { id: 'move_job', kind: 'timing_broad', pattern: /(이직|퇴사)/u },
    { id: 'new_contract', kind: 'timing_broad', pattern: /(새\s*계약|계약)/u },
    { id: 'project', kind: 'timing_broad', pattern: /(프로젝트)/u },
    {
      id: 'compare_years',
      kind: 'timing_broad',
      pattern: /(비교|올해.*내년|내년.*올해|하반기|상반기|내실|기약)/u
    },
    {
      id: 'caution_points',
      kind: 'reality',
      pattern: /(주의|대인관계|마인드셋|보완|부족한\s*기운|조심)/u
    }
  ],
  wealth: [
    {
      id: 'wealth_timing',
      kind: 'timing_broad',
      pattern: /(언제|시기|풀리|풀릴|나아|자금|현금|돈이|재물운|금전운|올해|내년|내후년)/u
    },
    {
      id: 'wealth_reason',
      kind: 'explanation',
      pattern: /(왜|이유|명리(?:적)?|어떻게\s*그렇게|근거)/u
    }
  ],
  relationships: [
    {
      id: 'relationship_pattern',
      kind: 'natal',
      pattern: /(사람\s*관계|대인관계|인간관계|관계가\s*꼬|사람들과)/u
    },
    { id: 'relationship_reason', kind: 'explanation', pattern: /(왜|이유|근거|명리)/u },
    { id: 'relationship_action', kind: 'reality', pattern: /(어떻게|대응|풀어|해결|대처)/u }
  ]
});

function hasScope(evidencePacket, scopes) {
  const list = Array.isArray(evidencePacket?.evidence)
    ? evidencePacket.evidence
    : [];
  return list.some((item) => scopes.includes(item?.scope));
}

function resolveStatus(kind, evidencePacket) {
  const hasNatal = hasScope(evidencePacket, ['natal']);
  const hasCycle = hasScope(evidencePacket, ['daewoon', 'year', 'month']);
  const monthDirectional = Boolean(evidencePacket?.timingMonthDirectional);
  const yearDirectional = Boolean(evidencePacket?.timingYearDirectional);

  switch (kind) {
    case 'natal':
      return hasNatal ? STATUS.ANSWERABLE : STATUS.INSUFFICIENT;
    case 'timing_precise':
      return monthDirectional ? STATUS.ANSWERABLE : STATUS.INSUFFICIENT;
    case 'timing_broad':
      if (yearDirectional || monthDirectional || hasCycle) {
        return STATUS.ANSWERABLE;
      }
      return STATUS.INSUFFICIENT;
    case 'explanation':
      return hasNatal || hasCycle ? STATUS.ANSWERABLE : STATUS.INSUFFICIENT;
    case 'reality':
      return STATUS.NEEDS_REALITY;
    default:
      return STATUS.INSUFFICIENT;
  }
}

function fallbackSegments(text) {
  return cleanText(text, 4000)
    .split(/[\n?？]|(?:,\s*)|(?:그리고)|(?:또한?)/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 4);
}

/**
 * Multi-intent question coverage. Splits the user's turn into internally
 * tracked sub-questions so no part is silently dropped (section 7). A simple
 * single factual question is intentionally NOT decomposed (section 14 CASE A).
 */
export function analyzeQuestionCoverage({
  userMessage = '',
  focus = null,
  evidencePacket = null
} = {}) {
  const text = cleanText(userMessage, 4000);
  const domain = focus?.domain || 'all';

  if (!text) {
    return [];
  }

  if (isSingleFactualSajuQuestion(text)) {
    return [
      {
        id: 'q1',
        question: text.slice(0, 160),
        topicId: 'factual',
        status: resolveStatus('natal', evidencePacket)
      }
    ];
  }

  const topics = SUBTOPICS[domain] || [];
  const coverage = [];
  const seen = new Set();

  for (const topic of topics) {
    if (topic.pattern.test(text) && !seen.has(topic.id)) {
      seen.add(topic.id);
      coverage.push({
        id: `q${coverage.length + 1}`,
        question: topic.id,
        topicId: topic.id,
        status: resolveStatus(topic.kind, evidencePacket)
      });
    }
  }

  if (coverage.length) {
    return coverage.slice(0, MAX_SUB_QUESTIONS);
  }

  // No domain sub-topic matched: fall back to segment counting so multi-part
  // turns are still tracked instead of silently collapsing into one answer.
  const segments = fallbackSegments(text);
  const questionLike = segments.filter((segment) =>
    /(까|나요|가요|어때|어떨|궁금|알려|조언|할지|좋을|언제|왜|어떻게)/u.test(segment)
  );
  const chosen = (questionLike.length ? questionLike : segments).slice(
    0,
    MAX_SUB_QUESTIONS
  );

  if (chosen.length <= 1) {
    return [
      {
        id: 'q1',
        question: text.slice(0, 160),
        topicId: 'general',
        status: resolveStatus(
          focus?.task === 'timing' ? 'timing_broad' : 'explanation',
          evidencePacket
        )
      }
    ];
  }

  return chosen.map((segment, index) => ({
    id: `q${index + 1}`,
    question: segment.slice(0, 160),
    topicId: 'general',
    status: resolveStatus(
      focus?.task === 'timing' ? 'timing_broad' : 'explanation',
      evidencePacket
    )
  }));
}

function buildSelectedEvidence(evidencePacket) {
  const list = Array.isArray(evidencePacket?.evidence)
    ? evidencePacket.evidence
    : [];
  return list
    .map((item) => {
      if (!item?.id) return null;
      const periodPart = item.period ? ` ${item.period}` : '';
      return {
        evidenceId: item.id,
        reason: `${item.scope || 'natal'}${periodPart} · ${
          item.selectionRole || 'context'
        }`,
        source: item.source || 'engine'
      };
    })
    .filter(Boolean);
}

function buildForbiddenInferences(domain, task) {
  const base = [
    'Engine에 없는 합충·십신·강약 재계산',
    '상대방의 속마음·의도·애착 유형 확정',
    '현실 사건·승진·계약·이별·성공을 발생 보장으로 단정'
  ];
  if (domain === 'romance' || domain === 'relationships') {
    base.push('특정 인물과의 결혼·이별 확정');
    base.push('새 인연·귀인이 오는 특정 시점 단정');
  }
  if (task === 'timing') {
    base.push('supportive direction 근거 없는 특정 연·월 단정');
  }
  return base;
}

function buildInsufficientAreas(coverage, evidencePacket) {
  const areas = [];
  for (const entry of coverage) {
    if (entry.status === STATUS.INSUFFICIENT) {
      areas.push(`${entry.topicId}: canonical Engine Fact 근거 부족`);
    }
    if (entry.status === STATUS.NEEDS_REALITY) {
      areas.push(`${entry.topicId}: 사용자 현실 입력 필요`);
    }
  }
  if (
    (evidencePacket?.task === 'timing' || evidencePacket?.timingFallbackLevel) &&
    evidencePacket?.timingMonthDirectional === false &&
    evidencePacket?.timingYearDirectional === false
  ) {
    areas.push('특정 월 단위 supportive direction 근거 부족');
  }
  return [...new Set(areas)];
}

function buildAnswerPlan({ coverage, evidencePacket, focus, coverageIntent, followupMode, includeEventBoundary = false }) {
  const hasCycle = hasScope(evidencePacket, ['daewoon', 'year', 'month']);
  const wantsComparison =
    (Array.isArray(focus?.targetYears) && focus.targetYears.length >= 2) ||
    coverage.some((entry) => entry.topicId === 'compare_years') ||
    followupMode === 'compare';
  const anyAnswerable = coverage.some(
    (entry) => entry.status === STATUS.ANSWERABLE
  );
  const overall = coverageIntent === 'overall' || followupMode === 'broaden';

  const plan = ['direct_answer'];
  if (anyAnswerable) plan.push('natal_reason');
  if (hasCycle) plan.push('cycle_reason');
  if (wantsComparison) plan.push('comparison');
  if (overall) {
    plan.push('career_sweep', 'wealth_sweep', 'relationship_sweep', 'health_sweep', 'inflection');
  }
  if (followupMode === 'expand') plan.push('deeper_fact_chain');
  if (followupMode === 'explain_reason') plan.push('fact_to_meaning_chain');
  plan.push('reality_translation');
  if (includeEventBoundary) plan.push('event_boundary');
  return [...new Set(plan)];
}

/**
 * Build the transient Interpretation Brief for one counseling turn.
 */
export function buildCounselingInterpretationBrief({
  userMessage = '',
  focus = null,
  evidencePacket = null,
  knowledgeHits = [],
  knowledgeRagUsed = false,
  interpretationCommitment = INTERPRETATION_COMMITMENT_DEFAULT
} = {}) {
  const domain = focus?.domain || 'all';
  const task = focus?.task || 'general';
  const followupMode = focus?.followupMode || null;
  const coverageIntent = focus?.coverageIntent || (domain === 'all' ? 'overall' : null);
  const responseMode = detectResponseMode(userMessage, focus);

  const coverage = analyzeQuestionCoverage({
    userMessage,
    focus,
    evidencePacket
  });

  const selectedEvidence = buildSelectedEvidence(evidencePacket);
  const requestedPeriodCoverage = buildRequestedPeriodCoverage({
    focus,
    evidencePacket
  });
  const insufficientAreas = buildInsufficientAreas(coverage, evidencePacket);
  const forbiddenInferences = buildForbiddenInferences(domain, task);
  const evidenceUsePlan = buildEvidenceUsePlan({
    evidencePacket,
    focus,
    responseMode
  });
  const supportedMeanings = buildSupportedMeanings({
    evidencePacket,
    focus,
    knowledgeHits
  });
  const strength = resolveInterpretationStrength({
    commitment: interpretationCommitment,
    evidencePacket,
    requestedPeriodCoverage,
    knowledgeRagUsed
  });
  const answerContract = buildAnswerContract({
    coverageIntent,
    followupMode,
    domain,
    requestedPeriodCoverage,
    strength,
    responseMode,
    evidenceUsePlan,
    userMessage
  });
  const answerPlan = buildAnswerPlan({
    coverage,
    evidencePacket,
    focus,
    coverageIntent,
    followupMode,
    includeEventBoundary: answerContract.includeEventBoundary
  });

  return {
    schemaVersion: COUNSELING_INTERPRETATION_BRIEF_VERSION,
    domain,
    task,
    responseMode,
    followupMode,
    coverageIntent,
    interpretationCommitment: Number(interpretationCommitment) || INTERPRETATION_COMMITMENT_DEFAULT,
    expressionStrength: strength,
    answerDirectness: answerDirectnessLabel(strength),
    requestedPeriodCoverage,
    questionCoverage: coverage,
    selectedEvidence,
    evidenceUsePlan,
    supportedMeanings,
    insufficientAreas,
    forbiddenInferences,
    answerPlan,
    answerContract,
    askClarifyingQuestion: shouldAskClarifyingQuestion({
      coverage,
      followupMode,
      coverageIntent
    })
  };
}

export function summarizeInterpretationBrief(brief) {
  if (!brief || typeof brief !== 'object') return null;
  const coverage = Array.isArray(brief.questionCoverage)
    ? brief.questionCoverage
    : [];
  const selectedEvidence = Array.isArray(brief.selectedEvidence)
    ? brief.selectedEvidence
    : [];
  return {
    questionCount: coverage.length,
    answerableCount: coverage.filter((entry) => entry.status === STATUS.ANSWERABLE)
      .length,
    insufficientCount: coverage.filter(
      (entry) => entry.status === STATUS.INSUFFICIENT
    ).length,
    needsRealityCount: coverage.filter(
      (entry) => entry.status === STATUS.NEEDS_REALITY
    ).length,
    evidenceIds: selectedEvidence.map((item) => item.evidenceId),
    responseMode: brief.responseMode || null,
    requiredEvidenceUseCount: Array.isArray(brief.evidenceUsePlan?.items)
      ? brief.evidenceUsePlan.items.length
      : 0,
    supportedMeaningCount: Array.isArray(brief.supportedMeanings)
      ? brief.supportedMeanings.length
      : 0,
    interpretationCommitment: brief.interpretationCommitment ?? null,
    followupMode: brief.followupMode ?? null,
    answerDirectness: brief.answerDirectness ?? null,
    requestedPeriodCoverage: brief.requestedPeriodCoverage
      ? {
          requested: brief.requestedPeriodCoverage.requested || [],
          selected: brief.requestedPeriodCoverage.selected || [],
          complete: Boolean(brief.requestedPeriodCoverage.complete)
        }
      : null
  };
}

export function formatInterpretationBriefForPrompt(brief) {
  if (!brief || typeof brief !== 'object') return '';
  return JSON.stringify(
    {
      schemaVersion: brief.schemaVersion,
      domain: brief.domain,
      task: brief.task,
      responseMode: brief.responseMode,
      questionCoverage: brief.questionCoverage,
      selectedEvidence: brief.selectedEvidence,
      evidenceUsePlan: brief.evidenceUsePlan,
      supportedMeanings: brief.supportedMeanings,
      insufficientAreas: brief.insufficientAreas,
      forbiddenInferences: brief.forbiddenInferences,
      answerPlan: brief.answerPlan,
      followupMode: brief.followupMode || null,
      coverageIntent: brief.coverageIntent || null,
      interpretationCommitment: brief.interpretationCommitment,
      answerDirectness: brief.answerDirectness,
      requestedPeriodCoverage: brief.requestedPeriodCoverage,
      answerContract: brief.answerContract,
      askClarifyingQuestion: Boolean(brief.askClarifyingQuestion)
    },
    null,
    0
  );
}

export default Object.freeze({
  COUNSELING_INTERPRETATION_BRIEF_VERSION,
  analyzeQuestionCoverage,
  buildCounselingInterpretationBrief,
  summarizeInterpretationBrief,
  formatInterpretationBriefForPrompt
});
