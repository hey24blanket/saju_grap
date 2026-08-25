// api/analyze.js
import { ANALYZE_SYSTEM } from '../lib/sajuRulebook.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  const { name = '사용자', year = 1995, month = 5, day = 15, hour = 12, minute = 0, gender = 1 } = req.body || {};
  const apiKey = process.env.GEMINI_API_KEY;

  try {
    const ganHanja = { '갑':'甲', '을':'乙', '병':'丙', '정':'丁', '무':'戊', '기':'己', '경':'庚', '신':'辛', '임':'壬', '계':'癸' };
    const zhiHanja = { '자':'子', '축':'丑', '인':'寅', '묘':'卯', '진':'辰', '사':'巳', '오':'午', '미':'未', '신':'申', '유':'酉', '술':'戌', '해':'亥' };
    const elementsKor = { '갑':'나무', '을':'나무', '병':'불', '정':'불', '무':'흙', '기':'흙', '경':'쇠', '신':'쇠', '임':'물', '계':'물' };

    const ganList = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
    const zhiList = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];

    const parsedYear = parseInt(year, 10) || 1995;
    const parsedMonth = parseInt(month, 10) || 5;
    const parsedDay = parseInt(day, 10) || 15;
    const parsedHour = parseInt(hour, 10) || 12;

    const yIndex = Math.abs((parsedYear - 4) % 60);
    const yearGan = ganList[yIndex % 10];
    const yearZhi = zhiList[yIndex % 12];
    const monthGan = ganList[(yIndex * 2 + parsedMonth) % 10];
    const monthZhi = zhiList[(parsedMonth + 1) % 12];
    const dayGan = ganList[(Math.floor(parsedYear * 5.25) + parsedMonth * 2 + parsedDay) % 10];
    const dayZhi = zhiList[(parsedDay + 4) % 12];
    const hourGan = ganList[(ganList.indexOf(dayGan) * 2 + Math.floor(parsedHour / 2)) % 10];
    const hourZhi = zhiList[Math.floor((parsedHour + 1) / 2) % 12];

    const dayGanHanja = ganHanja[dayGan] || '壬';
    const dayElemKor = elementsKor[dayGan] || '물';
    const dayPillarStr = `${dayGanHanja}${zhiHanja[dayZhi] || '午'}`;

    const cyclesData = {
      daewoon: {
        labels: ['무진(4세)', '기사(14세)', '경오(24세)', '신미(34세)', '임신(44세)', '계유(54세)', '갑술(64세)', '을해(74세)', '병자(84세)', '정축(94세)'],
        total: [45, 68, 55, 22, -25, -60, -70, -42, 0, 42],
        career: [60, 75, 50, 0, -35, -55, -45, -20, 10, 30],
        wealth: [40, 48, 32, 10, -20, -50, -60, -40, 15, 35],
        mental: [-25, -50, -42, -8, 72, 80, 55, 12, -20, -30],
        love: [0, 50, 60, -45, 20, 48, 30, -50, 32, -40]
      },
      year: {
        labels: ['2022년', '2023년', '2024년', '2025년', '2026년', '2027년', '2028년', '2029년', '2030년', '2031년'],
        total: [20, 45, 60, 35, -15, -45, -20, 30, 55, 40],
        career: [30, 60, 70, 20, -30, -50, -10, 40, 65, 50],
        wealth: [15, 35, 55, 40, -10, -35, -15, 25, 45, 30],
        mental: [-10, -30, -45, -20, 40, 65, 35, -15, -30, -20],
        love: [25, 40, -20, 50, 10, -40, 45, 20, -10, 35]
      },
      month: {
        labels: ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'],
        total: [-20, 10, 40, 65, 50, 20, -15, -40, -55, -30, 15, 35],
        career: [-10, 25, 55, 80, 60, 10, -25, -50, -60, -20, 20, 45],
        wealth: [-30, 0, 30, 50, 45, 25, -10, -35, -45, -25, 10, 30],
        mental: [40, 10, -20, -45, -35, -10, 30, 60, 70, 45, -10, -25],
        love: [10, 35, 50, -20, 40, 60, 20, -30, 15, 40, -15, 20]
      },
      day: {
        labels: ['1일', '5일', '10일', '15일', '20일', '25일', '30일'],
        total: [15, 45, 60, 20, -30, -15, 35],
        career: [25, 60, 75, 10, -45, -10, 45],
        wealth: [10, 35, 45, 30, -20, -15, 25],
        mental: [-15, -35, -50, 0, 55, 30, -20],
        love: [30, 10, -25, 45, 20, -35, 40]
      },
      hour: {
        labels: ['자시', '축시', '인시', '묘시', '진시', '사시', '오시', '미시', '신시', '유시', '술시', '해시'],
        total: [-40, -20, 15, 45, 60, 75, 50, 20, -10, -35, -50, -45],
        career: [-50, -30, 20, 60, 80, 90, 65, 30, 0, -30, -45, -50],
        wealth: [-35, -15, 10, 40, 55, 65, 40, 15, -15, -25, -40, -35],
        mental: [60, 45, 0, -30, -50, -65, -40, -10, 30, 55, 65, 60],
        love: [-10, 20, 40, 55, 30, -15, 45, 60, 10, -25, 35, -10]
      }
    };

    let aiPack = null;
    if (apiKey) {
      const prompt = `
내담자: ${name} (일간: ${dayGanHanja} ${dayElemKor}, 사주: ${yearGan}${yearZhi}년 ${monthGan}${monthZhi}월 ${dayGan}${dayZhi}일 ${hourGan}${hourZhi}시)

요구사항:
1. 4대 운성(yongsin, heesin, gisin, gusin), 세력균형(strength), 대운흐름(flow)에 대해 완결된 문장으로 명리 해설을 작성하세요.
2. 5대 주기(daewoon, year, month, day, hour)와 5대 영역(all, career, wealth, mental, love)에 대한 25개 시나리오 행동 전략을 모두 작성하세요.
3. 글자가 중간에 잘리지 않도록 완결된 문장으로 끝맺으세요.

반드시 아래 JSON Schema 규격으로만 응답하세요:
{
  "yongsin": "용신 심층 해설 (완결된 문장)",
  "heesin": "희신 심층 해설 (완결된 문장)",
  "gisin": "기신 심층 해설 (완결된 문장)",
  "gusin": "구신 심층 해설 (완결된 문장)",
  "strength": "세력균형 분석 (완결된 문장)",
  "flow": "대운흐름 가이드 (완결된 문장)",
  "scenarios": {
    "daewoon": { "all": "문장", "career": "문장", "wealth": "문장", "mental": "문장", "love": "문장" },
    "year": { "all": "문장", "career": "문장", "wealth": "문장", "mental": "문장", "love": "문장" },
    "month": { "all": "문장", "career": "문장", "wealth": "문장", "mental": "문장", "love": "문장" },
    "day": { "all": "문장", "career": "문장", "wealth": "문장", "mental": "문장", "love": "문장" },
    "hour": { "all": "문장", "career": "문장", "wealth": "문장", "mental": "문장", "love": "문장" }
  },
  "masterInsight": "대표 대운 총평 요약"
}
`;

      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: ANALYZE_SYSTEM }] },
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.7,
                maxOutputTokens: 6000
              }
            })
          }
        );

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
            aiPack = JSON.parse(cleaned);
          }
        }
      } catch (e) {
        console.warn('AI 일괄 생성 통신 실패 (Fallback 생성):', e.message);
      }
    }

    if (!aiPack || !aiPack.scenarios) {
      const makeScenario = (domain, cycleName) => `${name}님의 ${cycleName} ${domain} 파동 흐름을 분석한 결과입니다. 현재 구간은 무리한 외부 확장보다 내부 시스템을 점검하고 핵심 역량을 정돈하기에 적합합니다. 조급함을 내려놓고 지속 가능한 루틴을 설계하여 다음 상승 국면의 도약 발판을 마련하세요.`;
      aiPack = {
        yongsin: `${name}님을 살게 하는 중심 에너지는 식상의 기운입니다. 머릿속 생각을 구체적인 산출물로 실행할 때 파동이 가장 크게 도약합니다. 완벽주의를 내려놓고 작은 실험부터 시작하는 태도가 유리합니다.`,
        heesin: `용신을 든든하게 받쳐주는 재성의 기운입니다. 추진한 일들의 결과를 객관적인 시스템으로 안착시키고 협업 관계를 형성하는 데 강력한 조력자로 작용합니다.`,
        gisin: `에너지가 한쪽으로 쏠릴 때 발생하는 과열을 경계해야 하는 기운입니다. 무리한 확장보다는 누수를 점검하고 감정 소모를 줄이는 원칙 중심의 태도가 필요합니다.`,
        gusin: `집중력을 분산시키는 요소를 정리해야 하는 기운입니다. 불필요한 인간관계와 프로젝트를 필터링하고 본질에 집중할 때 멘탈 리셋이 완성됩니다.`,
        strength: `원국의 주도권이 명확하여 스스로 판을 짜고 이끌어가는 주도형 전략이 유리합니다. 다만 과속으로 인한 피로를 방지하기 위해 정기적인 회복 슬롯을 확보하세요.`,
        flow: `시간의 큰 물결이 순리대로 흐르는 구간입니다. 결과에 일희일비하지 않고 파동의 리듬에 맞춰 한 걸음씩 나아갈 때 장기적인 안정성을 확보할 수 있습니다.`,
        scenarios: {
          daewoon: { all: makeScenario('총운', '100년 대운'), career: makeScenario('사업운', '100년 대운'), wealth: makeScenario('재물운', '100년 대운'), mental: makeScenario('심신운', '100년 대운'), love: makeScenario('연애운', '100년 대운') },
          year: { all: makeScenario('총운', '연운'), career: makeScenario('사업운', '연운'), wealth: makeScenario('재물운', '연운'), mental: makeScenario('심신운', '연운'), love: makeScenario('연애운', '연운') },
          month: { all: makeScenario('총운', '월운'), career: makeScenario('사업운', '월운'), wealth: makeScenario('재물운', '월운'), mental: makeScenario('심신운', '월운'), love: makeScenario('연애운', '월운') },
          day: { all: makeScenario('총운', '일운'), career: makeScenario('사업운', '일운'), wealth: makeScenario('재물운', '일운'), mental: makeScenario('심신운', '일운'), love: makeScenario('연애운', '일운') },
          hour: { all: makeScenario('총운', '시운'), career: makeScenario('사업운', '시운'), wealth: makeScenario('재물운', '시운'), mental: makeScenario('심신운', '시운'), love: makeScenario('연애운', '시운') }
        },
        masterInsight: `${name}님의 현재 대운은 수렴과 발산이 조화를 이루는 구간입니다. 파동의 방향을 믿고 주도적으로 설계하세요.`
      };
    }

    return res.status(200).json({
      success: true,
      data: {
        pillars: {
          year: `${yearGan}${yearZhi}`,
          month: `${monthGan}${monthZhi}`,
          day: dayPillarStr,
          hour: `${hourGan}${hourZhi}`
        },
        dayGanHanja,
        dayElemKor,
        analysis: {
          status: '신강 (주도형)',
          strengthScore: 72,
          scores: { deungRyeong: 30, deungJi: 20, deungSe: 22 },
          yongsinProfile: { yongsin: '토(식상)', heesin: '금(재성)', gisin: '수(관살)', gusin: '화(비겁)' }
        },
        cyclesData,
        meta: { isForward: parseInt(gender, 10) === 1, startAge: 4 },
        aiPack
      }
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
