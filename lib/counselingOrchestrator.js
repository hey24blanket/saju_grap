import { buildCounselingConversationFocus } from './counselingConversationFocus.js';
import { selectRelevantSajuEvidence } from './counselingEvidenceSelector.js';
import { buildCounselingKnowledgeRagQuery } from './counselingKnowledgeRagQuery.js';
import { buildCorrectionTranscriptAudit } from './correctionTranscriptAudit.js';

export const COUNSELING_ORCHESTRATOR_VERSION =
  'counseling_orchestrator_v1';

export const FOCUS_DOMAIN_TO_RAG_DOMAIN = Object.freeze({
  all: 'all',
  career: 'career',
  wealth: 'wealth',
  romance: 'love',
  family: 'all',
  academics: 'all',
  health: 'mental',
  realestate: 'all',
  cycles: 'all',
  relationships: 'love'
});

export const FOCUS_DOMAIN_TO_KOREAN_LABEL = Object.freeze({
  all: '총운',
  career: '사업운',
  wealth: '재물운',
  romance: '연애운',
  family: '총운',
  academics: '총운',
  health: '심신운',
  realestate: '총운',
  cycles: '총운',
  relationships: '연애운'
});

export function mapFocusDomainToRagDomain(domain) {
  return FOCUS_DOMAIN_TO_RAG_DOMAIN[domain] || 'all';
}

export function mapFocusDomainToKoreanLabel(domain) {
  return FOCUS_DOMAIN_TO_KOREAN_LABEL[domain] || '총운';
}

export function formatRelevantSajuEvidenceForPrompt(evidencePacket) {
  if (
    !evidencePacket ||
    !Array.isArray(evidencePacket.evidence) ||
    !evidencePacket.evidence.length
  ) {
    return '선택된 Engine Fact evidence 없음';
  }

  return JSON.stringify(
    {
      schemaVersion: evidencePacket.schemaVersion,
      domain: evidencePacket.domain,
      task: evidencePacket.task,
      timingGrounded: evidencePacket.timingGrounded,
      timingYearGrounded: evidencePacket.timingYearGrounded,
      timingMonthGrounded: evidencePacket.timingMonthGrounded,
      timingMonthExplainable: evidencePacket.timingMonthExplainable,
      timingMonthDirectional: evidencePacket.timingMonthDirectional,
      timingYearExplainable: evidencePacket.timingYearExplainable,
      timingYearDirectional: evidencePacket.timingYearDirectional,
      timingFallbackLevel: evidencePacket.timingFallbackLevel,
      evidence: evidencePacket.evidence
    },
    null,
    0
  );
}

export function buildCounselingOrchestratorDiagnostic({
  focus,
  evidencePacket,
  ragRuntime,
  exampleRagRuntime,
  correctionAudit = null
} = {}) {
  const evidence = evidencePacket?.evidence || [];
  return {
    focus: {
      domain: focus?.domain || null,
      task: focus?.task || null,
      inherited: Boolean(focus?.inherited)
    },
    evidenceCount: evidence.length,
    evidenceScopes: evidence.map((item) => item?.scope).filter(Boolean),
    evidencePeriods: evidence.map((item) => item?.period).filter(Boolean),
    knowledgeRagUsed: ragRuntime?.status === 'used',
    exampleStrategyUsed: exampleRagRuntime?.status === 'used',
    knowledgeRagStatus: ragRuntime?.status || null,
    exampleRagStatus: exampleRagRuntime?.status || null,
    correctionAudit: correctionAudit
      ? {
          challengedTerms: correctionAudit.challengedTerms || [],
          priorAssistantMatch: correctionAudit.priorAssistantMatch,
          matchedAssistantMessageIds:
            correctionAudit.matchedAssistantMessageIds || []
        }
      : null,
    timingGrounded: Boolean(evidencePacket?.timingMonthDirectional),
    timingYearGrounded: Boolean(evidencePacket?.timingYearDirectional),
    timingMonthGrounded: Boolean(evidencePacket?.timingMonthDirectional),
    timingMonthExplainable: Boolean(evidencePacket?.timingMonthExplainable),
    timingMonthDirectional: Boolean(evidencePacket?.timingMonthDirectional),
    timingYearExplainable: Boolean(evidencePacket?.timingYearExplainable),
    timingYearDirectional: Boolean(evidencePacket?.timingYearDirectional),
    timingFallbackLevel: evidencePacket?.timingFallbackLevel || 'undifferentiated'
  };
}

export function buildCounselingOrchestration({
  userMessage = '',
  messageId = null,
  history = [],
  sajuContext = null,
  counselingFactContext = null,
  selectedDomain = '총운'
} = {}) {
  const engineFacts = sajuContext?.engineFacts || null;
  const referenceYear =
    engineFacts?.cycles?.reference?.year ?? null;

  const focus = buildCounselingConversationFocus({
    userMessage,
    messageId,
    history,
    referenceYear,
    selectedDomain
  });

  const evidencePacket = selectRelevantSajuEvidence({
    engineFacts,
    focus,
    counselingFactContext
  });

  const knowledgeRagQuery = buildCounselingKnowledgeRagQuery({
    userMessage,
    history,
    focus,
    evidencePacket,
    sajuContext
  });

  const correctionAudit = focus.task === 'correction'
    ? buildCorrectionTranscriptAudit({ userMessage, history })
    : null;

  const ragDomain = mapFocusDomainToRagDomain(focus.domain);
  const intentDomain = mapFocusDomainToKoreanLabel(focus.domain);

  const ragPurpose =
    focus.task === 'timing' ||
    focus.task === 'explanation'
      ? 'saju_interpretation'
      : counselingFactContext?.intent?.purpose ||
        'counseling_reference';

  const exampleCategory =
    focus.domain && focus.domain !== 'all'
      ? focus.domain
      : null;

  return {
    schemaVersion: COUNSELING_ORCHESTRATOR_VERSION,
    focus,
    evidencePacket,
    knowledgeRagQuery,
    relevantEvidenceText:
      formatRelevantSajuEvidenceForPrompt(evidencePacket),
    ragAnchorDomain: ragDomain,
    ragIntentPatch: {
      domain: intentDomain,
      purpose: ragPurpose,
      timelineRequested:
        focus.task === 'timing' ||
        Boolean(counselingFactContext?.intent?.timelineRequested)
    },
    exampleCategory,
    correctionAudit,
    timingGrounded: Boolean(evidencePacket.timingMonthDirectional),
    timingYearGrounded: Boolean(evidencePacket.timingYearDirectional),
    timingMonthGrounded: Boolean(evidencePacket.timingMonthDirectional),
    timingMonthExplainable: Boolean(evidencePacket.timingMonthExplainable),
    timingMonthDirectional: Boolean(evidencePacket.timingMonthDirectional),
    timingYearExplainable: Boolean(evidencePacket.timingYearExplainable),
    timingYearDirectional: Boolean(evidencePacket.timingYearDirectional),
    timingFallbackLevel: evidencePacket.timingFallbackLevel || 'undifferentiated'
  };
}

export default Object.freeze({
  COUNSELING_ORCHESTRATOR_VERSION,
  buildCounselingOrchestration,
  buildCounselingOrchestratorDiagnostic,
  formatRelevantSajuEvidenceForPrompt,
  mapFocusDomainToRagDomain,
  mapFocusDomainToKoreanLabel
});
