export const COUNSELING_FACT_CONTEXT_VERSION =
  'sajugrap_counseling_fact_context_v1';

const DOMAIN_PATTERNS = Object.freeze([
  ['재물운', /(금전|재물|돈|수입|매출|정산|입금|재정|자산|부채|현금)/u],
  ['사업운', /(사업|직장|직업|이직|취업|업무|회사|프로젝트|창업|커리어)/u],
  ['연애운', /(연애|결혼|배우자|남편|아내|애인|파트너|관계)/u],
  ['심신운', /(건강|심신|마음|불안|수면|회복|스트레스|피로)/u]
]);

const TIMELINE_PATTERN =
  /(언제|시기|흐름|풀릴|풀리|좋아질|나아질|전환|변화|과거|예전|앞으로|향후|올해|금년|내년|내후년|작년|지난해|재작년|연운|월운|대운|몇\s*월|\d{4}\s*년)/u;

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function uniqueNumbers(values) {
  return [...new Set(values.filter(Number.isFinite))].sort((a, b) => a - b);
}

function recentUserText(history = []) {
  return (Array.isArray(history) ? history : [])
    .filter((item) => item?.role === 'user')
    .slice(-4)
    .map((item) => String(item?.text || '').trim())
    .filter(Boolean)
    .join('\n');
}

function findDomain(text, fallback = '총운') {
  for (const [domain, pattern] of DOMAIN_PATTERNS) {
    if (pattern.test(text)) return domain;
  }
  return fallback || '총운';
}

export function analyzeCounselingIntent({
  userMessage = '',
  history = [],
  referenceYear,
  selectedDomain = '총운'
} = {}) {
  const currentText = String(userMessage || '').trim();
  const conversationText = `${recentUserText(history)}\n${currentText}`.trim();
  const refYear = numberOrNull(referenceYear) ?? new Date().getUTCFullYear();
  const explicitYears = [...currentText.matchAll(/(19\d{2}|20\d{2}|2100)\s*년?/gu)]
    .map((match) => Number(match[1]));
  const relativeYears = [];

  if (/(올해|금년)/u.test(currentText)) relativeYears.push(refYear);
  if (/내후년/u.test(currentText)) relativeYears.push(refYear + 2);
  if (/내년/u.test(currentText)) relativeYears.push(refYear + 1);
  if (/(작년|지난해)/u.test(currentText)) relativeYears.push(refYear - 1);
  if (/재작년/u.test(currentText)) relativeYears.push(refYear - 2);

  const timelineRequested = TIMELINE_PATTERN.test(currentText);
  const monthRequested = /(월운|몇\s*월|\d{1,2}\s*월)/u.test(currentText);
  const targetMonthMatch = currentText.match(/(?:^|\D)(1[0-2]|0?[1-9])\s*월/u);
  const targetMonth = targetMonthMatch ? Number(targetMonthMatch[1]) : null;
  const yearRequested = /(연운|올해|금년|내년|내후년|작년|지난해|재작년|\d{4}\s*년)/u.test(currentText)
    || (timelineRequested && !monthRequested);
  const daewoonRequested = /대운/u.test(currentText) || /인생|장기|큰\s*흐름/u.test(currentText);
  const wantsPast = /(과거|예전|이전|작년|지난해|재작년|지나온|전에는)/u.test(currentText);
  const wantsFuture = /(앞으로|향후|언제|내년|내후년|풀릴|좋아질|나아질)/u.test(currentText);
  const targetYears = uniqueNumbers([...explicitYears, ...relativeYears]);
  const domain = findDomain(currentText, findDomain(conversationText, selectedDomain));

  return {
    schemaVersion: COUNSELING_FACT_CONTEXT_VERSION,
    timelineRequested,
    monthSpecific: monthRequested,
    targetMonth,
    requestedGranularities: [
      ...(daewoonRequested ? ['daewoon'] : []),
      ...(yearRequested ? ['year'] : []),
      ...((monthRequested || timelineRequested) ? ['month'] : [])
    ],
    targetYears,
    wantsPast,
    wantsFuture,
    domain,
    purpose: timelineRequested || /(사주|용신|기신|십신|합충|운세|운이|재물운|금전운|사업운|연애운|심신운)/u.test(currentText)
      ? 'saju_interpretation'
      : 'counseling_reference'
  };
}

function compactRelation(relation) {
  if (!relation || typeof relation !== 'object') return null;
  return {
    type: relation.relationType ?? null,
    complete: relation.complete ?? null,
    transformation: relation.transformation?.status ?? null,
    targetElement: relation.transformation?.targetElement ?? null
  };
}

