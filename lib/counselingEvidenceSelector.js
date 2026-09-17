import { compactCycle } from './counselingFactContext.js';

export const COUNSELING_EVIDENCE_SELECTOR_VERSION =
  'counseling_evidence_selector_v2';

const MIN_MONTH_EXPLAIN_SCORE = 2;
const MIN_YEAR_EXPLAIN_SCORE = 2;
const MAX_EVIDENCE_ITEMS = 5;
const MAX_TIMING_MONTH_HIGHLIGHTS = 2;

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
  explainability = null
}) {
  if (!facts) return null;
  return {
    id,
    source: 'engine',
    scope,
    period,
    facts,
    selectionRole,
    explainability
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

export function scoreCanonicalTimingExplainability(compactFacts, domain = 'all') {
  if (!compactFacts || typeof compactFacts !== 'object') {
    return { score: 0, signals: [] };
  }

  const signals = [];
  let score = 0;

  const yongsin = compactFacts.usefulGodImpact?.yongsinImpact;
  if (
    yongsin?.availability === 'increased' ||
    yongsin?.blocked === true ||
    yongsin?.overloaded === true
  ) {
    score += 2;
    signals.push('yongsinImpact');
  }

  const gisin = compactFacts.usefulGodImpact?.gisinImpact;
  if (gisin?.activated === true) {
    score += 1;
    signals.push('gisinImpact');
  }

  if (compactFacts.balanceImpact?.effect && compactFacts.balanceImpact.effect !== 'neutral') {
    score += 1;
    signals.push('balanceImpact');
  }

  const relationCount = Array.isArray(compactFacts.relationsWithNatal)
    ? compactFacts.relationsWithNatal.length
    : 0;
  if (relationCount > 0) {
    score += Math.min(2, relationCount);
    signals.push('relationsWithNatal');
  }

  if (domain === 'wealth' && compactFacts.tenGod?.group === 'wealth') {
    score += 1;
    signals.push('tenGodWealth');
  }

  if (compactFacts.twelveStage?.stage) {
    score += 1;
    signals.push('twelveStage');
  }

  return { score, signals };
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
  referenceYear = null,
  referenceMonth = null
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

function monthSortKey(year, month, explain, hints) {
  const hintRank = hints.monthRank.get(`${year}-${month}`) ?? 100;
  return [hintRank, -explain.score, month];
}

function selectTimingMonthHighlights({
  cycles,
  targetYears,
  domain,
  hints,
  referenceYear,
  referenceMonth
}) {
  const candidates = [];

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
      const explain = scoreCanonicalTimingExplainability(facts, domain);
      candidates.push({ year, month, facts, explain });
    }
  }

  if (!candidates.length) {
    return { highlights: [], timingMonthGrounded: false };
  }

  candidates.sort((a, b) => {
    const keyA = monthSortKey(a.year, a.month, a.explain, hints);
    const keyB = monthSortKey(b.year, b.month, b.explain, hints);
    for (let index = 0; index < keyA.length; index += 1) {
      if (keyA[index] !== keyB[index]) return keyA[index] - keyB[index];
    }
    return 0;
  });

  const qualifying = candidates.filter(
    (item) => item.explain.score >= MIN_MONTH_EXPLAIN_SCORE
  );

  if (!qualifying.length) {
    return { highlights: [], timingMonthGrounded: false };
  }

  const topScore = qualifying[0].explain.score;
  const distinctScores = new Set(
    qualifying.slice(0, 6).map((item) => item.explain.score)
  );
  const discriminative =
    distinctScores.size > 1 ||
    topScore >= MIN_MONTH_EXPLAIN_SCORE + 1;

  if (!discriminative) {
    return { highlights: [], timingMonthGrounded: false };
  }

  const highlights = qualifying
    .slice(0, MAX_TIMING_MONTH_HIGHLIGHTS)
    .map((item) => ({
      ...item,
      relativeWindowHint:
        hints.monthRank.has(`${item.year}-${item.month}`) || false
    }));

  return {
    highlights,
    timingMonthGrounded: true
  };
}

function selectTimingYearHighlights({
  cycles,
  targetYears,
  domain,
  hints
}) {
  const highlights = [];

  for (const year of targetYears) {
    const facts = compactCycle(findYearCycle(cycles, year), 'year');
    const explain = scoreCanonicalTimingExplainability(facts, domain);
    highlights.push({
      year,
      facts,
      explain,
      relativeWindowHint: hints.yearRank.has(year) || false,
      hintRank: hints.yearRank.get(year) ?? 100
    });
  }

  highlights.sort((a, b) => {
    if (a.hintRank !== b.hintRank) return a.hintRank - b.hintRank;
    return b.explain.score - a.explain.score;
  });

  const qualifying = highlights.filter(
    (item) => item.explain.score >= MIN_YEAR_EXPLAIN_SCORE
  );

  return {
    highlights: qualifying.slice(0, 2),
    timingYearGrounded: qualifying.length > 0
  };
}

export function selectRelevantSajuEvidence({
  engineFacts = null,
  focus = null,
  counselingFactContext = null,
  maxItems = MAX_EVIDENCE_ITEMS
} = {}) {
  const empty = {
    schemaVersion: COUNSELING_EVIDENCE_SELECTOR_VERSION,
    domain: focus?.domain || 'all',
    task: focus?.task || 'general',
    evidence: [],
    timingGrounded: false,
    timingYearGrounded: false,
    timingMonthGrounded: false
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

  push(makeEvidenceItem({
    id: 'daewoon-current',
    scope: 'daewoon',
    period: periodLabel(compactCycle(daewoonRaw, 'daewoon')),
    facts: compactCycle(daewoonRaw, 'daewoon'),
    selectionRole: 'context'
  }));

  const targetYears = (focus?.targetYears?.length
    ? focus.targetYears
    : [refYear, refYear + 1]
  ).slice(0, 2);

  const needsTimingCycles =
    task === 'timing' ||
    (task === 'explanation' && focus?.inherited);

  let timingYearGrounded = false;
  let timingMonthGrounded = false;

  if (
    needsTimingCycles ||
    domain === 'wealth' ||
    domain === 'cycles'
  ) {
    const hints = buildRelativeWindowRankingHints(
      timeline?.relativeWindows,
      {
        targetYears,
        referenceYear: refYear,
        referenceMonth: refMonth
      }
    );

    if (needsTimingCycles) {
      const yearSelection = selectTimingYearHighlights({
        cycles,
        targetYears,
        domain,
        hints
      });
      timingYearGrounded = yearSelection.timingYearGrounded;

      yearSelection.highlights.forEach((entry) => {
        push(makeEvidenceItem({
          id: `year-${entry.year}`,
          scope: 'year',
          period: String(entry.year),
          facts: entry.facts,
          selectionRole: 'highlight',
          explainability: {
            score: entry.explain.score,
            signals: entry.explain.signals,
            relativeWindowHint: entry.relativeWindowHint,
            canonicalEngineFact: true
          }
        }));
      });

      const monthSelection = selectTimingMonthHighlights({
        cycles,
        targetYears,
        domain,
        hints,
        referenceYear: refYear,
        referenceMonth: refMonth
      });
      timingMonthGrounded = monthSelection.timingMonthGrounded;

      monthSelection.highlights.forEach((entry) => {
        push(makeEvidenceItem({
          id: `month-${entry.year}-${entry.month}`,
          scope: 'month',
          period: `${entry.year}-${String(entry.month).padStart(2, '0')}`,
          facts: entry.facts,
          selectionRole: 'highlight',
          explainability: {
            score: entry.explain.score,
            signals: entry.explain.signals,
            relativeWindowHint: entry.relativeWindowHint,
            canonicalEngineFact: true
          }
        }));
      });
    } else if (domain === 'wealth' || domain === 'cycles') {
      const primaryYear = targetYears[0] ?? refYear;
      const yearCycle = findYearCycle(cycles, primaryYear);
      push(makeEvidenceItem({
        id: `year-${primaryYear}`,
        scope: 'year',
        period: String(primaryYear),
        facts: compactCycle(yearCycle, 'year'),
        selectionRole: 'context'
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
    timingYearGrounded,
    timingMonthGrounded,
    timingGrounded: timingMonthGrounded
  };
}

export default Object.freeze({
  COUNSELING_EVIDENCE_SELECTOR_VERSION,
  selectRelevantSajuEvidence,
  scoreCanonicalTimingExplainability,
  buildRelativeWindowRankingHints
});
