// Route only the simple, context-card overview questions. Personal dilemmas and
// follow-up conversations continue through the full counseling orchestrator.
export function isReadingOverviewQuestion(value) {
  const text = String(value || '').replace(/\s/g, '').replace(/[?.!。？]/g, '');
  if (text === '지금한가지에집중한다면무엇을살펴볼까요') return true;
  return /^(?:지금)?(?:선택한)?(?:(?:\d{4}년)?(?:\d{1,2}월)?(?:\d{1,2}일)?의?)?(?:이)?흐름을(?:일상에서)?어떻게(?:쓰면|활용하면)좋을까요$/u.test(text);
}
export function buildReadingOverviewPrompt(context, question) {
  return {
    systemInstruction: `당신은 사주 그랩의 편안한 해설자입니다. 아래 서버 검증 해설만 쉬운 한국어 3~4문장으로 풀어주세요.
선택일, 파동의 의미, 작게 해볼 한 가지를 자연스럽게 연결하세요. 한자와 전문용어를 나열하지 마세요.
모으기·펼치기·전환은 동등한 활용 방식입니다. 성공 확률, 사건의 예언, 좋고 나쁨을 뜻하지 않습니다.
이 단계는 선택 구간의 십이운성에 대한 해석입니다. 제공되지 않은 원국·대운·연운이 이 흐름을 만들었다고 말하지 마세요.
사용자의 성격, 감정, 현실 상황을 추측하지 마세요. 추가 질문 없이 읽고 마칠 수 있게 하세요.
JSON의 reply에 해설을 담고, stateDelta의 subjects/observations/goals/constraints/attempts/hypotheses/corrections/openQuestions는 모두 빈 배열로 반환하세요.`,
    userPrompt: JSON.stringify({ question, reading: { selectedPeriod: context.selected.label, selectedDate: context.selected.date, referenceDate: context.referenceDate, phase: context.phase, meaning: context.meaning, evidence: context.selected.evidence, domain: context.domain, suggestedAction: context.action } })
  };
}
