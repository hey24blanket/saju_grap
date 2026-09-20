import { compactCycle, compactRelation } from './counselingFactContext.js';
import { requestedPeriodKeys } from './counselingInterpretationPolicy.js';

export const COUNSELING_EVIDENCE_SELECTOR_VERSION =
  'counseling_evidence_selector_v5';

const MIN_SALIENCE_SCORE = 2;
const MAX_EVIDENCE_ITEMS = 9;
const MAX_TIMING_MONTH_HIGHLIGHTS = 2;
const MAX_TIMING_YEAR_HIGHLIGHTS = 2;

// Ten-god groups that are relation-relevant per counseling domain. These only
// decide WHICH already-computed Engine Facts to surface; no new myeongri
// meaning is calculated here (e.g. "spouse palace" interpretation is left to
// Knowledge RAG / the model).
const DOMAIN_TENGOD_GROUPS = Object.freeze({
  romance: ['wealth', 'officer'],
  relationships: ['officer', 'peer'],
  career: ['officer', 'output', 'wealth'],
  wealth: ['wealth', 'output', 'peer'],
  family: ['resource', 'officer', 'peer'],
  health: ['resource', 'output']
});

// Detected stars worth surfacing per domain. The star's meaning is not asserted
// here; only the Engine's detection + matched positions are carried through.
const DOMAIN_STAR_IDS = Object.freeze({
  romance: ['PEACH_BLOSSOM', 'TIAN_YI', 'HONG_YAN'],
  relationships: ['TIAN_YI', 'HUA_GAI'],
  career: ['TIAN_YI', 'WEN_CHANG', 'YANG_REN', 'KUI_GANG'],
  wealth: ['TIAN_YI', 'YIMA'],
  family: ['HUA_GAI', 'TIAN_YI'],
  health: ['HUA_GAI', 'YANG_REN']
});

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function spouseStarGroup(engineFacts) {
  const gender = engineFacts?.input?.gender ?? null;
  if (gender === 'male') return 'wealth';
  if (gender === 'female') return 'officer';
  return null;
}

function pickTenGodPositions(engineFacts, groups) {
  if (!Array.isArray(groups) || !groups.length) return [];
  const wanted = new Set(groups);
  const profile = engineFacts?.tenGodProfile || {};
  const visible = Array.isArray(profile.visible) ? profile.visible : [];
  const hidden = Array.isArray(profile.hidden) ? profile.hidden : [];
  const map = (list, isVisible) =>
    list
      .filter((item) => wanted.has(item?.group))
      .map((item) => ({
        position: item?.position ?? null,
        tenGodKo: item?.tenGodKo ?? null,
        group: item?.group ?? null,
        visible: isVisible,
        ...(item?.weight != null ? { weight: item.weight } : {})
      }))
      .filter((item) => item.position);
  return [...map(visible, true), ...map(hidden, false)].slice(0, 8);
}

function pickDetectedStars(engineFacts, starIds) {
  if (!Array.isArray(starIds) || !starIds.length) return [];
  const wanted = new Set(starIds);
  const stars = Array.isArray(engineFacts?.stars) ? engineFacts.stars : [];
  return stars
    .filter((star) => star?.detected && wanted.has(star?.starId))
    .map((star) => ({
      starId: star.starId ?? null,
      canonicalName: star.canonicalName ?? null,
      matches: Array.isArray(star.matches)
        ? star.matches
            .map((match) => ({
              position: match?.position ?? null,
              branch: match?.branch ?? null
            }))
            .slice(0, 4)
        : []
    }))
    .slice(0, 4);
}

function pickNatalRelations(engineFacts, positionSubstring = null) {
  const items = Array.isArray(engineFacts?.relations?.items)
    ? engineFacts.relations.items
    : [];
  const filtered = positionSubstring
    ? items.filter(
        (relation) =>
          Array.isArray(relation?.members) &&
          relation.members.some((member) =>
            String(member?.position || '').includes(positionSubstring)
          )
      )
    : items;
  return filtered.map(compactRelation).filter(Boolean).slice(0, 6);
}

function groupSummary(group) {
  if (!group) return null;
  return {
    strengthBand: group.strengthBand ?? null,
    visibleCount: group.visibleCount ?? null,
    hiddenCount: group.hiddenCount ?? null,
    rooted: group.rooted ?? null
  };
}

