import { compactCycle } from './counselingFactContext.js';

export const COUNSELING_EVIDENCE_SELECTOR_VERSION =
  'counseling_evidence_selector_v3';

const MIN_SALIENCE_SCORE = 2;
const MAX_EVIDENCE_ITEMS = 5;
const MAX_TIMING_MONTH_HIGHLIGHTS = 2;
const MAX_TIMING_YEAR_HIGHLIGHTS = 2;

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

  const targetYears = (focus?.targetYears?.length
    ? focus.targetYears
    : [refYear, refYear + 1]
  ).slice(0, 2);

  const needsTimingCycles =
    task === 'timing' ||
    (task === 'explanation' && focus?.inherited);

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

    if (needsTimingCycles) {
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

      for (const entry of yearSelection.highlights) {
        push(makeEvidenceItem({
          id: `year-${entry.year}`,
          scope: 'year',
          period: String(entry.year),
          facts: entry.facts,
          selectionRole: 'highlight',
          periodCandidate: {
            period: String(entry.year),
            salience: entry.salience,
            direction: entry.direction,
            relativeWindowHint: entry.relativeWindowHint,
            canonicalEngineFact: true
          }
        }));
      }

      for (const entry of monthSelection.highlights) {
        push(makeEvidenceItem({
          id: `month-${entry.year}-${entry.month}`,
          scope: 'month',
          period: `${entry.year}-${String(entry.month).padStart(2, '0')}`,
          facts: entry.facts,
          selectionRole: 'highlight',
          periodCandidate: {
            period: `${entry.year}-${String(entry.month).padStart(2, '0')}`,
            salience: entry.salience,
            direction: entry.direction,
            relativeWindowHint: entry.relativeWindowHint,
            canonicalEngineFact: true
          }
        }));
      }

      const contextualYears = yearSelection.pool.filter(
        (entry) =>
          entry.salience.score >= MIN_SALIENCE_SCORE &&
          !yearSelection.highlights.some((item) => item.year === entry.year)
      );
      for (const entry of contextualYears.slice(0, 1)) {
        push(makeEvidenceItem({
          id: `year-${entry.year}-context`,
          scope: 'year',
          period: String(entry.year),
          facts: entry.facts,
          selectionRole: 'context',
          periodCandidate: {
            period: String(entry.year),
            salience: entry.salience,
            direction: entry.direction,
            relativeWindowHint: entry.relativeWindowHint,
            canonicalEngineFact: true
          }
        }));
      }

      if (
        !monthSelection.timingMonthDirectional &&
        !yearSelection.timingYearDirectional
      ) {
        const explainableMonths = monthSelection.pool
          .filter((item) => item.salience.score >= MIN_SALIENCE_SCORE)
          .slice(0, 1);
        for (const entry of explainableMonths) {
          push(makeEvidenceItem({
            id: `month-${entry.year}-${entry.month}-context`,
            scope: 'month',
            period: `${entry.year}-${String(entry.month).padStart(2, '0')}`,
            facts: entry.facts,
            selectionRole: 'context',
            periodCandidate: {
              period: `${entry.year}-${String(entry.month).padStart(2, '0')}`,
              salience: entry.salience,
              direction: entry.direction,
              relativeWindowHint: entry.relativeWindowHint,
              canonicalEngineFact: true
            }
          }));
        }
      }
    } else if (domain === 'wealth' || domain === 'cycles') {
      const primaryYear = targetYears[0] ?? refYear;
      const yearCycle = findYearCycle(cycles, primaryYear);
      const facts = compactCycle(yearCycle, 'year');
      push(makeEvidenceItem({
        id: `year-${primaryYear}`,
        scope: 'year',
        period: String(primaryYear),
        facts,
        selectionRole: 'context',
        periodCandidate: buildPeriodCandidate({
          compactFacts: facts,
          period: String(primaryYear),
          domain
        })
      }));
    }
  }

  const evidence = items
    .filter(Boolean)
    .slice(0, Math.max(2, Math.min(MAX_EVIDENCE_ITEMS, maxItems)));

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
  scoreCanonicalTimingSalience,
  scoreCanonicalTimingExplainability,
  inferCanonicalTimingDirection,
  buildPeriodCandidate,
  buildRelativeWindowRankingHints
});
