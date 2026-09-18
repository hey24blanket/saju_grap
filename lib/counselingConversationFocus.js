import { mapChatDomainToV2ExampleDomain } from './counselingExampleDomainMap.js';

export const COUNSELING_CONVERSATION_FOCUS_VERSION =
  'counseling_conversation_focus_v1';

const KOREAN_DOMAIN_TO_CANONICAL = Object.freeze({
  총운: 'all',
  사업운: 'career',
  재물운: 'wealth',
  심신운: 'health',
  연애운: 'romance'
});

/** Explicit domain nouns first; generic affect words must not override these. */
const CANONICAL_DOMAIN_RULES = Object.freeze([
  [
    'family',
    /(?:가족|부모|어머니|아버지|엄마|아빠|자녀|아이들?|형제|자매|딸|아들|며느리|사위|시(?:어머|아버|모|부)|장(?:인|모)|조부(?:모)?|손주)/u
  ],
  [
    'romance',
    /(?:연애|애정|애인|썸|짝사랑|남(?:친|자친)|여(?:친|자친)|배우자|결혼)/u
  ],
  [
    'career',
    /(?:회사|직장|이직|퇴사|업무|커리어|직업|취업|승진|사업|출근|상사|팀장|조직|근무)/u
  ],
  [
    'relationships',
    /(?:인간관계|사람\s*관계|대인관계|친구|지인|동료\s*관계|사람들과|관계가\s*꼬|꼬이(?:는|))/u
  ],
  [
    'wealth',
    /(?:금전|재물|돈|수입|매출|금전운|재물운|정산|미수|회수)/u
  ]
]);

const HEALTH_DOMAIN_PATTERN =
  /(?:몸|건강|통증|병원|질병|(?:몸(?:이|도)?)\s*아프|잠(?:도)?\s*못|수면|증상|피로(?:감)?|불면|우울|이유\s*없이\s*마음이\s*(?:불안|답답)|몸(?:도)?\s*계속\s*아프)/u;

const TASK_PATTERNS = Object.freeze([
  ['correction', /(말한\s*적\s*없|그런\s*.+\s*없|틀렸|정정|왜\s*그렇게\s*말|근거\s*없)/u],
  [
    'explanation',
    /(명리(?:적)?(?:으로)?\s*(?:이유|왜)|왜\s*그렇|왜\s*그런|왜\s*[\?？]|어떻게\s*그렇게\s*봐|근거(?:가)?\s*(?:뭐|있)|그렇게\s*보(?:는|니|는\s*이유)|사주(?:에서)?\s*(?:그렇게\s*)?볼\s*근거|어떤\s*구조\s*때문|내\s*사주(?:에서는|에서)?.{0,40}어떤\s*부분)/u
  ],
  ['reality_bridge', /(현실(?:에서는|에서)?|먼저\s*확인|뭘\s*(?:먼저\s*)?확인|실생활|일상(?:에서는)?)/u],
  ['choice', /(선택(?:지)?|무엇을\s*(?:고를|선택)|어느\s*쪽)/u],
  ['timing', /(언제|시기|풀릴|풀리|좋아질|나아질|몇\s*월|연운|월운|대운|세운|앞으로|향후|내년|올해)/u]
]);