function pickNatalEvidence(engineFacts) {
  const useful = engineFacts?.usefulGodProfile || {};
  const groups = engineFacts?.tenGodProfile?.groups || {};
  return {
    dayMaster: engineFacts?.natal?.dayMaster ?? null,
    strengthBand: engineFacts?.strength?.band ?? null,
    dominantImbalance: useful?.dominantImbalance ?? null,
    yongsinElement: useful?.yongsin?.element ?? null,
    wealthGroup: groups?.wealth
      ? {
          strengthBand: groups.wealth.strengthBand ?? null,
          visibleCount: groups.wealth.visibleCount ?? null
        }
      : null,
    officerGroup: groups?.officer
      ? {
          strengthBand: groups.officer.strengthBand ?? null,
          visibleCount: groups.officer.visibleCount ?? null
        }
      : null
  };
}

/**
 * Domain-specific natal Fact selection. Surfaces already-computed Engine Facts
 * that a given domain most needs (day branch, relation-relevant ten-god
 * positions, natal relations that touch the day branch, and relevant detected
 * stars) WITHOUT computing any new myeongri meaning. Returns null when no extra
 * domain Fact is available so callers can skip the item.
 */
export function pickDomainNatalEvidence(engineFacts, domain = 'all') {
  if (!engineFacts || domain === 'all' || domain === 'cycles') return null;
  const groups = engineFacts?.tenGodProfile?.groups || {};
  const relationGroups = DOMAIN_TENGOD_GROUPS[domain] || [];
  const starIds = DOMAIN_STAR_IDS[domain] || [];

  const isRelationDomain = domain === 'romance' || domain === 'relationships';
  const dayBranch = engineFacts?.natal?.day?.branch ?? null;

  const facts = {
    domain,
    tenGodPositions: pickTenGodPositions(engineFacts, relationGroups),
    relevantGroups: relationGroups
      .map((groupKey) => {
        const summary = groupSummary(groups[groupKey]);
        return summary ? { group: groupKey, ...summary } : null;
      })
      .filter(Boolean),
    detectedStars: pickDetectedStars(engineFacts, starIds),
    natalRelations: isRelationDomain
      ? pickNatalRelations(engineFacts, 'day_branch')
      : pickNatalRelations(engineFacts)
  };

  if (isRelationDomain) {
    facts.dayBranch = dayBranch;
    facts.dayPillar = engineFacts?.natal?.day?.ganzhi ?? null;
    const starGroup = spouseStarGroup(engineFacts);
    if (starGroup) {
      facts.relationStarGroup = { group: starGroup, ...(groupSummary(groups[starGroup]) || {}) };
    }
  }

  const hasContent =
    facts.tenGodPositions.length ||
    facts.relevantGroups.length ||
    facts.detectedStars.length ||
    facts.natalRelations.length ||
    facts.dayBranch;

  return hasContent ? facts : null;
}

export function pickOverallNatalEvidence(engineFacts) {
  if (!engineFacts) return null;
  const groups = engineFacts?.tenGodProfile?.groups || {};
  const groupKeys = ['officer', 'wealth', 'output', 'peer', 'resource'];
  const facts = {
    domain: 'all',
    dayMaster: engineFacts?.natal?.dayMaster ?? null,
    dayBranch: engineFacts?.natal?.day?.branch ?? null,
    dayPillar: engineFacts?.natal?.day?.ganzhi ?? null,
    strengthBand: engineFacts?.strength?.band ?? null,
    dominantImbalance: engineFacts?.usefulGodProfile?.dominantImbalance ?? null,
    yongsinElement: engineFacts?.usefulGodProfile?.yongsin?.element ?? null,
    tenGodPositions: pickTenGodPositions(engineFacts, groupKeys),
    relevantGroups: groupKeys
      .map((groupKey) => {
        const summary = groupSummary(groups[groupKey]);
        return summary ? { group: groupKey, ...summary } : null;
      })
      .filter(Boolean),
    detectedStars: pickDetectedStars(engineFacts, [
      'PEACH_BLOSSOM',
      'TIAN_YI',
      'HONG_YAN',
      'WEN_CHANG',
      'YIMA',
      'HUA_GAI'
    ]),
    natalRelations: pickNatalRelations(engineFacts)
  };
  const hasContent =
    facts.dayMaster ||
    facts.dayBranch ||
    facts.tenGodPositions.length ||
    facts.relevantGroups.length ||
    facts.detectedStars.length ||
    facts.natalRelations.length;
  return hasContent ? facts : null;
}