export function compactCycle(cycle, fallbackType = null) {
  if (!cycle || typeof cycle !== 'object') return null;
  return {
    cycleType: cycle.cycleType ?? fallbackType,
    index: numberOrNull(cycle.index),
    year: numberOrNull(cycle.year),
    month: numberOrNull(cycle.month),
    startYear: numberOrNull(cycle.startYear),
    endYear: numberOrNull(cycle.endYear),
    ageRange: cycle.ageRange && typeof cycle.ageRange === 'object'
      ? {
          start: numberOrNull(cycle.ageRange.start),
          end: numberOrNull(cycle.ageRange.end)
        }
      : null,
    referenceSolarDate: cycle.referenceSolarDate ?? null,
    startSolarDate: cycle.startSolarDate ?? null,
    boundaryPolicy: cycle.boundaryPolicy ?? null,
    ganzhi: cycle.ganzhi ?? null,
    stem: cycle.stem ?? null,
    branch: cycle.branch ?? null,
    tenGod: cycle.tenGod
      ? {
          tenGodKo: cycle.tenGod.tenGodKo ?? null,
          group: cycle.tenGod.group ?? null
        }
      : null,
    hiddenTenGodGroups: Array.isArray(cycle.hiddenTenGods)
      ? [...new Set(cycle.hiddenTenGods.map((item) => item?.group).filter(Boolean))]
      : [],
    twelveStage: cycle.twelveStage
      ? {
          stage: cycle.twelveStage.stage ?? null,
          stageKey: cycle.twelveStage.stageKey ?? null
        }
      : null,
    relationsWithNatal: Array.isArray(cycle.relationsWithNatal)
      ? cycle.relationsWithNatal.map(compactRelation).filter(Boolean).slice(0, 12)
      : [],
    relationsWithParentCycles: Array.isArray(cycle.relationsWithParentCycles)
      ? cycle.relationsWithParentCycles.map(compactRelation).filter(Boolean).slice(0, 12)
      : [],
    usefulGodImpact: cycle.usefulGodImpact
      ? {
          yongsinImpact: cycle.usefulGodImpact.yongsinImpact ?? null,
          gisinImpact: cycle.usefulGodImpact.gisinImpact ?? null
        }
      : null,
    balanceImpact: cycle.balanceImpact
      ? {
          dominantImbalance: cycle.balanceImpact.dominantImbalance ?? null,
          effect: cycle.balanceImpact.effect ?? null
        }
      : null,
    wavePhase: cycle.wavePhase ?? null
  };
}

function projectionFor(cyclesData, key) {
  const source = cyclesData?.[key];
  if (!source || !Array.isArray(source.labels)) return null;
  const length = source.labels.length;
  const copy = (name) => Array.isArray(source[name])
    ? source[name].slice(0, length).map((value) => numberOrNull(value))
    : [];
  return {
    source: 'ui_compatibility_wave_projection',
    canonicalEngineFact: false,
    warning: '이 점수는 전통 명리 Fact나 실제 사건의 확률이 아니며, 비교용 휴리스틱이다.',
    labels: source.labels.slice(0, length).map((label) => String(label)),
    total: copy('total'),
    career: copy('career'),
    wealth: copy('wealth'),
    mental: copy('mental'),
    love: copy('love')
  };
}

function normalizeContexts(sajuContext) {
  const values = [
    {
      engineFacts: sajuContext?.engineFacts,
      cyclesData: sajuContext?.cyclesData
    },
    ...(Array.isArray(sajuContext?.timelineContexts)
      ? sajuContext.timelineContexts.slice(0, 4)
      : [])
  ];
  const byYear = new Map();
  for (const value of values) {
    const facts = value?.engineFacts;
    const year = numberOrNull(facts?.cycles?.reference?.year);
    if (!facts || !year || byYear.has(year)) continue;
    byYear.set(year, {
      referenceYear: year,
      engineFacts: facts,
      cyclesData: value?.cyclesData || null
    });
  }
  return [...byYear.values()].sort((a, b) => a.referenceYear - b.referenceYear);
}

function currentDaewoon(cycles, year) {
  const list = Array.isArray(cycles?.daewoon) ? cycles.daewoon : [];
  return list.find((cycle) =>
    numberOrNull(cycle?.startYear) <= year && numberOrNull(cycle?.endYear) >= year
  ) || null;
}

function pickProjectionDomain(projection, domain) {
  return ({
    총운: 'total',
    사업운: 'career',
    재물운: 'wealth',
    심신운: 'mental',
    연애운: 'love'
  })[domain] || 'total';
}