function cleanText(value, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function recentUserTurns(history = [], limit = 4) {
  return (Array.isArray(history) ? history : [])
    .filter((item) => item?.role === 'user')
    .slice(-limit)
    .map((item) => ({
      id: cleanText(item?.id, 120) || null,
      text: cleanText(item?.text, 2000)
    }))
    .filter((item) => item.text);
}

function detectDomainFromText(text, fallback = 'all') {
  const raw = cleanText(text, 2000);
  if (!raw) return fallback;

  for (const [canonical, pattern] of CANONICAL_DOMAIN_RULES) {
    if (pattern.test(raw)) return canonical;
  }

  for (const [label, canonical] of Object.entries(KOREAN_DOMAIN_TO_CANONICAL)) {
    if (label === '총운') continue;
    if (raw.includes(label)) return canonical;
  }

  const mapped = mapChatDomainToV2ExampleDomain(raw);
  if (mapped) return mapped;

  if (HEALTH_DOMAIN_PATTERN.test(raw)) return 'health';

  return fallback;
}

function detectTask(text) {
  const raw = cleanText(text, 2000);
  for (const [task, pattern] of TASK_PATTERNS) {
    if (pattern.test(raw)) return task;
  }
  return 'general';
}

function isChitChat(text) {
  return /^(고마워|감사|알겠어|알겠습니다|응|네|그래|좋아|됐어)[.!?\s]*$/u.test(
    cleanText(text, 80)
  );
}

function isDiscourseContinuation(text) {
  const raw = cleanText(text, 2000);
  if (!raw || isChitChat(raw)) return false;
  return /(그럼|그러면|그래서|그\s*얘기|그(?:걸|것을|거를|거)?\s*기준|봐야\s*할\s*건|중요하게\s*봐|지금은\s*\?|지금\s+내\s*사주|내\s*사주(?:에서는|에서)?)/u.test(
    raw
  );
}

function inferDomainFromPriorUsers(priorUsers) {
  for (let index = priorUsers.length - 1; index >= 0; index -= 1) {
    const domain = detectDomainFromText(priorUsers[index].text, null);
    if (domain && domain !== 'all') return domain;
  }
  return null;
}

function extractTargetYears(text, referenceYear) {
  const ref = Number.isFinite(Number(referenceYear))
    ? Number(referenceYear)
    : new Date().getUTCFullYear();
  const years = [...String(text || '').matchAll(/(19\d{2}|20\d{2}|2100)\s*년?/gu)]
    .map((match) => Number(match[1]));
  if (/(올해|금년)/u.test(text)) years.push(ref);
  if (/내년/u.test(text)) years.push(ref + 1);
  if (/내후년/u.test(text)) years.push(ref + 2);
  return [...new Set(years.filter(Number.isFinite))].sort((a, b) => a - b);
}

function extractTargetMonth(text) {
  const match = String(text || '').match(/(?:^|\D)(1[0-2]|0?[1-9])\s*월/u);
  return match ? Number(match[1]) : null;
}

export function buildCounselingConversationFocus({
  userMessage = '',
  messageId = null,
  history = [],
  referenceYear = null,
  selectedDomain = '총운'
} = {}) {
  const currentText = cleanText(userMessage, 5000);
  const priorUsers = recentUserTurns(history, 4);
  const currentTask = detectTask(currentText);
  const currentDomainExplicit = detectDomainFromText(currentText, null);

  let inherited = false;
  let domain = currentDomainExplicit || 'all';
  let sourceUserMessageIds = messageId ? [messageId] : [];

  const followUpTasks = new Set([
    'explanation',
    'reality_bridge',
    'correction',
    'choice'
  ]);

  const canInheritDomain =
    !currentDomainExplicit &&
    priorUsers.length > 0 &&
    (
      followUpTasks.has(currentTask) ||
      (currentTask === 'general' && isDiscourseContinuation(currentText))
    );

  if (canInheritDomain) {
    const inheritedDomain = inferDomainFromPriorUsers(priorUsers);
    if (inheritedDomain) {
      domain = inheritedDomain;
      inherited = true;
      sourceUserMessageIds = [
        ...priorUsers.map((item) => item.id).filter(Boolean),
        ...(messageId ? [messageId] : [])
      ];
    }
  }

  if (
    !inherited &&
    !currentDomainExplicit &&
    currentTask === 'reality_bridge' &&
    priorUsers.length === 0
  ) {
    domain = 'all';
  }

  if (
    !inherited &&
    !currentDomainExplicit &&
    domain === 'all' &&
    selectedDomain &&
    selectedDomain !== '총운'
  ) {
    domain = KOREAN_DOMAIN_TO_CANONICAL[selectedDomain] ||
      mapChatDomainToV2ExampleDomain(selectedDomain) ||
      'all';
  }

  let task = currentTask;
  if (
    inherited &&
    domain !== 'all' &&
    currentTask === 'general' &&
    /(왜|이유|근거|구조)/u.test(currentText)
  ) {
    task = 'explanation';
  }

  const anchorText = inherited
    ? priorUsers.map((item) => item.text).join('\n')
    : currentText;

  return {
    schemaVersion: COUNSELING_CONVERSATION_FOCUS_VERSION,
    domain,
    task,
    inherited,
    sourceUserMessageIds: [...new Set(sourceUserMessageIds.filter(Boolean))],
    targetYears: extractTargetYears(`${anchorText}\n${currentText}`, referenceYear),
    targetMonth: extractTargetMonth(currentText) ||
      extractTargetMonth(anchorText)
  };
}

export default Object.freeze({
  COUNSELING_CONVERSATION_FOCUS_VERSION,
  buildCounselingConversationFocus
});