function findDaewoon(cycles, year) {
  const list = Array.isArray(cycles?.daewoon) ? cycles.daewoon : [];
  return list.find(
    (cycle) =>
      numberOrNull(cycle?.startYear) <= year &&
      numberOrNull(cycle?.endYear) >= year
  ) || null;
}

function findYearCycle(cycles, year) {
  const list = Array.isArray(cycles?.year) ? cycles.year : [];
  return list.find((cycle) => numberOrNull(cycle?.year) === year) || null;
}

function listMonthCycles(cycles, year) {
  const list = Array.isArray(cycles?.month) ? cycles.month : [];
  return list.filter((cycle) => numberOrNull(cycle?.year) === year);
}

function makeEvidenceItem({
  id,
  scope,
  period,
  facts,
  selectionRole = 'context',
  periodCandidate = null
}) {
  if (!facts) return null;
  return {
    id,
    source: 'engine',
    scope,
    period,
    facts,
    selectionRole,
    periodCandidate
  };
}

function periodLabel(cycle) {
  if (!cycle) return null;
  if (cycle.cycleType === 'month' && cycle.year && cycle.month) {
    return `${cycle.year}-${String(cycle.month).padStart(2, '0')}`;
  }
  if (cycle.year) return String(cycle.year);
  if (cycle.startYear && cycle.endYear) {
    return `${cycle.startYear}-${cycle.endYear}`;
  }
  return cycle.cycleType || null;
}

/**
 * Engine: evaluateBalanceImpact() in SajuGrapEngine.js
 * - relieves: yongsin availability increased, gisin not activated alone
 * - aggravates: gisin activated without relieving yongsin pattern
 * - mixed: both y and g
 * - neutral: neither
 */
export function inferCanonicalTimingDirection(compactFacts) {
  const effect = compactFacts?.balanceImpact?.effect ?? null;
  const signals = [];

  if (!effect || effect === 'neutral') {
    return { value: 'unknown', signals: ['balanceImpact.neutral'] };
  }
  if (effect === 'relieves') {
    signals.push('balanceImpact.relieves');
    return { value: 'supportive', signals };
  }
  if (effect === 'aggravates') {
    signals.push('balanceImpact.aggravates');
    return { value: 'pressured', signals };
  }
  if (effect === 'mixed') {
    signals.push('balanceImpact.mixed');
    return { value: 'mixed', signals };
  }

  return { value: 'unknown', signals: [`balanceImpact.${String(effect)}`] };
}

export function scoreCanonicalTimingSalience(compactFacts, domain = 'all') {
  if (!compactFacts || typeof compactFacts !== 'object') {
    return { score: 0, signals: [] };
  }

  const signals = [];
  let score = 0;

  if (compactFacts.ganzhi || compactFacts.stem || compactFacts.branch) {
    score += 1;
    signals.push('cycleIdentity');
  }

  const relationCount = Array.isArray(compactFacts.relationsWithNatal)
    ? compactFacts.relationsWithNatal.length
    : 0;
  if (relationCount > 0) {
    score += Math.min(2, relationCount);
    signals.push('relationsWithNatal');
  }

  if (compactFacts.twelveStage?.stage) {
    score += 1;
    signals.push('twelveStage');
  }

  if (domain === 'wealth' && compactFacts.tenGod?.group === 'wealth') {
    score += 1;
    signals.push('tenGodWealth');
  }

  // Domain-specific salience: a cycle whose ten-god group is relation-relevant
  // to the domain, or whose relation touches the natal day branch, is a higher
  // "worth-interpreting" candidate. Salience ranks candidates for explanation;
  // it never decides supportive/pressured direction (that stays balanceImpact).
  const domainGroups = DOMAIN_TENGOD_GROUPS[domain];
  if (
    domain !== 'wealth' &&
    Array.isArray(domainGroups) &&
    compactFacts.tenGod?.group &&
    domainGroups.includes(compactFacts.tenGod.group)
  ) {
    score += 1;
    signals.push(`tenGod:${domain}`);
  }

  if (domain === 'all' && compactFacts.tenGod?.group) {
    score += 1;
    signals.push('tenGod:overall');
  }

  if (
    (domain === 'romance' || domain === 'relationships') &&
    Array.isArray(compactFacts.relationsWithNatal) &&
    compactFacts.relationsWithNatal.some((relation) =>
      Array.isArray(relation?.members) &&
      relation.members.some((member) =>
        String(member?.position || '').includes('day_branch')
      )
    )
  ) {
    score += 1;
    signals.push('relationOnDayBranch');
  }

  if (
    compactFacts.usefulGodImpact?.yongsinImpact ||
    compactFacts.usefulGodImpact?.gisinImpact
  ) {
    score += 1;
    signals.push('usefulGodImpact');
  }

  return { score, signals };
}

