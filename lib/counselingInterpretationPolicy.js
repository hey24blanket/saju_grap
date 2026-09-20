// counselingInterpretationPolicy.js
// -----------------------------------------------------------------------------
// Single control plane for grounded myeongri directness.
// This is NOT a probability of real-world events.
// -----------------------------------------------------------------------------

export const COUNSELING_INTERPRETATION_POLICY_VERSION =
  'counseling_interpretation_policy_v1';

export const INTERPRETATION_COMMITMENT_DEFAULT = 0.65;
export const INTERPRETATION_COMMITMENT_MAX = 0.8;
export const COUNSELING_CHAT_MAX_OUTPUT_TOKENS = 2800;

const TEN_GOD_TOPIC = Object.freeze({
  officer: '역할·책임·외부 기준',
  wealth: '자원·성과·쓰임',
  output: '표현·실행·산출',
  peer: '자기 몫·경쟁·협력',
  resource: '지원·학습·회복'
});

function cleanText(value, max = 400) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function detectFollowupMode(userMessage = '') {
  const text = cleanText(userMessage, 2000);
  if (!text) return null;
  if (/(왜\s*그렇게\s*봐|왜\s*그런\s*거야|왜\s*그렇게\s*보|근거(?:가)?\s*(?:뭐|있)|명리(?:적)?(?:으로)?\s*(?:이유|왜))/u.test(text)) {
    return 'explain_reason';
  }
  if (/(비교|올해.{0,8}내년|내년.{0,8}올해|상반기.{0,8}하반기)/u.test(text)) {
    return 'compare';
  }
  if (/(전체적(?:으로|인\s*운)|빠뜨린|다른\s*(?:분야|영역)|두루)/u.test(text)) {
    return 'broaden';
  }
  if (/(조금\s*더|더\s*자세히|더\s*설명|구체적으로|자세히\s*말)/u.test(text)) {
    return 'expand';
  }
  return null;
}

export function isOverallFortuneAsk(userMessage = '') {
  return /(총운|전체적(?:으로|인\s*(?:운|흐름|기운))|전반적(?:인)?\s*운)/u.test(
    cleanText(userMessage, 2000)
  );
}

export function extractTargetMonths(text = '') {
  const months = [...String(text).matchAll(/(?:^|[^\d])(1[0-2]|0?[1-9])\s*월/gu)]
    .map((match) => Number(match[1]))
    .filter((month) => month >= 1 && month <= 12);
  return [...new Set(months)];
}

export function requestedPeriodKeys(focus = {}, referenceYear = null) {
  const years = Array.isArray(focus?.targetYears)
    ? focus.targetYears.map(numberOrNull).filter(Boolean)
    : [];
  const months = Array.isArray(focus?.targetMonths) && focus.targetMonths.length
    ? focus.targetMonths.map(numberOrNull).filter(Boolean)
    : numberOrNull(focus?.targetMonth)
      ? [Number(focus.targetMonth)]
      : [];
  const keys = [];
  for (const year of years) {
    keys.push(`year-${year}`);
    for (const month of months) {
      keys.push(`month-${year}-${String(month).padStart(2, '0')}`);
    }
  }
  if (!years.length && months.length && Number.isFinite(Number(referenceYear))) {
    const year = Number(referenceYear);
    for (const month of months) {
      keys.push(`month-${year}-${String(month).padStart(2, '0')}`);
    }
  }
  return [...new Set(keys)];
}

export function matchEvidenceToPeriodKey(item, key) {
  if (!item || !key) return false;
  if (item.id === key || String(item.id || '').startsWith(`${key}-`)) return true;
  if (key.startsWith('year-')) {
    const year = key.slice(5);
    return item.scope === 'year' && String(item.period) === year;
  }
  if (key.startsWith('month-')) {
    const period = key.slice('month-'.length).replace(
      /^(\d{4})-(\d{1,2})$/,
      (_, year, month) => `${year}-${String(month).padStart(2, '0')}`
    );
    return item.scope === 'month' && String(item.period) === period;
  }
  return false;
}

export function buildRequestedPeriodCoverage({
  focus = null,
  evidencePacket = null,
  referenceYear = null
} = {}) {
  const requested = requestedPeriodKeys(focus, referenceYear);
  const evidence = Array.isArray(evidencePacket?.evidence)
    ? evidencePacket.evidence
    : [];
  const selected = requested.filter((key) =>
    evidence.some((item) => matchEvidenceToPeriodKey(item, key))
  );
  return {
    requested,
    selected,
    complete: requested.length === 0 || selected.length === requested.length
  };
}

