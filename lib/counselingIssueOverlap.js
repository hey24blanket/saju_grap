export const COUNSELING_ISSUE_OVERLAP_VERSION =
  'counseling_issue_overlap_v1';

const MAX_STRANDS = 3;

function cleanText(value, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function clipSummary(text, max = 120) {
  const raw = cleanText(text, max);
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
}

const EMOTION_LEXICON =
  /(?:서운|답답|지치|힘들|우울|복잡|불안|짜증|억울|외로|무기력|막막|속상|화가|답답해|지쳐|힘들어|싫어(?:요|)|미워)/u;

const INTERPRETATION_LEXICON =
  /(?:같(?:아|다|은)|느껴(?:지|)|인정(?:받|)|받지\s*못|무시(?:당|)|외면|거리)/u;

const REALITY_LEXICON = Object.freeze([
  {
    id: 'workload',
    pattern: /(?:일|업무|일거리|업무량|맡(?:은|기)|과로|야근|일이\s*많|너무\s*많)/u,
    summary: '실제 업무량·맡은 일의 범위'
  },
  {
    id: 'recognition_context',
    pattern: /(?:회사|상사|팀|인정|평가|승진|그만|퇴사|이직|다녀)/u,
    summary: '직장·역할·계속 여부와 관련된 조건'
  },
  {
    id: 'contact',
    pattern: /(?:연락|답장|메시지|전화|만나|연락(?:이|을)\s*(?:잘\s*)?안)/u,
    summary: '실제 연락·만남 빈도나 방식'
  },
  {
    id: 'family_role',
    pattern: /(?:부모|어머니|아버지|가족|챙기|돌봄|역할|내가\s*다\s*하)/u,
    summary: '가족 안에서 맡은 역할·책임 범위'
  },
  {
    id: 'behavior_choice',
    pattern: /(?:먼저\s*연락|연락(?:하기|하)\s*싫|하지\s*않|안\s*하(?:겠|려)|피하)/u,
    summary: '사용자가 말한 행동·선택 경향'
  }
]);

function isFactualSajuQuestion(text) {
  const raw = cleanText(text, 2000);
  return /(?:재성|십신|용신|기신|일간|오행|원국|관성|비겁|식상|인성).{0,20}(?:강|약|많|적|어떤|뭐|편)/u.test(
    raw
  );
}

function isSimpleTimingQuestion(text, focus) {
  if (focus?.task === 'timing') return true;
  const raw = cleanText(text, 2000);
  return (
    /(?:금전운|재물운|연애운|사업운|언제|시기|풀릴|나아|좋아)/u.test(raw) &&
    !/(?:그리고|면서|때문|인데|인\s*것\s*같|느껴|너무\s*많|챙기|연락)/u.test(raw)
  );
}

function isSimpleChoiceWithoutOverlap(text) {
  const raw = cleanText(text, 2000);
  const shortConflict =
    /(?:헤어질|만날까|선택|고를까|할까)\s*[?？]?$/u.test(raw) ||
    (/헤어질|만날까/u.test(raw) && raw.length < 80);
  return (
    shortConflict &&
    !/(?:너무|많|서운|답답|느껴|같아|챙기|연락(?:이|을)\s*안)/u.test(raw)
  );
}

function isAmbiguousVague(text) {
  const raw = cleanText(text, 2000);
  return (
    raw.length < 40 &&
    /(?:그냥\s*다\s*싫|아무것도\s*안|모르겠|다\s*힘들)/u.test(raw) &&
    !/(?:일|회사|부모|친구|연락|가족|업무)/u.test(raw)
  );
}

function hasMultiProblemSyntax(text) {
  return /(?:고\s|서\s|면서|때문에|그런데|그리고|인데|~?\s*같아서|느껴서)/u.test(text);
}

function detectRealityStrands(text) {
  const raw = cleanText(text, 2000);
  const found = [];
  for (const rule of REALITY_LEXICON) {
    if (!rule.pattern.test(raw)) continue;
    found.push({
      id: rule.id,
      kind: 'reality',
      summary: rule.summary,
      grounding: 'user'
    });
  }
  const byId = [...new Map(found.map((item) => [item.id, item])).values()];
  return byId.map(({ id, ...rest }) => rest);
}

function detectEmotionStrand(text) {
  const raw = cleanText(text, 2000);
  if (!EMOTION_LEXICON.test(raw)) return null;
  const match = raw.match(
    /(?:서운|답답|지치|힘들|우울|복잡|불안|짜증|억울|외로|무기력|막막|속상|싫)/u
  );
  const word = match?.[0] || '감정';
  return {
    kind: 'emotion',
    summary: clipSummary(`사용자가 직접 표현한 ${word}·부담`),
    grounding: 'user'
  };
}

function detectInterpretationStrand(text) {
  const raw = cleanText(text, 2000);
  if (!INTERPRETATION_LEXICON.test(raw)) return null;
  if (/인정(?:받|).{0,12}(?:느낌|없)/u.test(raw)) {
    return {
      kind: 'interpretation',
      summary: '인정받지 못한다고 느끼는 해석',
      grounding: 'user'
    };
  }
  if (/~?\s*같(?:아|다|은)/u.test(raw)) {
    return {
      kind: 'interpretation',
      summary: clipSummary('사용자가 붙인 ~것 같다/느껴지는 해석'),
      grounding: 'user'
    };
  }
  return {
    kind: 'interpretation',
    summary: '사용자가 현실에 붙인 의미·해석',
    grounding: 'user'
  };
}

function buildSajuStrand(evidencePacket) {
  const evidence = Array.isArray(evidencePacket?.evidence)
    ? evidencePacket.evidence
    : [];
  if (!evidence.length) return null;
  const scopes = [...new Set(evidence.map((item) => item?.scope).filter(Boolean))];
  const highlights = evidence
    .slice(0, 2)
    .map((item) => clipSummary(item?.label || item?.summary || item?.scope || '', 60))
    .filter(Boolean);
  const scopeText = scopes.length ? scopes.join(', ') : 'natal';
  const detail = highlights.length ? highlights.join(' · ') : scopeText;
  return {
    kind: 'saju',
    summary: clipSummary(`Engine evidence(${scopeText})가 보여주는 구조·시기 조건: ${detail}`),
    grounding: 'engine'
  };
}

export function buildIssueOverlap({
  userMessage = '',
  focus = null,
  evidencePacket = null
} = {}) {
  const text = cleanText(userMessage, 4000);
  const empty = {
    schemaVersion: COUNSELING_ISSUE_OVERLAP_VERSION,
    mode: 'simple',
    strands: []
  };

  if (!text) return empty;

  if (isFactualSajuQuestion(text)) {
    return { ...empty, mode: 'simple' };
  }
  if (isSimpleTimingQuestion(text, focus)) {
    return { ...empty, mode: 'simple' };
  }
  if (isSimpleChoiceWithoutOverlap(text)) {
    return { ...empty, mode: 'simple' };
  }
  if (isAmbiguousVague(text)) {
    return {
      schemaVersion: COUNSELING_ISSUE_OVERLAP_VERSION,
      mode: 'uncertain',
      strands: []
    };
  }

  const reality = detectRealityStrands(text);
  const emotion = detectEmotionStrand(text);
  const interpretation = detectInterpretationStrand(text);

  const multiClause = hasMultiProblemSyntax(text) || reality.length >= 2;

  const shouldCompound =
    (multiClause || reality.length >= 2) &&
    reality.length >= 1 &&
    (Boolean(emotion) || Boolean(interpretation) || reality.length >= 2);

  if (!shouldCompound) {
    if (text.length < 36 && !reality.length && !emotion && !interpretation) {
      return {
        schemaVersion: COUNSELING_ISSUE_OVERLAP_VERSION,
        mode: 'uncertain',
        strands: []
      };
    }
    return empty;
  }

  const strands = [];
  const realityLimit = interpretation || emotion ? 1 : 2;
  for (const item of reality.slice(0, realityLimit)) {
    strands.push(item);
  }
  if (emotion) {
    strands.push(emotion);
  }
  if (
    interpretation &&
    strands.length < MAX_STRANDS &&
    (!emotion || interpretation.summary !== emotion.summary)
  ) {
    strands.push(interpretation);
  }
  const saju = buildSajuStrand(evidencePacket);
  if (saju && strands.length < MAX_STRANDS) {
    strands.push(saju);
  }

  if (strands.length < 2) {
    return empty;
  }

  return {
    schemaVersion: COUNSELING_ISSUE_OVERLAP_VERSION,
    mode: 'compound',
    strands: strands.slice(0, MAX_STRANDS)
  };
}

export default Object.freeze({
  COUNSELING_ISSUE_OVERLAP_VERSION,
  buildIssueOverlap
});