export function buildCounselingFactContext({
  sajuContext = {},
  userMessage = '',
  history = [],
  selectedDomain = '총운'
} = {}) {
  const contexts = normalizeContexts(sajuContext);
  const primary = contexts.find((item) => item.engineFacts === sajuContext?.engineFacts) || contexts[0] || null;
  const reference = primary?.engineFacts?.cycles?.reference || {};
  const referenceYear = numberOrNull(reference.year);
  const intent = analyzeCounselingIntent({
    userMessage,
    history,
    referenceYear,
    selectedDomain
  });

  if (!primary || !intent.timelineRequested) {
    return {
      intent,
      timeline: null
    };
  }

  const primaryCycles = primary.engineFacts.cycles || {};
  const annual = (Array.isArray(primaryCycles.year) ? primaryCycles.year : [])
    .map((cycle) => compactCycle(cycle, 'year'))
    .filter(Boolean);
  const daewoon = (Array.isArray(primaryCycles.daewoon) ? primaryCycles.daewoon : [])
    .map((cycle) => compactCycle(cycle, 'daewoon'))
    .filter(Boolean);

  const requestedYears = intent.targetYears.length
    ? intent.targetYears
    : uniqueNumbers([
        referenceYear,
        intent.wantsPast ? referenceYear - 1 : null,
        intent.wantsFuture ? referenceYear + 1 : null
      ]);

  const monthly = [];
  for (const context of contexts) {
    if (requestedYears.length && !requestedYears.includes(context.referenceYear)) continue;
    const cycles = Array.isArray(context.engineFacts?.cycles?.month)
      ? context.engineFacts.cycles.month
      : [];
    monthly.push({
      year: context.referenceYear,
      cycles: cycles.map((cycle) => compactCycle(cycle, 'month')).filter(Boolean),
      projection: projectionFor(context.cyclesData, 'month')
    });
  }

  const availableMonthlyYears = uniqueNumbers(monthly.map((item) => item.year));
  const missingMonthlyYears = requestedYears.filter((year) => !availableMonthlyYears.includes(year));
  const annualYears = annual.map((cycle) => cycle.year).filter(Number.isFinite);
  const annualProjection = projectionFor(primary.cyclesData, 'year');
  const projectionDomain = pickProjectionDomain(annualProjection, intent.domain);

  return {
    intent,
    timeline: {
      schemaVersion: COUNSELING_FACT_CONTEXT_VERSION,
      reference: {
        year: referenceYear,
        month: numberOrNull(reference.month),
        day: numberOrNull(reference.day),
        hour: numberOrNull(reference.hour),
        timezone: reference.timezone ?? null
      },
      selectedDomain: intent.domain,
      currentDaewoon: compactCycle(currentDaewoon(primaryCycles, referenceYear), 'daewoon'),
      daewoon,
      annual,
      monthly,
      coverage: {
        annualFrom: annualYears.length ? Math.min(...annualYears) : null,
        annualTo: annualYears.length ? Math.max(...annualYears) : null,
        monthlyYears: availableMonthlyYears,
        missingMonthlyYears
      },
      projection: {
        annual: annualProjection,
        selectedDomainKey: projectionDomain
      },
      fieldSemantics: {
        'usefulGodImpact.gisinImpact.activated':
          '해당 구간의 천간 또는 지지 오행이 엔진의 기신 오행과 일치하는지 나타낸다. 재성·재물 기능의 활성 여부가 아니며, false를 길운 또는 재물 회복으로 뒤집어 해석하지 않는다.',
        'usefulGodImpact.yongsinImpact.availability':
          '해당 구간의 천간 또는 지지 오행이 엔진의 용신 오행과 일치하는지 나타낸다. 실제 사건의 성공이나 수입을 보장하지 않는다.',
        waveProjection:
          'UI 호환 파동 점수는 비교용 휴리스틱이며 전통 명리 Fact, 실제 사건, 수익률 또는 발생 확률이 아니다.'
      }
    }
  };
}

export function requestedSupplementalYears({
  userMessage = '',
  history = [],
  referenceYear,
  selectedDomain = '총운'
} = {}) {
  const intent = analyzeCounselingIntent({
    userMessage,
    history,
    referenceYear,
    selectedDomain
  });
  if (!intent.timelineRequested) return [];
  const refYear = numberOrNull(referenceYear);
  const candidates = intent.targetYears.length
    ? intent.targetYears
    : uniqueNumbers([
        intent.wantsPast ? refYear - 1 : null,
        intent.wantsFuture ? refYear + 1 : null
      ]);
  return candidates
    .filter((year) => year !== refYear && year >= 1900 && year <= 2100)
    .slice(0, 3);
}

export default Object.freeze({
  COUNSELING_FACT_CONTEXT_VERSION,
  analyzeCounselingIntent,
  buildCounselingFactContext,
  compactCycle,
  requestedSupplementalYears
});
