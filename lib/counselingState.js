export const COUNSELING_STATE_SCHEMA_VERSION =
  'sg_counseling_state_v1';

const LIMITS = Object.freeze({
  subjects: 8,
  observations: 20,
  goals: 5,
  constraints: 8,
  attempts: 8,
  hypotheses: 3,
  corrections: 12,
  openQuestions: 3,
  appliedMessageIds: 40
});

const COLLECTION_PREFIX = Object.freeze({
  subjects: 's',
  observations: 'o',
  goals: 'g',
  constraints: 'k',
  attempts: 'a',
  hypotheses: 'h',
  corrections: 'c',
  openQuestions: 'q'
});

function cleanText(value, maxLength = 800) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength)
    : '';
}

function cleanId(value) {
  return cleanText(value, 120).replace(/[^a-zA-Z0-9_.:-]/g, '');
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueIds(value) {
  return [...new Set(safeArray(value).map(cleanId).filter(Boolean))].slice(0, 12);
}

function emptyState(sessionId = '') {
  return {
    schemaVersion: COUNSELING_STATE_SCHEMA_VERSION,
    sessionId: cleanId(sessionId),
    revision: 0,
    lastAppliedMessageId: null,
    appliedMessageIds: [],
    subjects: [{ id: 'self', label: '사용자', kind: 'self', status: 'current' }],
    observations: [],
    goals: [],
    constraints: [],
    attempts: [],
    hypotheses: [],
    corrections: [],
    openQuestions: []
  };
}

function normalizeItem(item, collection) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const text = cleanText(item.text, 800);
  const label = cleanText(item.label, 80);
  const id = cleanId(item.id);

  if (collection === 'subjects') {
    if (!id || !label) return null;
    return {
      id,
      label,
      kind: item.kind === 'self' ? 'self' : 'other',
      status: item.status === 'retracted' ? 'retracted' : 'current'
    };
  }

  if (!id || !text) return null;
  const normalized = {
    id,
    text,
    sourceMessageIds: uniqueIds(item.sourceMessageIds),
    status: ['current', 'tentative', 'superseded', 'retracted'].includes(item.status)
      ? item.status
      : collection === 'hypotheses' ? 'tentative' : 'current'
  };

  const subjectId = cleanId(item.subjectId);
  if (subjectId) normalized.subjectId = subjectId;
  const kind = cleanText(item.kind, 60);
  if (kind) normalized.kind = kind;
  if (collection === 'hypotheses') {
    normalized.confidence = ['low', 'medium'].includes(item.confidence)
      ? item.confidence
      : 'low';
    normalized.supportingObservationIds = uniqueIds(item.supportingObservationIds);
    normalized.counterObservationIds = uniqueIds(item.counterObservationIds);
  }
  if (collection === 'corrections') {
    normalized.targetId = cleanId(item.targetId);
    normalized.action = item.action === 'retract' ? 'retract' : 'revise';
  }
  return normalized;
}

export function normalizeCounselingState(value, { sessionId = '' } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return emptyState(sessionId);
  }

  const state = emptyState(cleanId(value.sessionId) || sessionId);
  state.revision = Number.isInteger(value.revision) && value.revision >= 0
    ? value.revision
    : 0;
  state.lastAppliedMessageId = cleanId(value.lastAppliedMessageId) || null;
  state.appliedMessageIds = uniqueIds(value.appliedMessageIds).slice(-LIMITS.appliedMessageIds);

  for (const collection of Object.keys(COLLECTION_PREFIX)) {
    const items = safeArray(value[collection])
      .map((item) => normalizeItem(item, collection))
      .filter(Boolean)
      .slice(-LIMITS[collection]);
    if (collection === 'subjects' && !items.some((item) => item.id === 'self')) {
      items.unshift({ id: 'self', label: '사용자', kind: 'self', status: 'current' });
    }
    state[collection] = items.slice(-LIMITS[collection]);
  }

  return state;
}

function validateSources(item, allowedUserMessageIds) {
  const sources = uniqueIds(item?.sourceMessageIds);
  if (sources.length === 0) return { ok: false, reason: 'missing_user_source' };
  if (sources.some((id) => !allowedUserMessageIds.has(id))) {
    return { ok: false, reason: 'invalid_or_assistant_source' };
  }
  return { ok: true, sources };
}

function makeItemId(collection, revision, index) {
  return `${COLLECTION_PREFIX[collection]}${revision}_${index + 1}`;
}

function alreadyStored(items, item) {
  const key = `${item.text}|${uniqueIds(item.sourceMessageIds).sort().join(',')}`;
  return items.some((existing) =>
    `${existing.text}|${uniqueIds(existing.sourceMessageIds).sort().join(',')}` === key &&
    existing.status !== 'retracted'
  );
}

