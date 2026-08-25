// api/chat.js
// Vercel Serverless Function: Gemini 2.0 Flash API 연동 브릿지

export default async function handler(req, res) {
  // CORS 헤더 설정
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      success: false,
      message: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다. Vercel 설정을 확인하세요.'
    });
  }

  const { mode, role, sajuContext, userMessage, history = [] } = req.body;

  // 시스템 프롬프트: 사주그랩 전문 AI 마스터
  const systemInstruction = `
당신은 전통 명리학의 심오한 원리를 현대적인 인생 에너지 코칭 언어로 해석하는 '사주그랩 AI 마스터'입니다.
과도한 미신이나 공포 마케팅을 철저히 배제하고, 질문자가 자신의 에너지 흐름(용신, 희신, 대운 파동)을 주도적으로 활용할 수 있도록 다정하면서도 통찰력 있게 조언합니다.

[내담자 사주 컨텍스트]
- 이름: ${sajuContext?.name || '사용자'}
- 사주 원국: 년주(${sajuContext?.pillars?.year || '-'}), 월주(${sajuContext?.pillars?.month || '-'}), 일주(${sajuContext?.pillars?.day || '-'}), 시주(${sajuContext?.pillars?.hour || '-'})
- 세력 판정: ${sajuContext?.analysis?.status || '-'} (신강 지수: ${sajuContext?.analysis?.strengthScore || '-'}점)
- 4대 운성: 용신(${sajuContext?.analysis?.yongsinProfile?.yongsin || '-'}), 희신(${sajuContext?.analysis?.yongsinProfile?.heesin || '-'}), 기신(${sajuContext?.analysis?.yongsinProfile?.gisin || '-'}), 구신(${sajuContext?.analysis?.yongsinProfile?.gusin || '-'})
- 현재 대운: ${sajuContext?.activeWave?.ganZhi || '-'}대운 (총운 점수: ${sajuContext?.activeWave?.scores?.total || 0}점)

[답변 원칙]
1. 정중하면서도 따뜻한 어조(해요체)를 유지합니다.
2. 명리학 용어를 쉽게 풀어서 설명하며, 일상과 커리어에서 실천할 수 있는 현실적인 조언 1가지를 반드시 포함합니다.
3. 팝업 해설 모드('insight')일 때는 3~4문장으로 핵심만 컴팩트하게 전달합니다.
4. 일반 대화 모드('chat')일 때는 이전 대화 맥락과 사주 데이터를 결합하여 구체적인 답변을 제공합니다.
`;

  try {
    let contents = [];

    if (mode === 'insight') {
      contents = [
        {
          role: 'user',
          parts: [
            {
              text: `내담자의 사주에서 [${role}]에 해당하는 에너지(${sajuContext?.analysis?.yongsinProfile?.[role === '용신' ? 'yongsin' : role === '희신' ? 'heesin' : role === '기신' ? 'gisin' : 'gusin'] || role})에 대해 심층 해설해 주세요. 왜 이 기운이 중요한지, 그리고 일상에서 어떻게 다루어야 하는지 다정하게 설명해 주세요.`
            }
          ]
        }
      ];
    } else {
      contents = history.map(h => ({
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text: h.text }]
      }));
      contents.push({
        role: 'user',
        parts: [{ text: userMessage }]
      });
    }

    // Gemini 2.0 Flash 정식 모델 엔드포인트 호출
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 800
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini API Error:', data);
      return res.status(response.status).json({ success: false, message: data.error?.message || 'Gemini API 호출 오류' });
    }

    const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || '답변을 생성하지 못했습니다.';

    return res.status(200).json({
      success: true,
      reply: replyText
    });
  } catch (error) {
    console.error('API Handler Error:', error);
    return res.status(500).json({ success: false, message: '서버 내부 오류가 발생했습니다.' });
  }
}
