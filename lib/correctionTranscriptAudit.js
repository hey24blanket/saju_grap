export const CORRECTION_TRANSCRIPT_AUDIT_VERSION =
  'correction_transcript_audit_v1';

const CLAIM_SYNONYM_GROUPS = Object.freeze([
  ['정산', '미수금', '미수', '회수금', '미납', '외상'],
  ['부채', '빚', '대출'],
  ['과소비', '고정비', '낭비']
]);

function cleanText(value, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function compactTerm(value) {
  return cleanText(value, 40).replace(/\s*문제$/u, '').trim();
}

function expandClaimTerms(term) {
  const compact = compactTerm(term);
  if (!compact) return [];
  const expanded = new Set([compact, cleanText(term, 40)]);
  for (const group of CLAIM_SYNONYM_GROUPS) {
    if (group.some((item) => compact.includes(item) || item.includes(compact))) {
      group.forEach((item) => expanded.add(item));
    }
  }
  return [...expanded].filter(Boolean);
}

export function extractChallengedTerms(userMessage = '') {
  const text = cleanText(userMessage, 2000);
  if (!text) return [];

  const found = [];
  const suchMatch = text.match(/그런\s+([가-힣A-Za-z0-9]{2,20}(?:\s*문제)?)/u);
  if (suchMatch?.[1]) found.push(suchMatch[1].trim());

  for (const match of text.matchAll(
    /([가-힣A-Za-z0-9]{2,16}(?:\s*문제)?)\s*(?:이(?:라고|라니|라며|라전)|있(?:다고|다는|다)\s*)?말한\s*적\s*없/gu
  )) {
    if (match[1]) found.push(match[1].trim());
  }

  return [...new Set(found.map((item) => cleanText(item, 40)).filter(Boolean))];
}

function recentAssistantTurns(history = [], limit = 8) {
  return (Array.isArray(history) ? history : [])
    .filter((item) => item?.role === 'model' || item?.role === 'assistant')
    .slice(-limit)
    .map((item) => ({
      id: cleanText(item?.id, 120) || null,
      text: cleanText(item?.text, 4000)
    }))
    .filter((item) => item.text);
}

function textClaimsTerm(text, terms) {
  const raw = cleanText(text, 4000);
  return terms.some((term) => term && raw.includes(term));
}

const EXPLORATORY_QUESTION_MARKERS = Object.freeze([
  /혹시/u,
  /있으신가요/u,
  /있나요/u,
  /느껴지(?:시|)(?:나요|는지|)/u,
  /궁금(?:하신)?/u,
  /어떤\s*부분/u,
  /어떤\s*상황/u
]);

function isExploratoryQuestionSentence(sentence) {
  const text = cleanText(sentence, 800);
  if (!text) return false;
  if (!/[?？]\s*$/u.test(text)) return false;
  return EXPLORATORY_QUESTION_MARKERS.some((pattern) => pattern.test(text));
}

/** True when assistant text asserts the challenged topic as the user's stated situation, not merely in a bridge question. */
function assistantPriorClaimMatches(text, terms) {
  const raw = cleanText(text, 4000);
  if (!textClaimsTerm(raw, terms)) return false;

  const termSentences = splitSentences(raw).filter((sentence) =>
    textClaimsTerm(sentence, terms)
  );
  if (!termSentences.length) return false;

  return termSentences.some(
    (sentence) => !isExploratoryQuestionSentence(sentence)
  );
}

export function buildCorrectionTranscriptAudit({
  userMessage = '',
  history = []
} = {}) {
  const challengedTerms = extractChallengedTerms(userMessage);
  const searchTerms = [...new Set(challengedTerms.flatMap(expandClaimTerms))];
  const assistants = recentAssistantTurns(history, 8);

  if (!challengedTerms.length) {
    return {
      schemaVersion: CORRECTION_TRANSCRIPT_AUDIT_VERSION,
      challengedTerms: [],
      priorAssistantMatch: 'uncertain',
      matchedAssistantMessageIds: []
    };
  }

  const matched = assistants.filter((item) =>
    assistantPriorClaimMatches(item.text, searchTerms)
  );

  return {
    schemaVersion: CORRECTION_TRANSCRIPT_AUDIT_VERSION,
    challengedTerms,
    priorAssistantMatch: matched.length > 0,
    matchedAssistantMessageIds: matched.map((item) => item.id).filter(Boolean)
  };
}

export function stripChallengedUserFactsFromDelta(delta, audit) {
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) return delta;
  if (audit?.priorAssistantMatch !== false) return delta;

  const terms = [...new Set((audit.challengedTerms || []).flatMap(expandClaimTerms))];
  if (!terms.length) return delta;

  const next = { ...delta };
  for (const collection of ['observations', 'hypotheses', 'goals', 'attempts']) {
    if (!Array.isArray(next[collection])) continue;
    next[collection] = next[collection].filter((item) => {
      const text = cleanText(item?.text, 800);
      return !textClaimsTerm(text, terms);
    });
  }
  return next;
}