/** @deprecated use scoreCanonicalTimingSalience */
export function scoreCanonicalTimingExplainability(compactFacts, domain = 'all') {
  return scoreCanonicalTimingSalience(compactFacts, domain);
}

export function buildPeriodCandidate({
  compactFacts,
  period,
  domain = 'all',
  relativeWindowHint = false
}) {
  const salience = scoreCanonicalTimingSalience(compactFacts, domain);
  const direction = inferCanonicalTimingDirection(compactFacts);
  return {
    period,
    salience,
    direction,
    relativeWindowHint: Boolean(relativeWindowHint),
    canonicalEngineFact: true
  };
}

function parseMonthFromLabel(label) {
  const match = String(label || '').match(/(?:^|\D)(1[0-2]|0?[1-9])\s*월/u);
  return match ? Number(match[1]) : null;
}

function parseYearFromLabel(label) {
  const match = String(label || '').match(/(19\d{2}|20\d{2}|2100)/u);
  return match ? Number(match[1]) : null;
}

export function buildRelativeWindowRankingHints(relativeWindows, {
  targetYears = [],
  referenceYear = null
} = {}) {
  const yearRank = new Map();
  const monthRank = new Map();

  const bumpYear = (year, rank) => {
    if (!Number.isFinite(year)) return;
    const prev = yearRank.get(year);
    if (prev === undefined || rank < prev) yearRank.set(year, rank);
  };

  const bumpMonth = (year, month, rank) => {
    if (!Number.isFinite(year) || !Number.isFinite(month)) return;
    const key = `${year}-${month}`;
    const prev = monthRank.get(key);
    if (prev === undefined || rank < prev) monthRank.set(key, rank);
  };

  const annual = relativeWindows?.annual;
  if (annual && !annual.flat) {
    annual.relativelyStronger?.forEach((entry, index) => {
      bumpYear(parseYearFromLabel(entry?.label), index);
    });
  }

  for (const bucket of relativeWindows?.monthly || []) {
    const year = numberOrNull(bucket?.year);
    if (!year) continue;
    const projection =
      year === referenceYear
        ? bucket.fromReferenceMonth
        : bucket.all;
    if (!projection || projection.flat) continue;
    projection.relativelyStronger?.forEach((entry, index) => {
      bumpMonth(year, parseMonthFromLabel(entry?.label), index);
    });
  }

  for (const year of targetYears) {
    if (!yearRank.has(year)) yearRank.set(year, 50);
  }

  return {
    source: relativeWindows?.source || null,
    canonicalEngineFact: false,
    yearRank,
    monthRank
  };
}

function hasDirectionalContrast(pool, supportiveCandidates) {
  if (!supportiveCandidates.length) return false;
  const salientPool = pool.filter((item) => item.salience.score >= MIN_SALIENCE_SCORE);
  if (salientPool.length < 2) return false;
  const hasNonSupportive = salientPool.some(
    (item) => item.direction.value !== 'supportive'
  );
  if (!hasNonSupportive) return false;
  return true;
}

function sortFavorableCandidates(candidates) {
  return [...candidates].sort((a, b) => {
    if (b.salience.score !== a.salience.score) {
      return b.salience.score - a.salience.score;
    }
    const hintA = a.relativeWindowHint ? 1 : 0;
    const hintB = b.relativeWindowHint ? 1 : 0;
    return hintB - hintA;
  });
}

