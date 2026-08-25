// api/chat.js
// 사주그랩 룰북 기반 Gemini 3.7 Flash 실시간 해설 및 심층 리포트 생성

import { CHAT_SYSTEM_PROMPT, buildDomainCyclePrompt } from '../lib/sajuRulebook.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ success: false, message: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다.' });

  const { mode = 'summary', role, domain = '총운', cycle = '대운', score = 0, sajuContext, userMessage, history = [] } = req.body || {};

  try {
    const dayPillar = sajuContext?.pillars?.day || sajuContext?.dayPillar || '병신';
    const dayHanja = sajuContext?.pillars?.dayHanja || '丙申';
    const userName = sajuContext?.name || '내담자';

    let userPrompt = '';
    let maxTokens = 1200;

    if (mode === 'summary' || mode === 'detail') {
      userPrompt = buildDomainCyclePrompt({
        name: userName,
        dayPillar,
        dayHanja,
        domain,
        cycle,
        score,
        role,
        mode
      });
      if (mode === 'detail') maxTokens = 2500;
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
          systemInstruction: { parts: [{ text: CHAT_SYSTEM_PROMPT }] },
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
      return res.status(response.status).json({ success: false, message: data.error?.message || 'Gemini API 호출 실패' });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '답변을 생성하지 못했습니다.';
    return res.status(200).json({ success: true, reply });

  } catch (error) {
    return res.status(500).json({ success: false, message: '통신 오류: ' + error.message });
  }
}
