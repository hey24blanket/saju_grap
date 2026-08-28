// lib/chatScopeGuard.js
// SajuGrap 상담 범위 가드
// -----------------------------------------------------------------------------
// 목적
// - 현실 맥락 설명은 허용한다.
// - 독립적인 업무 결과물 생성 요청은 차단한다.
// - 명백한 범위 밖 요청만 deterministic하게 차단한다.
// - 애매한 요청은 차단하지 않고 CHAT_SYSTEM의 scope rule에 맡긴다.
// -----------------------------------------------------------------------------

export const CHAT_SCOPE_GUARD_VERSION = 'scope_guard_v1.0.0';

const CREATION_VERB = /(짜\s*줘|짜줘|만들\s*어?\s*줘|만들어줘|작성\s*해?\s*줘|작성해줘|설계\s*해?\s*줘|설계해줘|구성\s*해?\s*줘|구성해줘|배치\s*해?\s*줘|배치해줘|정해\s*줘|정해줘|완성\s*해?\s*줘|완성해줘|고쳐\s*줘|고쳐줘|수정\s*해?\s*줘|수정해줘|출력\s*해?\s*줘|출력해줘|추천\s*해?\s*줘|추천해줘)/i;

function has(text, regex) {
  return regex.test(text);
}

function result({
  blocked,
  category = null,
  reason = null,
  confidence = 'high'
}) {
  return {
    schemaVersion: 'chat_scope_decision_v1',
    guardVersion: CHAT_SCOPE_GUARD_VERSION,
    blocked,
    category,
    reason,
    confidence
  };
}

export function evaluateChatScope(message) {
  const text = String(message || '').trim();

  if (!text) {
    return result({
      blocked: false,
      confidence: 'high'
    });
  }

  // 1) 조직 설계 / 인사 운영 결과물
  const orgArtifact = /(조직도|인원\s*배치표|인력\s*배치표|인원\s*배치|인력\s*배치|업무\s*분장표|직무\s*기술서|성과\s*평가표|평가표|KPI|팀별\s*인원)/i;

  if (
    has(text, orgArtifact) &&
    has(text, CREATION_VERB)
  ) {
    return result({
      blocked: true,
      category: 'organization_deliverable',
      reason: '독립적인 조직/인력 운영 결과물 생성 요청'
    });
  }

  // 2) 프로그래밍/개발 작업 대행
  const codeArtifact = /(React|Python|JavaScript|TypeScript|Node\.?js|코드|소스\s*코드|버그|API\s*코드|SQL)/i;
  const codeAction = /(고쳐|수정|작성|구현|전체\s*코드|코딩|디버깅|리팩터링|만들)/i;

  if (
    has(text, codeArtifact) &&
    has(text, codeAction)
  ) {
    return result({
      blocked: true,
      category: 'coding_deliverable',
      reason: '독립적인 개발/코딩 작업 대행 요청'
    });
  }

  // 3) 계약서/내용증명 등 전문 문서 완성
  const legalArtifact = /(내용증명|계약서|합의서|법률\s*문서|소장|답변서)/i;
  const legalAction = /(작성|완성|초안|문구\s*써|대신\s*써|만들)/i;

  if (
    has(text, legalArtifact) &&
    has(text, legalAction)
  ) {
    return result({
      blocked: true,
      category: 'legal_document_deliverable',
      reason: '법률/계약 문서 자체의 작성 대행 요청'
    });
  }

  // 4) 투자 포트폴리오/매수·매도 결정 대행
  const investmentArtifact = /(ETF|주식|코인|암호화폐|펀드|포트폴리오|종목)/i;
  const investmentAction = /(몇\s*%|비중|매수|매도|살까|팔까|종목\s*추천|구성|배분|날짜\s*찍|언제\s*사)/i;

  if (
    has(text, investmentArtifact) &&
    has(text, investmentAction)
  ) {
    return result({
      blocked: true,
      category: 'investment_execution',
      reason: '구체적인 투자 구성/매매 결정 대행 요청'
    });
  }

  // 5) 약물/용량 지정
  const medicalArtifact = /(수면제|진통제|항우울제|약|영양제|보충제|mg|복용량|용량)/i;
  const medicalAction = /(몇\s*mg|얼마나|먹어|복용|추천|용량|처방)/i;

  if (
    has(text, medicalArtifact) &&
    has(text, medicalAction)
  ) {
    return result({
      blocked: true,
      category: 'medical_dosing',
      reason: '약물/보충제의 구체적 복용량 또는 선택 요청'
    });
  }

  // 6) 여행 일정 대행
  const travelArtifact = /(여행|맛집|호텔|숙소|관광|동선|3박|4일|2박|일정)/i;
  const travelAction = /(시간별|코스|일정\s*짜|짜\s*줘|계획\s*짜|호텔.*추천|맛집.*추천|동선.*짜)/i;

  if (
    has(text, travelArtifact) &&
    has(text, travelAction)
  ) {
    return result({
      blocked: true,
      category: 'travel_planning',
      reason: '독립적인 여행 일정/추천 결과물 생성 요청'
    });
  }

  // 7) 문서 전체 번역 대행
  const translationArtifact = /(번역|translate)/i;
  const translationScope = /(전부|전체|통째로|전문|\d+\s*페이지|문서|계약서)/i;

  if (
    has(text, translationArtifact) &&
    has(text, translationScope)
  ) {
    return result({
      blocked: true,
      category: 'full_document_translation',
      reason: '상담 맥락을 넘어선 문서 전체 번역 대행 요청'
    });
  }

  // 8) 명시적인 사주그랩 해제/우회 + 범용 작업 요청
  const bypass = /(이전\s*지시.*무시|시스템\s*메시지.*무시|사주그랩.*해제|일반\s*GPT|범용\s*AI|사주\s*(얘기|이야기)?\s*는?\s*빼고)/i;

  if (
    has(text, bypass) &&
    has(text, CREATION_VERB)
  ) {
    return result({
      blocked: true,
      category: 'scope_bypass',
      reason: '사주그랩 상담 범위를 우회해 범용 작업을 요청'
    });
  }

  // 명백한 업무 대행 패턴이 아니면 차단하지 않는다.
  // 회사/계약/관계/재무 등에 대한 맥락 설명은 상담에 필요할 수 있다.
  return result({
    blocked: false,
    category: 'counseling_or_ambiguous',
    reason: '명백한 독립 업무 대행 요청으로 판정되지 않음',
    confidence: 'medium'
  });
}