function selectTimingMonthCandidates({
  cycles,
  targetYears,
  domain,
  hints,
  referenceYear,
  referenceMonth
}) {
  const pool = [];

  for (const year of targetYears) {
    for (const raw of listMonthCycles(cycles, year)) {
      const month = numberOrNull(raw?.month);
      if (!Number.isFinite(month)) continue;
      if (
        year === referenceYear &&
        Number.isFinite(referenceMonth) &&
        month < referenceMonth
      ) {
        continue;
      }
      const facts = compactCycle(raw, 'month');
      const period = `${year}-${String(month).padStart(2, '0')}`;
      const relativeWindowHint = hints.monthRank.has(`${year}-${month}`);
      pool.push({
        year,
        month,
        facts,
        ...buildPeriodCandidate({
          compactFacts: facts,
          period,
          domain,
          relativeWindowHint
        })
      });
    }
  }

  const salient = pool.filter((item) => item.salience.score >= MIN_SALIENCE_SCORE);
  const supportive = salient.filter(
    (item) => item.direction.value === 'supportive'
  );
  const timingMonthExplainable = salient.length > 0;
  const timingMonthDirectional =
    hasDirectionalContrast(salient, supportive);

  const highlights = timingMonthDirectional
    ? sortFavorableCandidates(supportive).slice(0, MAX_TIMING_MONTH_HIGHLIGHTS)
    : [];

  return {
    pool,
    highlights,
    timingMonthExplainable,
    timingMonthDirectional
  };
}

function selectTimingYearCandidates({
  cycles,
  targetYears,
  domain,
  hints
}) {
  const pool = targetYears.map((year) => {
    const facts = compactCycle(findYearCycle(cycles, year), 'year');
    const relativeWindowHint = hints.yearRank.has(year);
    return {
      year,
      facts,
      ...buildPeriodCandidate({
        compactFacts: facts,
        period: String(year),
        domain,
        relativeWindowHint
      })
    };
  });

  const salient = pool.filter((item) => item.salience.score >= MIN_SALIENCE_SCORE);
  const supportive = salient.filter(
    (item) => item.direction.value === 'supportive'
  );
  const timingYearExplainable = salient.length > 0;
  const timingYearDirectional =
    hasDirectionalContrast(salient, supportive);

  const highlights = timingYearDirectional
    ? sortFavorableCandidates(supportive).slice(0, MAX_TIMING_YEAR_HIGHLIGHTS)
    : [];

  return {
    pool,
    highlights,
    timingYearExplainable,
    timingYearDirectional
  };
}

function resolveTimingFallbackLevel({
  timingMonthDirectional,
  timingYearDirectional,
  timingMonthExplainable,
  timingYearExplainable
}) {
  if (timingMonthDirectional) return 'month';
  if (timingYearDirectional) return 'year';
  if (timingYearExplainable || timingMonthExplainable) return 'daewoon';
  return 'undifferentiated';
}

