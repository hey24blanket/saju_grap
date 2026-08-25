// api/chat.js
// 1,500자 3단계 심층 리포트 및 실시간 상담사

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ success: false, message: 'GEMINI_API_KEY 미설정' });

  const { mode = 'chat', role, domain, cycle, sajuContext, userMessage, history = [] } = req.body;

  const systemInstruction = `
당신은 '사주그랩(Saju Grap) 파동 역학 & 전략적 명리 지침서' 기반 수석 컨설턴트입니다[cite: 2].

[사주그랩 3단계 심층 컨설팅 프레임워크]
자세히 보기(detail) 요청 시 아래 3단계 구조로 **공백 포함 1,200~1,500자 분량**의 깊이 있는 리포트를 작성하세요[cite: 2]:
1. [에너지 구조와 본질]: 내담자의 사주 원국에서 해당 영역/기운이 갖는 근본적 의미와 시간축 상의 위치[cite: 2].
2. [기회와 리스크 관리]: 파동의 극성(발산/수렴)에 따른 상단 시나리오(기회)와 하단선 방어(리스크 완충) 전략[cite: 2].
3. [3개월 단계별 액션 플랜]:
   - 1개월차: 즉시 착수할 핵심 행동 및 필터링 과제[cite: 2].
   - 2개월차: 시스템 구축 및 루틴 안정화[cite: 2].
   - 3개월차: 성과 수확 및 다음 사이클 대비[cite: 2].

100% 품격 있는 한국어(해요체)로 작성하며 영문 소제목은 절대 사용하지 마세요.
`;

  try {
    let contents = [];

    if (mode === 'detail') {
      contents = [{
        role: 'user',
        parts: [{
          text: `내담자(${sajuContext?.name || '사용자'}, 일주: ${sajuContext?.pillars?.day || ''})의 [${cycle || '대운'} 주기 - ${domain || role}]에 대한 1,500자 심층 전략 리포트를 3단계 프레임워크(본질 -> 기회/리스크 -> 3개월 액션 플랜)에 맞춰 작성해 주세요.`[cite: 2]
        }]
      }];
    } else {
      contents = history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] }));
      contents.push({ role: 'user', parts: [{ text: userMessage }] });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: {
            temperature: 0.75,
            maxOutputTokens: 2500
          }
        })
      }
    );

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ success: false, message: data.error?.message });

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '답변을 생성하지 못했습니다.';
    return res.status(200).json({ success: true, reply });
  } catch (error) {
    return res.status(500).json({ success: false, message: '통신 오류' });
  }
}
