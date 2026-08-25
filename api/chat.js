// api/chat.js
// 자세히 보기(1,500자) 및 실시간 AI 상담사 엔드포인트

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
당신은 '사주그랩(Saju Grap) 파동 역학 & 전략적 명리 지침서' 기반 수석 명리 전략 컨설턴트입니다.[cite: 2]
1. 운은 길흉이 아니라 "지금 어떤 행동 모드가 유리한지 읽는 시간의 구조"입니다.[cite: 2]
2. Y축 점수는 에너지 극성(+100 발산 ~ -100 수렴)을 나타냅니다.[cite: 2]
3. 100% 품격 있는 한국어로 작성하며, 영문 소제목은 절대 사용하지 않습니다.
4. '자세히 보기(detail)' 요청 시, 아래 3단계 프레임워크를 기반으로 **공백 포함 1,200~1,500자의 풍부하고 깊이 있는 전략 리포트**를 작성합니다[cite: 2]:
   - 1단계: 해당 영역/에너지의 본질과 사주 원국에서의 구조적 의미[cite: 2]
   - 2단계: 파동의 상승/하강 국면에서 얻는 구체적 기회와 리스크 관리법[cite: 2]
   - 3단계: 내담자가 즉시 실행할 수 있는 구체적인 3개월 단계별 액션 플랜 (1개월차/2개월차/3개월차)[cite: 2]
`;

  try {
    let contents = [];

    if (mode === 'detail') {
      contents = [{
        role: 'user',
        parts: [{
          text: `내담자(${sajuContext?.name || '사용자'}, 일주: ${sajuContext?.pillars?.day || ''})의 [${cycle || '대운'} 주기 - ${domain || role}]에 대한 1,500자 분량의 심층 전략 리포트를 작성해 주세요. 
사주그랩 파동역학 지침서의 3단계 프레임워크(본질 분석 -> 기회와 리스크 -> 3개월 액션 플랜)를 충실히 반영하여 다정하고 통찰력 있게 작성해 주세요.`[cite: 2]
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
    return res.status(500).json({ success: false, message: '서버 통신 오류' });
  }
}
