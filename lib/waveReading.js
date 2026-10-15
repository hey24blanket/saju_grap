// Interpretation vocabulary v1, grounded in the engine's twelve-stage fact.
// This is a cultural reading convention, NOT a forecast or success score.
export const WAVE_VERSION = 'phase-reading-v1';
export const PHASES = Object.freeze({
  gather: { label: '모이는 흐름', verb: '한 가지를 깊게', title: '지금은, 나에게 힘을 모을 때', description: '관심을 한곳에 모으고 이미 시작한 일을 다듬는 흐름으로 읽어요. 속도를 늦추거나 충분히 준비하는 것도 이 흐름을 쓰는 방법이에요.', action: '마음에 걸리는 일 하나를 골라, 다음 한 걸음만 적어보세요.', color: 'var(--color-wave-gather)', spread: 16 },
  unfold: { label: '펼치는 흐름', verb: '새로운 연결을 넓게', title: '지금은, 바깥으로 연결해 볼 때', description: '내 생각을 표현하고 새로운 접점을 만드는 흐름으로 읽어요. 큰 결정을 서두르기보다 작은 시도로 반응을 살펴보세요.', action: '나누고 싶던 생각 하나를 편한 사람에게 전해보세요.', color: 'var(--color-wave-unfold)', spread: 42 },
  transition: { label: '전환하는 흐름', verb: '내 속도를 살피며', title: '지금은, 나의 리듬을 살필 때', description: '안으로 모으는 일과 밖으로 펼치는 일 사이에서 리듬을 조절하는 흐름으로 읽어요. 하던 일을 돌아보고 다음 방향을 천천히 골라도 괜찮아요.', action: '이어갈 것 하나와 잠시 내려놓을 것 하나를 나눠 적어보세요.', color: 'var(--color-wave-transition)', spread: 28 }
});
const STAGES = {
  changsheng: ['unfold', '장생'], muyu: ['unfold', '목욕'], guandai: ['unfold', '관대'], linguan: ['unfold', '건록'], diwang: ['unfold', '제왕'],
  shuai: ['gather', '쇠'], bing: ['gather', '병'], si: ['gather', '사'], mu: ['gather', '묘'], jue: ['gather', '절'], tai: ['gather', '태'], yang: ['transition', '양']
};
export const DOMAINS = Object.freeze({
  all: { label: '전체', gather: '하던 일의 우선순위를 정해보세요.', unfold: '작은 시도로 새로운 접점을 만들어보세요.', transition: '지금의 속도가 나에게 맞는지 살펴보세요.' },
  career: { label: '일과 배움', gather: '새 일을 늘리기 전에 진행 중인 일 하나를 마무리해보세요.', unfold: '다듬은 생각을 공유하고 피드백을 받아보세요.', transition: '계속할 일과 방식을 바꿀 일을 나눠보세요.' },
  wealth: { label: '돈과 생활', gather: '정기 지출과 생활 계획을 차분히 점검해보세요.', unfold: '관심 있는 정보를 모으되 지출 결정은 실제 여건을 먼저 보세요.', transition: '필요한 소비와 잠시 미뤄도 되는 소비를 구분해보세요.' },
  love: { label: '관계', gather: '새로운 만남보다 편한 한 사람과 깊이 이야기해보세요.', unfold: '안부를 전하거나 가벼운 약속으로 연결을 만들어보세요.', transition: '함께하는 시간과 혼자 쉬는 시간의 균형을 살펴보세요.' },
  mental: { label: '나의 리듬', gather: '혼자 조용히 쉬는 시간을 일정에 남겨두세요.', unfold: '산책이나 가벼운 활동으로 일상의 감각을 바꿔보세요.', transition: '몸과 마음의 상태를 짧게 기록해보세요.' }
});
const pad = n => String(n).padStart(2, '0');
export function cycleReading(cycle, index, type) {
  const mapping = STAGES[cycle?.twelveStage?.stageKey];
  if (!mapping) return null;
  const [mode, stage] = mapping;
  const date = cycle.referenceSolarDate || null;
  const label = type === 'day' ? `${cycle.month}월 ${cycle.day}일` : type === 'month' ? `${cycle.month}월 절기 흐름` : type === 'year' ? `${cycle.year}년` : `${cycle.ageRange?.start ?? cycle.startAge ?? cycle.age ?? index * 10}세부터`;
  return { id: `${type}:${index}`, type, index, mode, label, date, year: cycle.year ?? null, month: cycle.month ?? null, day: cycle.day ?? null, startDate: cycle.startSolarDate ?? null,
    evidence: { stage, stageKey: cycle.twelveStage.stageKey, ganzhi: cycle.ganzhi, tenGod: cycle.tenGod?.tenGodKo || null, method: cycle.twelveStage.methodId, version: WAVE_VERSION } };
}
export function buildReading(facts) {
  const ref = facts.cycles.reference;
  const timelines = {};
  for (const type of ['day', 'month', 'year', 'daewoon']) timelines[type] = (facts.cycles[type] || []).map((c, i) => cycleReading(c, i, type)).filter(Boolean);
  const today = timelines.day.find(c => c.day === ref.day && c.month === ref.month && c.year === ref.year) || null;
  const natal = {};
  for (const key of ['year', 'month', 'day', 'hour']) {
    const p = facts.natal[key];
    natal[key] = { ganzhi: p.ganzhi, stem: p.stemKo || p.stem, branch: p.branchKo || p.branch };
  }
  return { version: WAVE_VERSION, referenceDate: `${ref.year}-${pad(ref.month)}-${pad(ref.day)}`, timezone: 'Asia/Seoul', today, timelines, natal, dayMaster: facts.natal.dayMaster, structure: { strength: facts.strength.status, yongsin: facts.usefulGodProfile.yongsin?.element || null, heesin: (facts.usefulGodProfile.heesin || []).map(item => item.element), gisin: (facts.usefulGodProfile.gisin || []).map(item => item.element) } };
}
export function selectedReading(reading, id) {
  return Object.values(reading.timelines).flat().find(c => c.id === id) || null;
}
