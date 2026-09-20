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

const READING_ASK_PATTERN =
  /(사주|운세|총운|재물운|금전운|사업운|직업운|연애운|애정운|심신운|건강운|대운|연운|월운|세운|올해|내년|내후년|몇\s*월)/u;
const REALITY_COUNSELING_PATTERN =
  /(힘들|불안|괴롭|답답|고민|그만둘|퇴사|이직할|확장할|정리할|헤어질|결혼할|싸웠|연락이|어떻게\s*해야|선택해야|결정해야|도와줘|상담)/u;

export function detectResponseMode(userMessage = '', focus = null) {
  const text = cleanText(userMessage, 3000);
  const explicitReading =
    READING_ASK_PATTERN.test(text) ||
    Boolean(focus?.targetYears?.length) ||
    Boolean(focus?.targetMonths?.length);
  const realityCounseling = REALITY_COUNSELING_PATTERN.test(text);

  if (explicitReading && realityCounseling) return 'mixed';
  if (explicitReading) return 'reading';
  return 'counseling';
}

export function shouldIncludeEventBoundary(userMessage = '') {
  const text = cleanText(userMessage, 2000);
  return /(반드시|확실히|무조건|성공(?:하|할)|실패(?:하|할)|헤어질|이별할|결혼할|승진할|합격할|망할|죽|사고|병에\s*걸)/u.test(text);
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
function relationTypes(facts) {
  return (Array.isArray(facts?.relationsWithNatal) ? facts.relationsWithNatal : [])
    .map((relation) => cleanText(relation?.type, 40))
    .filter(Boolean)
    .slice(0, 4);
}

function concreteEvidenceStatement(item) {
  if (!item?.id) return '';
  const facts = item.facts || {};

  if (item.id === 'natal-domain' || item.id === 'natal-overall') {
    const groups = (facts.relevantGroups || [])
      .slice(0, 5)
      .map((group) => {
        const parts = [
          group.group,
          group.strengthBand ? `strength=${group.strengthBand}` : '',
          Number.isFinite(Number(group.visibleCount)) ? `visible=${group.visibleCount}` : '',
          Number.isFinite(Number(group.hiddenCount)) ? `hidden=${group.hiddenCount}` : ''
        ].filter(Boolean);
        return parts.join('/');
      });
    const positions = (facts.tenGodPositions || [])
      .slice(0, 6)
      .map((position) =>
        [position.tenGodKo, position.group, position.position, position.visible === false ? 'hidden' : 'visible']
          .filter(Boolean)
          .join('@')
      );
    const stars = (facts.detectedStars || [])
      .slice(0, 3)
      .map((star) => star.canonicalName || star.starId)
      .filter(Boolean);
    const parts = [
      facts.dayPillar ? `dayPillar=${facts.dayPillar}` : '',
      groups.length ? `groups=[${groups.join(', ')}]` : '',
      positions.length ? `positions=[${positions.join(', ')}]` : '',
      stars.length ? `stars=[${stars.join(', ')}]` : ''
    ].filter(Boolean);
    return parts.join(' · ');
  }

  const parts = [
    facts.ganzhi ? `ganzhi=${facts.ganzhi}` : '',
    facts.tenGod?.tenGodKo ? `tenGod=${facts.tenGod.tenGodKo}` : '',
    facts.tenGod?.group ? `group=${facts.tenGod.group}` : '',
    facts.twelveStage?.stage ? `twelveStage=${facts.twelveStage.stage}` : '',
    relationTypes(facts).length ? `relations=[${relationTypes(facts).join(', ')}]` : '',
    facts.balanceImpact?.effect ? `balance=${facts.balanceImpact.effect}` : ''
  ].filter(Boolean);
  return parts.join(' · ');
}

/**
 * The brief must not pre-chew ten-god groups into generic advice.
 * Keep supportedMeanings as concrete, traceable evidence bundles; Knowledge RAG
 * and the final model perform the actual interpretation.
 */
export function buildSupportedMeanings({
  evidencePacket = null,
  focus = null,
  knowledgeHits = []
} = {}) {
  const evidence = Array.isArray(evidencePacket?.evidence)
    ? evidencePacket.evidence
    : [];
  const ragIds = (Array.isArray(knowledgeHits) ? knowledgeHits : [])
    .map((hit) => hit?.id || hit?.chunkId)
    .filter(Boolean)
    .slice(0, 4);

  const priority = [];
  const pushById = (id) => {
    const item = evidence.find((entry) => entry?.id === id);
    if (item && !priority.includes(item)) priority.push(item);
  };

  if (focus?.domain === 'all') pushById('natal-overall');
  else pushById('natal-domain');
  pushById('daewoon-current');

  for (const item of evidence) {
    if (item?.selectionRole === 'requested') pushById(item.id);
  }
  for (const item of evidence) {
    if ((item?.scope === 'year' || item?.scope === 'month') && priority.length < 6) {
      pushById(item.id);
    }
  }

  return priority
    .map((item) => {
      const statement = concreteEvidenceStatement(item);
      if (!statement) return null;
      return {
        statement,
        supportEvidenceIds: [item.id],
        supportRagIds: ragIds,
        confidence: item.selectionRole === 'requested' ? 'medium' : 'low'
      };
    })
    .filter(Boolean)
    .slice(0, 6);
}

export function buildEvidenceUsePlan({
  evidencePacket = null,
  focus = null,
  responseMode = 'counseling'
} = {}) {
  const evidence = Array.isArray(evidencePacket?.evidence)
    ? evidencePacket.evidence
    : [];
  const ids = new Set(evidence.map((item) => item?.id).filter(Boolean));
  const plan = [];
  const add = (id, purpose) => {
    if (ids.has(id) && !plan.some((item) => item.evidenceId === id)) {
      plan.push({ evidenceId: id, purpose });
    }
  };

  if (focus?.domain === 'all') add('natal-overall', '원국 전체 구조');
  else add('natal-domain', `${focus?.domain || 'domain'} 원국 구조`);
  add('natal-core', '일간·강약·기본 구조');
  add('daewoon-current', '현재 대운의 큰 배경');

  for (const item of evidence) {
    if (item?.selectionRole === 'requested') {
      add(item.id, '사용자가 직접 요청한 시기');
    }
  }

  if (responseMode === 'reading') {
    for (const item of evidence) {
      if ((item?.scope === 'year' || item?.scope === 'month') && plan.length < 5) {
        add(item.id, '해당 시기의 구체 근거');
      }
    }
  }

  const max = responseMode === 'reading' ? 5 : responseMode === 'mixed' ? 4 : 3;
  const selected = plan.slice(0, max);
  return {
    items: selected,
    minUseCount: Math.min(responseMode === 'reading' ? 3 : 2, selected.length)
  };
}

export function buildAnswerContract({
  coverageIntent = null,
  followupMode = null,
  domain = 'all',
  requestedPeriodCoverage = null,
  strength = INTERPRETATION_COMMITMENT_DEFAULT,
  responseMode = 'counseling',
  evidenceUsePlan = null,
  userMessage = ''
} = {}) {
  const overall = coverageIntent === 'overall' || followupMode === 'broaden' || domain === 'all';
  return {
    leadWithConclusion: true,
    responseMode,
    readingFirst: responseMode === 'reading' || responseMode === 'mixed',
    overallSweep: Boolean(overall),
    allowRelativeComparison: Boolean(
      requestedPeriodCoverage?.selected?.length >= 2 || followupMode === 'compare'
    ),
    requiredEvidenceUse: evidenceUsePlan || { items: [], minUseCount: 0 },
    includeEventBoundary: shouldIncludeEventBoundary(userMessage),
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
  detectResponseMode,
  shouldIncludeEventBoundary,
  extractTargetMonths,
  requestedPeriodKeys,
  buildRequestedPeriodCoverage,
  resolveInterpretationStrength,
  answerDirectnessLabel,
  shouldAskClarifyingQuestion,
  buildSupportedMeanings,
  buildEvidenceUsePlan,
  buildAnswerContract
});
