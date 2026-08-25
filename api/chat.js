// api/chat.js
// Vercel 500 에러 원천 차단: 사주그랩 룰북 전문 내장 + 300자 3단 구조화 & 프리페치

const CHAT_SYSTEM = `
[사주그랩 (Saju Grap) 파동 역학 & 전략적 명리 지침서 v1.0]

1. 3대 핵심 철학
- 모든 운은 파동과 리듬이다: 길/흉 이분법을 배제하고 '발산·중립·수렴' 에너지 스펙트럼으로 해석한다.
- 사주에 나쁜 것은 없다: 기운의 성패를 묻지 않고 "지금 이 기운을 어떻게 쓸 것인가" 행동 쓰임새를 제시한다.
- 바닥을 알면 버틸 수 있고 전체를 보면 무너지지 않는다: 저점(묘·절·태)은 '추가 하락 여지가 없는 절대 바닥'의 안도감으로 해석하며, 영역 간 엇갈림(Divergence)으로 에너지를 재배분한다.

2. 5대 영역(Domain)별 고유 테마
- [총운]: 거시적 삶의 흐름과 종합적 에너지 완급 조절
- [사업운]: 추진력, 실행, 론칭, 파일럿 프로젝트, 리더십
- [재물운]: 결실 수확, 자산 재편, 고정비 절감, 시스템화
- [심신운]: Deep Work, 멘탈 리셋, 수면/체력 회복, 번아웃 방지
- [연애운]: 인간관계, 라포 형성, 파트너십, 동시성 조율

3. 5대 주기(Cycle)별 시간 단위
- [시운]: 하루 중 최적의 몰입 및 행동 시간대 조율
- [일운]: 오늘 하루의 핵심 우선순위 행동
- [월운]: 이번 달(4주)의 프로젝트 마일스톤 및 완충
- [연운]: 올해 1년 단위의 환경 변화 대응
- [대운]: 10년 단위의 인생 지형도 및 장기 판짜기

4. 절대 금지 어휘: "대박운", "최악이다", "조심하라", "망한다", "배우자운이 없다", (300자) 등 글자수 표기 일체 금지.
당신은 사주그랩 수석 명리 전략 컨설턴트입니다. 100% 품격 있고 다정한 한국어(해요체)로, [3단 문장 규격: 상태 진단 -> 흐름 분석 -> 구체적 행동 제안]에 맞춰 완결된 3~4문장으로 서술하십시오.
`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ success: false, message: 'GEMINI_API_KEY 미설정' });

  const { mode = 'summary', role, domain = '총운', cycle = '대운', score = 0, cycleScores, sajuContext, userMessage, history = [] } = req.body || {};

  try {
    const dayPillar = sajuContext?.pillars?.day || sajuContext?.dayPillar || '병신';
    const dayHanja = sajuContext?.pillars?.dayHanja || '丙申';
    const userName = sajuContext?.name || '내담자';

    let userPrompt = '';
    let isJsonMode = false;
    let maxTokens = 1500;

    if (mode === 'prefetch') {
      isJsonMode = true;
      maxTokens = 2000;
      userPrompt = `
내담자 ${userName}님(일주: ${dayHanja}, ${dayPillar}일주)의 [${cycle}] 주기에 대한 5대 영역 맞춤 행동 전략을 모두 작성하세요.
각 영역별 파동 점수: 총운(${cycleScores?.all ?? 0}점), 사업운(${cycleScores?.career ?? 0}점), 재물운(${cycleScores?.wealth ?? 0}점), 심신운(${cycleScores?.mental ?? 0}점), 연애운(${cycleScores?.love ?? 0}점)

[작성 규칙]
반드시 [3단 문장 규격: 상태 진단 -> 흐름 분석 -> 구체적 실행 과제]에 맞춰 각 항목당 공백 포함 280~320자 내외로 풍부하게 작성하세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "all": "총운 300자 해설",
  "career": "사업운 300자 해설",
  "wealth": "재물운 300자 해설",
  "mental": "심신운 300자 해설",
  "love": "연애운 300자 해설"
}
`;
    } else if (mode === 'summary') {
      if (role) {
        userPrompt = `내담자 ${userName}님(일주: ${dayHanja}, ${dayPillar}일주)의 사주 원국에서 [${role}] 기운에 대한 전략적 해설을 [3단 문장 규격]에 맞춰 공백 포함 280~320자 내외로 품격 있게 작성해 주세요.`;
      } else {
        userPrompt = `내담자 ${userName}님(일주: ${dayHanja}, ${dayPillar}일주)의 [${cycle} 주기 - ${domain}] (파동 에너지 점수: ${score >= 0 ? '+' : ''}${score}점)에 대한 맞춤 행동 전략을 [3단 문장 규격]에 맞춰 공백 포함 280~320자 분량으로 작성해 주세요.`;
      }
    } else if (mode === 'detail') {
      maxTokens = 2500;
      userPrompt = `내담자 ${userName}님(일주: ${dayHanja}, ${dayPillar}일주)의 [${cycle} 주기 - ${domain || role || '총운'}] (파동 점수: ${score}점)에 대한 1,500자 분량의 심층 전략 리포트를 3단계 프레임워크(1단계: 에너지 구조와 본질 / 2단계: 기회와 리스크 관리 / 3단계: 3개월 단계별 액션 플랜)에 맞춰 작성해 주세요.`;
    }

    let contents = [];
    if (mode === 'chat') {
      maxTokens = 1200;
      contents = history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] }));
      contents.push({ role: 'user', parts: [{ text: userMessage }] });
    } else {
      contents = [{ role: 'user', parts: [{ text: userPrompt }] }];
    }

    const requestBody = {
      systemInstruction: { parts: [{ text: CHAT_SYSTEM }] },
      contents,
      generationConfig: {
        temperature: 0.75,
        maxOutputTokens: maxTokens
      }
    };

    if (isJsonMode) {
      requestBody.generationConfig.responseMimeType = "application/json";
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      }
    );

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ success: false, message: data.error?.message || 'Gemini API 호출 오류' });
    }

    const rawReply = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    if (isJsonMode) {
      try {
        const cleaned = rawReply.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonResult = JSON.parse(cleaned);
        return res.status(200).json({ success: true, data: jsonResult });
      } catch (err) {
        return res.status(200).json({ success: false, message: 'JSON 파싱 실패' });
      }
    }

    return res.status(200).json({ success: true, reply: rawReply });

  } catch (error) {
    return res.status(500).json({ success: false, message: '통신 오류: ' + error.message });
  }
}
