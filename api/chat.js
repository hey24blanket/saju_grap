// api/chat.js
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

  const { mode = 'summary', role, domain, cycle, score, sajuContext, userMessage, history = [] } = req.body || {};

  try {
    let userPrompt = '';
    let maxTokens = 1000;

    if (mode === 'summary') {
      maxTokens = 600;
      if (role) {
        userPrompt = `내담자(${sajuContext?.name || '사용자'}, 일주: ${sajuContext?.pillars?.day || '미정'})의 사주 원국에서 [${role}] 기운에 대한 전략적 해설을 작성해 주세요.
이 기운이 내담자의 삶에서 갖는 쓰임새와 일상에서 에너지를 극대화/조율할 수 있는 행동 지침을 공백 포함 정확히 250~300자 내외로 다정하고 명확하게 작성하세요.`;
      } else {
        userPrompt = `내담자(${sajuContext?.name || '사용자'}, 일주: ${sajuContext?.pillars?.day || '미정'})의 [${cycle || '대운'} 주기 - ${domain || '총운'}] (파동 에너지 점수: ${score || 0}점)에 대한 실시간 행동 전략을 작성해 주세요.
사주그랩 파동 지침서의 에너지 극성 원리를 적용하여, 지금 당장 취해야 할 행동 모드와 주의점을 공백 포함 정확히 250~300자 내외로 작성하세요.`;
      }
    } else if (mode === 'detail') {
      maxTokens = 2500;
      userPrompt = `내담자(${sajuContext?.name || '사용자'}, 일주: ${sajuContext?.pillars?.day || '미정'})의 [${cycle || '대운'} 주기 - ${domain || role || '총운'}]에 대한 1,500자 분량의 심층 전략 리포트를 3단계 프레임워크에 맞춰 작성해 주세요.`;
    }

    let contents = [];
    if (mode === 'chat') {
      maxTokens = 1200;
      contents = history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] }));
      contents.push({ role: 'user', parts: [{ text: userMessage }] });
    } else {
      contents = [{ role: 'user', parts: [{ text: userPrompt }] }];
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
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
    if (!response.ok) return res.status(response.status).json({ success: false, message: data.error?.message });

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '답변을 생성하지 못했습니다.';
    return res.status(200).json({ success: true, reply });

  } catch (error) {
    return res.status(500).json({ success: false, message: '통신 오류: ' + error.message });
  }
}