const FALSE_PRIOR_ADMISSION_PATTERNS = Object.freeze([
  /제가\s*(?:앞서|앞에서|전에|먼저)?[^.!?\n]{0,48}(?:말(?:했|씀|한|함)|짚(?:었|어|은|어낸)|전제(?:로)?|잘못\s*말|꺼내)/u,
  /(?:앞서|전에)\s*[^.!?\n]{0,40}(?:그(?:런|렇게)|정산|미수|부채)/u,
  /혼란을\s*드려[^.!?\n]{0,24}죄송/u,
  /(?:다시\s*한번\s*)?사과(?:드립|합니다)/u,
  /제가\s*[^.!?\n]{0,60}(?:정산|미수금|부채)/u,
  /(?:짚어낸|짚은|짚어\s*드린|전제로\s*말)/u
]);

function splitSentences(text) {
  return cleanText(text, 5000)
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function challengedSearchTerms(audit) {
  return [...new Set((audit?.challengedTerms || []).flatMap(expandClaimTerms))];
}

export function buildCorrectionNoPriorMatchFrame(audit) {
  const terms = audit?.challengedTerms || [];
  const label = terms.length ? '말씀하신 내용' : '해당 내용';
  return [
    `${label}에 대해 짚어 주셔서 감사합니다.`,
    '지금까지 대화에서 그 내용은 사용자께서 확인하신 사실로 남아 있지 않습니다.',
    '앞선 답변에서도 그 내용을 실제 상황의 전제로 확인한 바는 없습니다.',
    '이후 상담에서도 그 전제를 사용하지 않겠습니다.'
  ].join(' ');
}

export function containsFalsePriorAdmission(reply, audit = null) {
  const text = cleanText(reply, 5000);
  if (!text) return false;
  if (FALSE_PRIOR_ADMISSION_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  const terms = challengedSearchTerms(audit);
  if (
    terms.length &&
    /(?:제가|내가)\s*/u.test(text) &&
    textClaimsTerm(text, terms)
  ) {
    return true;
  }
  return false;
}

function sanitizeCorrectionBodyForNoPriorMatch(body, audit) {
  const terms = challengedSearchTerms(audit);
  const kept = [];
  for (const sentence of splitSentences(body)) {
    if (containsFalsePriorAdmission(sentence, audit)) continue;
    if (terms.length && textClaimsTerm(sentence, terms)) continue;
    kept.push(sentence);
  }
  return kept.join(' ').trim();
}

export function finalizeCorrectionReply(
  reply,
  audit,
  { maxBodyLength = 1200 } = {}
) {
  const original = cleanText(reply, 5000);
  if (!audit || audit.priorAssistantMatch === 'uncertain' || !audit.challengedTerms?.length) {
    return {
      reply: original,
      correctionFrameApplied: false,
      frameMode: 'none'
    };
  }

  if (audit.priorAssistantMatch === true) {
    return {
      reply: original,
      correctionFrameApplied: false,
      frameMode: 'prior_match'
    };
  }

  const frame = buildCorrectionNoPriorMatchFrame(audit);
  const body = sanitizeCorrectionBodyForNoPriorMatch(original, audit).slice(0, maxBodyLength);
  let combined = body ? `${frame} ${body}` : frame;
  if (containsFalsePriorAdmission(combined, audit)) {
    combined = frame;
  }
  return {
    reply: combined,
    correctionFrameApplied: true,
    frameMode: 'no_prior_match'
  };
}

export function enforceTranscriptConsistentReply(
  reply,
  history = [],
  userMessage = ''
) {
  let text = cleanText(reply, 5000);
  const timeline = [
    ...(Array.isArray(history) ? history : []),
    { role: 'user', text: userMessage }
  ];

  for (let index = 0; index < timeline.length; index += 1) {
    const item = timeline[index];
    if (item?.role !== 'user') continue;
    if (!/말한\s*적\s*없/u.test(cleanText(item.text, 2000))) continue;

    const audit = buildCorrectionTranscriptAudit({
      userMessage: item.text,
      history: timeline.slice(0, index)
    });
    if (audit.priorAssistantMatch !== false) continue;

    text = sanitizeCorrectionBodyForNoPriorMatch(text, audit);
    if (containsFalsePriorAdmission(text, audit)) {
      text = buildCorrectionNoPriorMatchFrame(audit);
    }
  }

  return text;
}

export default Object.freeze({
  CORRECTION_TRANSCRIPT_AUDIT_VERSION,
  extractChallengedTerms,
  buildCorrectionTranscriptAudit,
  stripChallengedUserFactsFromDelta,
  buildCorrectionNoPriorMatchFrame,
  containsFalsePriorAdmission,
  finalizeCorrectionReply,
  enforceTranscriptConsistentReply
});