function hasScope(evidencePacket, scopes) {
  const list = Array.isArray(evidencePacket?.evidence)
    ? evidencePacket.evidence
    : [];
  return list.some((item) => scopes.includes(item?.scope));
}

export function resolveInterpretationStrength({
  commitment = INTERPRETATION_COMMITMENT_DEFAULT,
  evidencePacket = null,
  requestedPeriodCoverage = null,
  knowledgeRagUsed = false
} = {}) {
  const base = Math.min(
    INTERPRETATION_COMMITMENT_MAX,
    Math.max(0.2, Number(commitment) || INTERPRETATION_COMMITMENT_DEFAULT)
  );
  const hasEngine = (evidencePacket?.evidence || []).length > 0;
  if (!hasEngine) return 0.2;

  let strength = base;
  const hasCycle = hasScope(evidencePacket, ['daewoon', 'year', 'month']);
  if (!hasCycle) strength = Math.min(strength, 0.45);

  if (
    requestedPeriodCoverage &&
    requestedPeriodCoverage.requested?.length &&
    requestedPeriodCoverage.complete === false
  ) {
    strength = Math.min(strength, 0.45);
  }

  const yearCount = (evidencePacket?.evidence || []).filter(
    (item) => item?.scope === 'year'
  ).length;
  if (yearCount >= 2) {
    strength = Math.max(strength, Math.min(INTERPRETATION_COMMITMENT_MAX, base));
  }

  if (knowledgeRagUsed) {
    strength = Math.min(INTERPRETATION_COMMITMENT_MAX, strength + 0.05);
  }

  return Math.round(strength * 100) / 100;
}

export function answerDirectnessLabel(strength) {
  if (strength >= 0.8) return 'center_theme';
  if (strength >= 0.65) return 'clear_theme';
  if (strength >= 0.4) return 'leaning';
  return 'tentative';
}

export function shouldAskClarifyingQuestion({
  coverage = [],
  followupMode = null,
  coverageIntent = null
} = {}) {
  if (coverageIntent === 'overall' || followupMode === 'broaden') return false;
  const answerable = coverage.filter((entry) => entry.status === 'answerable');
  const needsReality = coverage.filter((entry) => entry.status === 'needs_reality_input');
  if (answerable.length > 0) return false;
  return needsReality.length > 0 && needsReality.length === coverage.length;
}

function topicForGroup(group) {
  return TEN_GOD_TOPIC[group] || null;
}

function relationLabel(relation) {
  const type = cleanText(relation?.type, 40);
  if (!type) return null;
  return type.replace(/_/g, ' ');
}

/**
 * Build supported meanings only from Engine Fact combinations that already
 * exist on selected evidence. Optional RAG ids may be attached when the
 * caller supplies matching snippet ids; statements are never invented from
 * empty support.
 */
