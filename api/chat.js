// api/chat.js
// 5대 운 x 5대 주기 x 파동 점수 정밀 프롬프트 엔진

import { CHAT_SYSTEM } from '../lib/sajuRulebook.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ success: false, message: 'GEMINI_API_KEY 미설정' });

  const { mode = 'summary', role, domain = '총운', cycle = '대운', score = 0, sajuContext, userMessage, history = [] } = req.body || {};

  try {
    let userPrompt = '';
    let maxTokens = 1200;

    const dayPillar = sajuContext?.pillars?.day || sajuContext?.dayPillar || '병신';
    const dayHanja = sajuContext?.pillars?.dayHanja || '丙申';
    const userName = sajuContext?.name || '내담자';

    if (mode === 'summary') {
      if (role) {
        userPrompt = `내담자 ${userName}님(일주: ${dayHanja}, ${dayPillar}일주)의 사주 원국에서 [${role}] 기운에 대한 전략적 해설을 작성해 주세요.
이 기운의 본질적 역할과 일상에서 에너지를 극대화/조율할 수 있는 실천 팁을 완결된 3~4문장의 품격 있는 한국어로 작성하세요.`;
      } else {
        userPrompt = `내담자 ${userName}님(일주: ${dayHanja}, ${dayPillar}일주)의 [${cycle} 주기 - ${domain}] (현재 파동 에너지 점수: ${score >= 0 ? '+' : ''}${score}점)에 대한 맞춤 행동 전략을 작성해 주세요.

[반드시 준수할 작성 기준]
1. [${cycle}]의 시간 단위 특성(시:당일시간대, 일:오늘하루, 월:이번달, 연:올해, 대운:10년주기)을 명확히 반영하세요.
2. [${domain}]의 고유 테마(총운:거시흐름, 사업:추진/실행, 재물:결실/자산재편, 심신:내실/회복, 연애:화합/교류)에 맞는 차별화된 조언을 제공하세요.
3. 파동 점수(${score}점)에 따른 에너지 극성(발산/수렴/중립)을 적용하여, 지금 당장 유리한 구체적 행동 1가지와 주의점을 완결된 3~4문장으로 서술하세요. 다른 운과 절대 똑같은 말을 반복하지 마세요.`;
      }
    } else if (mode === 'detail') {
      maxTokens = 2500;
      userPrompt = `내담자 ${userName}님(일주: ${dayHanja}, ${dayPillar}일주)의 [${cycle} 주기 - ${domain || role || '총운'}] (파동 점수: ${score}점)에 대한 1,500자 분량의 심층 전략 리포트를 3단계 프레임워크(1단계: 에너지 구조와 본질 / 2단계: 기회와 리스크 관리 / 3단계: 3개월 단계별 액션 플랜)에 맞춰 품격 있고 완결된 문장으로 작성해 주세요.`;
    }

    let contents = [];
    if (mode === 'chat') {
      contents = history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] }));
      contents.push({ role: 'user', parts: [{ text: userMessage }] });
    } else {
      contents = [{ role: 'user', parts: [{ text: userPrompt }] }];
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: CHAT_SYSTEM }] },
          contents,
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: maxTokens
          }
        })
      }
    );

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ success: false, message: data.error?.message || 'Gemini API 호출 오류' });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '답변을 생성하지 못했습니다.';
    return res.status(200).json({ success: true, reply });

  } catch (error) {
    return res.status(500).json({ success: false, message: '통신 오류: ' + error.message });
  }
}
