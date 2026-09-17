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

const TASK_PATTERNS = Object.freeze([
  ['correction', /(말한\s*적\s*없|그런\s*.+\s*없|틀렸|정정|왜\s*그렇게\s*말|근거\s*없)/u],
  ['explanation', /(명리(?:적)?\s*이유|왜\s*그렇|왜\s*그런|어떻게\s*그렇게\s*봐|근거(?:가)?\s*뭐|그렇게\s*보(?:는|니))/u],
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

  for (const [label, canonical] of Object.entries(KOREAN_DOMAIN_TO_CANONICAL)) {
    if (label === '총운') continue;
    const pattern = ({
      재물운: /(금전|재물|돈|수입|매출|금전운|재물운|정산|미수|회수)/u,
      사업운: /(사업|직장|직업|이직|취업|커리어|사업운)/u,
      연애운: /(연애|애정|결혼|배우자|애인|연애운)/u,
      심신운: /(건강|심신|마음|불안|스트레스|심신운|건강운)/u
    })[label];
    if (pattern?.test(raw)) {
      return canonical;
    }
  }

  const mapped = mapChatDomainToV2ExampleDomain(raw);
  if (mapped) return mapped;

  return fallback;
}

function detectTask(text) {
  const raw = cleanText(text, 2000);
  for (const [task, pattern] of TASK_PATTERNS) {
    if (pattern.test(raw)) return task;
  }
  return 'general';
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

  if (
    !currentDomainExplicit &&
    followUpTasks.has(currentTask) &&
    priorUsers.length > 0
  ) {
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
    currentTask === 'general' &&
    /(그럼|그러면|그래서)/u.test(currentText)
  ) {
    task = 'reality_bridge';
  }

  if (
    inherited &&
    domain !== 'all' &&
    currentTask === 'general' &&
    /(왜|이유)/u.test(currentText)
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