export function buildScopeRedirect(decision) {
  switch (decision?.category) {
    case 'organization_deliverable':
      return '조직도나 인원 배치표 자체를 설계해드리는 건 사주그랩의 상담 범위를 벗어나요. 다만 지금 인력 구조를 바꾸려는 이유가 확장, 비용 부담, 역할 충돌, 책임 과부하 중 어디에 가까운지 이야기해주시면 그 현실 조건과 현재 사주 흐름을 함께 보고 어떤 판단 기준을 두는 게 좋은지는 정리해드릴 수 있어요.';

    case 'coding_deliverable':
      return '코드를 직접 작성하거나 디버깅하는 작업은 사주그랩의 상담 범위를 벗어나요. 다만 그 개발 문제 때문에 일정, 사업 방향, 협업, 역할 부담 같은 선택을 고민하고 있다면 그 의사결정은 현재 흐름과 함께 볼 수 있어요.';

    case 'legal_document_deliverable':
      return '계약서나 내용증명 같은 법률 문서를 완성해서 작성해드리는 건 사주그랩의 상담 범위를 벗어나요. 대신 지금 계약·정산 문제에서 무엇이 가장 부담인지, 관계를 유지하면서 어느 시점에 경계를 세우고 대응 강도를 높일지 같은 선택은 현실 조건과 사주 흐름을 함께 놓고 볼 수 있어요.';

    case 'investment_execution':
      return '구체적인 종목, 투자 비중, 매수·매도 시점을 대신 정하는 건 사주그랩의 상담 범위를 벗어나요. 다만 지금 재정에서 확장과 보수 중 어느 쪽에 무게를 둘지, 현금 완충과 위험 부담을 어떻게 조절할지 같은 재물 운영 전략은 현재 흐름과 함께 볼 수 있어요.';

    case 'medical_dosing':
      return '약이나 영양제의 종류와 복용량을 정해드리는 건 사주그랩의 상담 범위를 벗어나요. 대신 최근의 소진, 수면, 스트레스와 생활 리듬을 현재 심신 흐름과 함께 살펴보고 무엇을 줄이고 회복에 무엇을 우선할지는 이야기할 수 있어요.';

    case 'travel_planning':
      return '맛집·호텔·시간별 동선을 포함한 여행 일정 자체를 짜드리는 건 사주그랩의 상담 범위를 벗어나요. 다만 이번 이동이나 여행을 왜 고민하는지, 변화와 휴식 중 무엇이 필요한 시기인지 같은 부분은 현재 흐름과 함께 볼 수 있어요.';

    case 'full_document_translation':
      return '문서 전체를 번역하는 작업은 사주그랩의 상담 범위를 벗어나요. 다만 그 문서의 어떤 조건 때문에 사업·관계·재정 판단이 필요한지 핵심 내용을 알려주시면 그 고민은 상담 맥락으로 함께 볼 수 있어요.';

    default:
      return '그 작업 자체를 대신 수행하는 것은 사주그랩의 상담 범위를 벗어나요. 다만 그 요청을 하게 된 현실 고민과 선택의 부담을 이야기해주시면, 현재 Engine Facts와 사주그랩 해석 기준을 바탕으로 어떤 판단 기준을 두는 것이 좋은지는 함께 정리해드릴 수 있어요.';
  }
}

export default Object.freeze({
  version: CHAT_SCOPE_GUARD_VERSION,
  evaluateChatScope,
  buildScopeRedirect
});