export function selectRelevantSajuEvidence({
  engineFacts = null,
  focus = null,
  counselingFactContext = null,
  maxItems = MAX_EVIDENCE_ITEMS
} = {}) {
  const emptyTiming = {
    timingMonthExplainable: false,
    timingMonthDirectional: false,
    timingYearExplainable: false,
    timingYearDirectional: false,
    timingFallbackLevel: 'undifferentiated',
    timingMonthGrounded: false,
    timingYearGrounded: false,
    timingGrounded: false
  };

  const empty = {
    schemaVersion: COUNSELING_EVIDENCE_SELECTOR_VERSION,
    domain: focus?.domain || 'all',
    task: focus?.task || 'general',
    evidence: [],
    ...emptyTiming
  };

  if (
    !engineFacts ||
    engineFacts.schemaVersion !== 'engine_facts_v1'
  ) {
    return empty;
  }

  const cycles = engineFacts.cycles || {};
  const reference = cycles.reference || {};
  const refYear = numberOrNull(reference.year) || new Date().getUTCFullYear();
  const refMonth = numberOrNull(reference.month);
  const domain = focus?.domain || 'all';
  const task = focus?.task || 'general';
  const timeline = counselingFactContext?.timeline || null;
  const items = [];

  const push = (item) => {
    if (item) items.push(item);
  };

  push(makeEvidenceItem({
    id: 'natal-core',
    scope: 'natal',
    period: 'natal',
    facts: pickNatalEvidence(engineFacts),
    selectionRole: 'context'
  }));

  const domainNatal = pickDomainNatalEvidence(engineFacts, domain);
  push(makeEvidenceItem({
    id: 'natal-domain',
    scope: 'natal',
    period: 'natal',
    facts: domainNatal,
    selectionRole: 'context'
  }));

  if (domain === 'all' || focus?.coverageIntent === 'overall') {
    push(makeEvidenceItem({
      id: 'natal-overall',
      scope: 'natal',
      period: 'natal',
      facts: pickOverallNatalEvidence(engineFacts),
      selectionRole: 'context'
    }));
  }

  const daewoonRaw = timeline?.currentDaewoon
    ? cycles.daewoon?.find?.(
        (cycle) =>
          numberOrNull(cycle?.index) ===
          numberOrNull(timeline.currentDaewoon.index)
      ) || findDaewoon(cycles, refYear)
    : findDaewoon(cycles, refYear);

  const daewoonFacts = compactCycle(daewoonRaw, 'daewoon');
  push(makeEvidenceItem({
    id: 'daewoon-current',
    scope: 'daewoon',
    period: periodLabel(daewoonFacts),
    facts: daewoonFacts,
    selectionRole: 'context',
    periodCandidate: buildPeriodCandidate({
      compactFacts: daewoonFacts,
      period: periodLabel(daewoonFacts),
      domain
    })
  }));

  const explicitYears = (focus?.targetYears || [])
    .map(numberOrNull)
    .filter(Boolean);
  const overallAsk = domain === 'all' || focus?.coverageIntent === 'overall';
  const targetYears = (explicitYears.length
    ? (overallAsk && explicitYears.length === 1 && !explicitYears.includes(refYear)
      ? [...new Set([refYear, ...explicitYears])]
      : explicitYears)
    : overallAsk
      ? [refYear, refYear + 1]
      : [refYear]
  ).slice(0, 3);

  const requestedMonths = (
    Array.isArray(focus?.targetMonths) && focus.targetMonths.length
      ? focus.targetMonths
      : numberOrNull(focus?.targetMonth)
        ? [Number(focus.targetMonth)]
        : []
  ).map(numberOrNull).filter((month) => month >= 1 && month <= 12);

  const needsTimingCycles =
    task === 'timing' ||
    (task === 'explanation' && focus?.inherited) ||
    explicitYears.length > 0 ||
    requestedMonths.length > 0 ||
    overallAsk;

  let timingFlags = { ...emptyTiming };

  if (
    needsTimingCycles ||
    domain === 'wealth' ||
    domain === 'cycles'
  ) {
    const hints = buildRelativeWindowRankingHints(
      timeline?.relativeWindows,
      {
        targetYears,
        referenceYear: refYear
      }
    );

    const yearSelection = selectTimingYearCandidates({
      cycles,
      targetYears,
      domain,
      hints
    });
    const monthSelection = selectTimingMonthCandidates({
      cycles,
      targetYears,
      domain,
      hints,
      referenceYear: refYear,
      referenceMonth: refMonth
    });

    if (needsTimingCycles) {
      timingFlags = {
        timingMonthExplainable: monthSelection.timingMonthExplainable,
        timingMonthDirectional: monthSelection.timingMonthDirectional,
        timingYearExplainable: yearSelection.timingYearExplainable,
        timingYearDirectional: yearSelection.timingYearDirectional,
        timingFallbackLevel: resolveTimingFallbackLevel({
          timingMonthDirectional: monthSelection.timingMonthDirectional,
          timingYearDirectional: yearSelection.timingYearDirectional,
          timingMonthExplainable: monthSelection.timingMonthExplainable,
          timingYearExplainable: yearSelection.timingYearExplainable
        }),
        timingMonthGrounded: monthSelection.timingMonthDirectional,
        timingYearGrounded: yearSelection.timingYearDirectional,
        timingGrounded: monthSelection.timingMonthDirectional
      };
    }

    const existingIds = () => new Set(items.filter(Boolean).map((item) => item.id));

    const pushYear = (entry, selectionRole) => {
      if (!entry?.facts) return;
      const id = `year-${entry.year}`;
      if (existingIds().has(id) || existingIds().has(`${id}-context`)) return;
      push(makeEvidenceItem({
        id,
        scope: 'year',
        period: String(entry.year),
        facts: entry.facts,
        selectionRole,
        periodCandidate: {
          period: String(entry.year),
          salience: entry.salience,
          direction: entry.direction,
          relativeWindowHint: entry.relativeWindowHint,
          canonicalEngineFact: true
        }
      }));
    };

    const pushMonth = (entry, selectionRole) => {
      if (!entry?.facts) return;
      const id = `month-${entry.year}-${String(entry.month).padStart(2, '0')}`;
      if (existingIds().has(id) || existingIds().has(`${id}-context`)) return;
      push(makeEvidenceItem({
        id,
        scope: 'month',
        period: `${entry.year}-${String(entry.month).padStart(2, '0')}`,
        facts: entry.facts,
        selectionRole,
        periodCandidate: {
          period: `${entry.year}-${String(entry.month).padStart(2, '0')}`,
          salience: entry.salience,
          direction: entry.direction,
          relativeWindowHint: entry.relativeWindowHint,
          canonicalEngineFact: true
        }
      }));
    };

    const requestedKeys = requestedPeriodKeys(focus, refYear);
    for (const key of requestedKeys) {
      if (key.startsWith('year-')) {
        const year = Number(key.slice(5));
        const entry = yearSelection.pool.find((item) => item.year === year);
        if (entry) pushYear(entry, 'requested');
      }
      if (key.startsWith('month-')) {
        const match = key.match(/^month-(\d{4})-(\d{2})$/);
        if (!match) continue;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const entry = monthSelection.pool.find(
          (item) => item.year === year && item.month === month
        );
        if (entry) pushMonth(entry, 'requested');
      }
    }

    if (needsTimingCycles) {
      for (const entry of yearSelection.highlights) {
        pushYear(entry, 'highlight');
      }
      for (const entry of monthSelection.highlights) {
        pushMonth(entry, 'highlight');
      }

      const contextualYears = yearSelection.pool.filter(
        (entry) =>
          entry.salience.score >= MIN_SALIENCE_SCORE &&
          !existingIds().has(`year-${entry.year}`)
      );
      for (const entry of contextualYears.slice(0, overallAsk ? 2 : 1)) {
        pushYear(entry, 'context');
      }

      if (
        !monthSelection.timingMonthDirectional &&
        !yearSelection.timingYearDirectional
      ) {
        const explainableMonths = monthSelection.pool
          .filter((item) => item.salience.score >= MIN_SALIENCE_SCORE)
          .slice(0, 1);
        for (const entry of explainableMonths) {
          pushMonth(entry, 'context');
        }
      }
    } else if (domain === 'wealth' || domain === 'cycles') {
      const primaryYear = targetYears[0] ?? refYear;
      const entry = yearSelection.pool.find((item) => item.year === primaryYear)
        || {
          year: primaryYear,
          facts: compactCycle(findYearCycle(cycles, primaryYear), 'year'),
          ...buildPeriodCandidate({
            compactFacts: compactCycle(findYearCycle(cycles, primaryYear), 'year'),
            period: String(primaryYear),
            domain
          })
        };
      pushYear(entry, 'context');
    }
  }

  const filtered = items.filter(Boolean);
  const required = [];
  const rest = [];
  for (const item of filtered) {
    if (
      item.selectionRole === 'requested' ||
      item.id === 'natal-core' ||
      item.id === 'natal-domain' ||
      item.id === 'natal-overall' ||
      item.id === 'daewoon-current'
    ) {
      required.push(item);
    } else {
      rest.push(item);
    }
  }
  const budget = Math.max(required.length, Math.min(MAX_EVIDENCE_ITEMS, maxItems));
  const evidence = [...required, ...rest].slice(0, budget);

  return {
    schemaVersion: COUNSELING_EVIDENCE_SELECTOR_VERSION,
    domain,
    task,
    evidence,
    ...timingFlags
  };
}

export default Object.freeze({
  COUNSELING_EVIDENCE_SELECTOR_VERSION,
  selectRelevantSajuEvidence,
  pickDomainNatalEvidence,
  pickOverallNatalEvidence,
  scoreCanonicalTimingSalience,
  scoreCanonicalTimingExplainability,
  inferCanonicalTimingDirection,
  buildPeriodCandidate,
  buildRelativeWindowRankingHints
});
