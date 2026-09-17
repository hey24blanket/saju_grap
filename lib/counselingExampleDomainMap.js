// Counseling Example v2 corpus canonical domains (Golden JSONL v2_180):
// career, wealth, romance, family, academics, health, realestate, cycles, relationships

export const COUNSELING_EXAMPLE_V2_CANONICAL_DOMAINS = Object.freeze([
  'career',
  'wealth',
  'romance',
  'family',
  'academics',
  'health',
  'realestate',
  'cycles',
  'relationships'
]);

const CHAT_LABEL_TO_V2_CANONICAL = Object.freeze({
  총운: null,
  all: null,

  사업운: 'career',
  직업운: 'career',
  취업운: 'career',
  이직: 'career',
  진로: 'career',

  재물운: 'wealth',
  금전운: 'wealth',
  돈: 'wealth',

  연애운: 'romance',
  애정운: 'romance',

  결혼: 'family',
  가족: 'family',

  학업: 'academics',
  시험: 'academics',
  자격증: 'academics',

  건강운: 'health',
  심신운: 'health',

  부동산: 'realestate',
  계약: 'realestate',

  대운: 'cycles',
  세운: 'cycles',
  '인생 흐름': 'cycles',

  인간관계: 'relationships',
  친구: 'relationships',
  대인관계: 'relationships',

  career: 'career',
  wealth: 'wealth',
  romance: 'romance',
  family: 'family',
  academics: 'academics',
  health: 'health',
  realestate: 'realestate',
  cycles: 'cycles',
  relationships: 'relationships'
});

const V2_FILTER_ALIASES_BY_CANONICAL = Object.freeze({
  career: ['career'],
  wealth: ['wealth'],
  romance: ['romance', 'love'],
  family: ['family'],
  academics: ['academics'],
  health: ['health', 'mental', 'mind'],
  realestate: ['realestate'],
  cycles: ['cycles'],
  relationships: ['relationships']
});

function cleanText(value, max = 80) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function mapChatDomainToV2ExampleDomain(label) {
  const raw = cleanText(label, 80);
  if (!raw) return null;

  if (Object.prototype.hasOwnProperty.call(CHAT_LABEL_TO_V2_CANONICAL, raw)) {
    return CHAT_LABEL_TO_V2_CANONICAL[raw];
  }

  const lower = raw.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(CHAT_LABEL_TO_V2_CANONICAL, lower)) {
    return CHAT_LABEL_TO_V2_CANONICAL[lower];
  }

  return null;
}

export function counselingExampleDomainMatchesFilter(wantedCanonical, documentDomain) {
  const wanted = cleanText(wantedCanonical, 80).toLowerCase();
  if (!wanted) return true;

  const document = cleanText(documentDomain, 80).toLowerCase();
  if (!document) return false;

  const aliases = V2_FILTER_ALIASES_BY_CANONICAL[wanted] || [wanted];
  return aliases.includes(document);
}

export function resolveV2ExampleSearchCategory(category) {
  const raw = cleanText(category, 80);
  if (!raw || raw === 'all') return null;
  return mapChatDomainToV2ExampleDomain(raw);
}

export default Object.freeze({
  COUNSELING_EXAMPLE_V2_CANONICAL_DOMAINS,
  mapChatDomainToV2ExampleDomain,
  counselingExampleDomainMatchesFilter,
  resolveV2ExampleSearchCategory
});
