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