export function applyCounselingStateDelta({
  state,
  delta,
  sessionId,
  baseRevision,
  messageId,
  userMessages = []
}) {
  const current = normalizeCounselingState(state, { sessionId });
  const safeMessageId = cleanId(messageId);

  if (!safeMessageId) {
    return { state: current, applied: false, status: 'state_update_skipped', reason: 'missing_message_id' };
  }
  if (current.appliedMessageIds.includes(safeMessageId)) {
    return { state: current, applied: false, status: 'duplicate_message_ignored', reason: 'duplicate_message_id' };
  }
  if (Number(baseRevision) !== current.revision) {
    return { state: current, applied: false, status: 'stale_revision_ignored', reason: 'stale_revision' };
  }
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) {
    return { state: current, applied: false, status: 'state_update_skipped', reason: 'invalid_delta' };
  }

  const allowedUserMessageIds = new Set(
    safeArray(userMessages)
      .filter((item) => item?.role === 'user')
      .map((item) => cleanId(item.id))
      .filter(Boolean)
  );
  allowedUserMessageIds.add(safeMessageId);

  const next = structuredClone(current);
  const nextRevision = current.revision + 1;
  const pending = {};

  for (const collection of Object.keys(COLLECTION_PREFIX)) {
    pending[collection] = [];
    for (const [index, raw] of safeArray(delta[collection]).entries()) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { state: current, applied: false, status: 'state_update_skipped', reason: `invalid_${collection}` };
      }

      if (collection === 'subjects') {
        const label = cleanText(raw.label, 80);
        if (!label) {
          return { state: current, applied: false, status: 'state_update_skipped', reason: 'invalid_subject' };
        }
        const subject = {
          id: cleanId(raw.id) || makeItemId(collection, nextRevision, index),
          label,
          kind: raw.kind === 'self' ? 'self' : 'other',
          status: 'current'
        };
        pending[collection].push(subject);
        continue;
      }

      const text = cleanText(raw.text, 800);
      const sourceValidation = validateSources(raw, allowedUserMessageIds);
      if (!text || !sourceValidation.ok) {
        return {
          state: current,
          applied: false,
          status: 'state_update_skipped',
          reason: !text ? `missing_${collection}_text` : sourceValidation.reason
        };
      }

      const item = {
        id: makeItemId(collection, nextRevision, index),
        text,
        sourceMessageIds: sourceValidation.sources,
        status: collection === 'hypotheses' ? 'tentative' : 'current'
      };
      const subjectId = cleanId(raw.subjectId);
      if (subjectId) {
        const subjectExists = [
          ...next.subjects,
          ...pending.subjects
        ].some((subject) => subject.id === subjectId);
        if (!subjectExists) {
          return { state: current, applied: false, status: 'state_update_skipped', reason: 'subject_not_found' };
        }
        item.subjectId = subjectId;
      }
      const kind = cleanText(raw.kind, 60);
      if (kind) item.kind = kind;

      if (collection === 'hypotheses') {
        item.confidence = raw.confidence === 'medium' ? 'medium' : 'low';
        item.supportingObservationIds = uniqueIds(raw.supportingObservationIds);
        item.counterObservationIds = uniqueIds(raw.counterObservationIds);
      }
      if (collection === 'corrections') {
        item.targetId = cleanId(raw.targetId);
        item.action = raw.action === 'retract' ? 'retract' : 'revise';
        const target = Object.keys(COLLECTION_PREFIX)
          .filter((name) => name !== 'subjects' && name !== 'corrections')
          .flatMap((name) => next[name])
          .find((candidate) => candidate.id === item.targetId);
        if (!target) {
          return { state: current, applied: false, status: 'state_update_skipped', reason: 'correction_target_not_found' };
        }
        target.status = item.action === 'retract' ? 'retracted' : 'superseded';
      }

      pending[collection].push(item);
    }
  }

  for (const collection of Object.keys(COLLECTION_PREFIX)) {
    for (const item of pending[collection]) {
      if (collection === 'subjects') {
        const existingIndex = next.subjects.findIndex((candidate) => candidate.id === item.id);
        if (existingIndex >= 0) next.subjects[existingIndex] = item;
        else next.subjects.push(item);
      } else if (!alreadyStored(next[collection], item)) {
        next[collection].push(item);
      }
    }
    next[collection] = next[collection].slice(-LIMITS[collection]);
  }

  next.revision = nextRevision;
  next.lastAppliedMessageId = safeMessageId;
  next.appliedMessageIds = [...next.appliedMessageIds, safeMessageId]
    .slice(-LIMITS.appliedMessageIds);

  return { state: next, applied: true, status: 'state_updated', reason: null };
}

export function buildCounselingStateContext(value) {
  const state = normalizeCounselingState(value);
  const active = (items) => items.filter((item) =>
    item.status !== 'retracted' && item.status !== 'superseded'
  );
  return {
    schemaVersion: state.schemaVersion,
    sessionId: state.sessionId,
    revision: state.revision,
    subjects: active(state.subjects),
    observations: active(state.observations),
    goals: active(state.goals),
    constraints: active(state.constraints),
    attempts: active(state.attempts),
    hypotheses: active(state.hypotheses),
    corrections: state.corrections.slice(-6),
    openQuestions: active(state.openQuestions)
  };
}

export default Object.freeze({
  COUNSELING_STATE_SCHEMA_VERSION,
  normalizeCounselingState,
  applyCounselingStateDelta,
  buildCounselingStateContext
});
