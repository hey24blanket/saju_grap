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

  const matched = assistants.filter((item) => textClaimsTerm(item.text, searchTerms));

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

export default Object.freeze({
  CORRECTION_TRANSCRIPT_AUDIT_VERSION,
  extractChallengedTerms,
  buildCorrectionTranscriptAudit,
  stripChallengedUserFactsFromDelta
});
