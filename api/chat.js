// api/chat.js
// Gemini 3.7 Flash 모델 적용: 심층 리포트 및 실시간 챗봇

import { CHAT_SYSTEM } from '../lib/sajuRulebook.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ success: false, message: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다.' });

  const { mode = 'chat', role, domain, cycle, sajuContext, userMessage, history = [] } = req.body || {};

  try {
    let contents = [];
    let maxTokens = 1500;

    if (mode === 'detail') {
      maxTokens = 2500;
      const detailPrompt = `내담자(${sajuContext?.name || '사용자'}, 일주: ${sajuContext?.pillars?.day || '미정'})의 [${cycle || '대운'} 주기 - ${domain || role || '총운'}]에 대한 심층 전략 리포트를 3단계 프레임워크(본질 분석 -> 기회와 리스크 관리 -> 3개월 단계별 액션 플랜)에 맞춰 품격 있고 완결된 문장으로 작성해 주세요.`;
      contents = [{ role: 'user', parts: [{ text: detailPrompt }] }];
    } else {
      contents = history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] }));
      contents.push({ role: 'user', parts: [{ text: userMessage }] });
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
            temperature: 0.75,
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
