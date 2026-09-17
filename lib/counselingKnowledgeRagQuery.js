import { mapFocusDomainToRagDomain } from './counselingOrchestrator.js';

function cleanText(value, max = 2500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function evidenceKeywords(evidencePacket) {
  const parts = [];
  for (const item of evidencePacket?.evidence || []) {
    const facts = item?.facts || {};
    if (facts.tenGod?.tenGodKo) parts.push(`tenGod:${facts.tenGod.tenGodKo}`);
    if (facts.tenGod?.group) parts.push(`group:${facts.tenGod.group}`);
    if (facts.twelveStage?.stage) parts.push(`twelveStage:${facts.twelveStage.stage}`);
    if (Array.isArray(facts.relationsWithNatal)) {
      facts.relationsWithNatal.slice(0, 3).forEach((rel) => {
        if (rel?.type) parts.push(`relation:${rel.type}`);
      });
    }
    if (facts.balanceImpact?.effect) parts.push(`balance:${facts.balanceImpact.effect}`);
    if (facts.usefulGodImpact?.yongsinImpact) {
      parts.push('yongsinImpact');
    }
    if (facts.usefulGodImpact?.gisinImpact) {
      parts.push('gisinImpact');
    }
    if (facts.dominantImbalance) parts.push(`imbalance:${facts.dominantImbalance}`);
    if (facts.yongsinElement) parts.push(`yongsin:${facts.yongsinElement}`);
    if (facts.wealthGroup?.strengthBand) parts.push(`wealthGroup:${facts.wealthGroup.strengthBand}`);
  }
  return [...new Set(parts)].slice(0, 20);
}

export function buildCounselingKnowledgeRagQuery({
  userMessage = '',
  history = [],
  focus = null,
  evidencePacket = null,
  sajuContext = null
} = {}) {
  const profileName = cleanText(sajuContext?.name, 80);
  const sanitize = (value) => {
    let text = cleanText(value, 500)
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
      .replace(/(?:\+?82[- ]?)?0?1[016789][- ]?\d{3,4}[- ]?\d{4}/g, '[phone]');
    if (profileName.length >= 2) {
      text = text.split(profileName).join('[user]');
    }
    return text;
  };

  const recentUser = (Array.isArray(history) ? history : [])
    .filter((item) => item?.role === 'user')
    .slice(-2)
    .map((item) => sanitize(item?.text))
    .filter(Boolean);

  const ragDomain =
    focus?.domain && focus.domain !== 'all'
      ? focus.domain
      : 'all';

  const knowledgeDomainKey = mapFocusDomainToRagDomain(ragDomain);

  return cleanText(
    [
      `focus domain=${focus?.domain || 'all'} task=${focus?.task || 'general'}`,
      focus?.inherited ? 'follow_up=true' : '',
      `knowledgeDomain=${knowledgeDomainKey}`,
      ...evidenceKeywords(evidencePacket).map((item) => `evidence ${item}`),
      ...recentUser.map((text) => `context: ${text}`),
      `question: ${sanitize(userMessage)}`
    ].filter(Boolean).join('\n'),
    2500
  );
}

export default Object.freeze({
  buildCounselingKnowledgeRagQuery
});