export function buildSupportedMeanings({
  evidencePacket = null,
  focus = null,
  knowledgeHits = []
} = {}) {
  const evidence = Array.isArray(evidencePacket?.evidence)
    ? evidencePacket.evidence
    : [];
  const meanings = [];
  const ragIds = (Array.isArray(knowledgeHits) ? knowledgeHits : [])
    .map((hit) => hit?.id || hit?.chunkId)
    .filter(Boolean)
    .slice(0, 4);

  const daewoon = evidence.find((item) => item.id === 'daewoon-current');
  const years = evidence.filter((item) => item.scope === 'year');
  const months = evidence.filter((item) => item.scope === 'month');

  const push = (entry) => {
    if (!entry?.statement || !Array.isArray(entry.supportEvidenceIds) || !entry.supportEvidenceIds.length) {
      return;
    }
    meanings.push({
      statement: entry.statement.slice(0, 180),
      supportEvidenceIds: [...new Set(entry.supportEvidenceIds)].slice(0, 6),
      supportRagIds: ragIds.slice(0, 4),
      confidence: entry.confidence || 'medium'
    });
  };

  if (daewoon?.facts?.tenGod?.group) {
    const topic = topicForGroup(daewoon.facts.tenGod.group);
    if (topic) {
      const relationHint = (daewoon.facts.relationsWithNatal || [])
        .map(relationLabel)
        .filter(Boolean)[0];
      push({
        statement: relationHint
          ? `현재 대운은 ${topic}이 중심에 있고, 원국과의 ${relationHint} 관계가 함께 읽힌다`
          : `현재 대운은 ${topic}이 중심 주제로 읽힌다`,
        supportEvidenceIds: ['daewoon-current'],
        confidence: relationHint ? 'medium' : 'low'
      });
    }
  }

  for (const yearItem of years.slice(0, 3)) {
    const group = yearItem.facts?.tenGod?.group;
    const topic = topicForGroup(group);
    const ids = ['daewoon-current', yearItem.id].filter((id) =>
      evidence.some((item) => item.id === id)
    );
    if (topic && ids.length) {
      const relationCount = Array.isArray(yearItem.facts?.relationsWithNatal)
        ? yearItem.facts.relationsWithNatal.length
        : 0;
      push({
        statement: relationCount
          ? `${yearItem.period}년은 ${topic} 위에 원국 관계 신호가 겹치는 해로 읽힌다`
          : `${yearItem.period}년은 ${topic}이 주제로 읽히는 해다`,
        supportEvidenceIds: ids,
        confidence: relationCount ? 'medium' : 'low'
      });
    }
  }

  if (years.length >= 2) {
    const [left, right] = years;
    const leftCount = (left.facts?.relationsWithNatal || []).length;
    const rightCount = (right.facts?.relationsWithNatal || []).length;
    if (left.period && right.period && leftCount !== rightCount) {
      const stronger = rightCount > leftCount ? right : left;
      const weaker = stronger === right ? left : right;
      push({
        statement: `${stronger.period}년은 ${weaker.period}년보다 원국 관계 신호가 더 많다`,
        supportEvidenceIds: [left.id, right.id],
        confidence: 'medium'
      });
    }
    const leftGroup = left.facts?.tenGod?.group;
    const rightGroup = right.facts?.tenGod?.group;
    if (leftGroup && rightGroup && leftGroup !== rightGroup) {
      const leftTopic = topicForGroup(leftGroup);
      const rightTopic = topicForGroup(rightGroup);
      if (leftTopic && rightTopic) {
        push({
          statement: `${left.period}년의 주제(${leftTopic})와 ${right.period}년의 주제(${rightTopic})가 다르다`,
          supportEvidenceIds: [left.id, right.id],
          confidence: 'medium'
        });
      }
    }
  }

  for (const monthItem of months.slice(0, 2)) {
    const group = monthItem.facts?.tenGod?.group;
    const topic = topicForGroup(group);
    if (topic && monthItem.period) {
      push({
        statement: `${monthItem.period}는 ${topic}이 상대적으로 선명해지는 구간으로 읽힌다`,
        supportEvidenceIds: [monthItem.id],
        confidence: 'low'
      });
    }
  }

  if (focus?.domain && focus.domain !== 'all') {
    const natalDomain = evidence.find((item) => item.id === 'natal-domain');
    const stars = natalDomain?.facts?.detectedStars || [];
    if (stars.length) {
      push({
        statement: `원국에서 ${stars
          .map((star) => star.canonicalName || star.starId)
          .filter(Boolean)
          .slice(0, 3)
          .join('·')} 신호가 이 주제의 근거로 남아 있다`,
        supportEvidenceIds: ['natal-domain'],
        confidence: 'medium'
      });
    }
  }

  const seen = new Set();
  return meanings.filter((item) => {
    if (seen.has(item.statement)) return false;
    seen.add(item.statement);
    return true;
  }).slice(0, 6);
}

export function buildAnswerContract({
  coverageIntent = null,
  followupMode = null,
  domain = 'all',
  requestedPeriodCoverage = null,
  strength = INTERPRETATION_COMMITMENT_DEFAULT
} = {}) {
  const overall = coverageIntent === 'overall' || followupMode === 'broaden' || domain === 'all';
  return {
    leadWithConclusion: true,
    overallSweep: Boolean(overall),
    allowRelativeComparison: Boolean(
      requestedPeriodCoverage?.selected?.length >= 2 || followupMode === 'compare'
    ),
    forbidEventGuarantee: true,
    forbidPhilosophyPreamble: true,
    askClarifyingQuestionOnlyWhenNeeded: true,
    followupMode: followupMode || null,
    expressionStrength: strength
  };
}

export default Object.freeze({
  COUNSELING_INTERPRETATION_POLICY_VERSION,
  INTERPRETATION_COMMITMENT_DEFAULT,
  INTERPRETATION_COMMITMENT_MAX,
  COUNSELING_CHAT_MAX_OUTPUT_TOKENS,
  detectFollowupMode,
  isOverallFortuneAsk,
  extractTargetMonths,
  requestedPeriodKeys,
  buildRequestedPeriodCoverage,
  resolveInterpretationStrength,
  answerDirectnessLabel,
  shouldAskClarifyingQuestion,
  buildSupportedMeanings,
  buildAnswerContract
});
