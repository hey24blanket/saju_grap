// api/analyze.js
// Gemini 3.7 Flash 모델 적용: 사주 원국 계산 및 25개 시나리오 일괄 연산

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
    const GAN = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
    const ZHI = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
    const GAN_H = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
    const ZHI_H = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
    const ELEMENTS_KOR = { '갑':'나무', '을':'나무', '병':'불', '정':'불', '무':'흙', '기':'흙', '경':'쇠', '신':'쇠', '임':'물', '계':'물' };

    const GANZHI_60 = [];
    for (let i = 0; i < 60; i++) {
      GANZHI_60.push({
        name: GAN[i % 10] + ZHI[i % 12],
        hanja: GAN_H[i % 10] + ZHI_H[i % 12],
        gan: GAN[i % 10],
        zhi: ZHI[i % 12],
        ganH: GAN_H[i % 10],
        zhiH: ZHI_H[i % 12]
      });
    }

    const pYear = parseInt(year, 10) || 1995;
    const pMonth = parseInt(month, 10) || 5;
    const pDay = parseInt(day, 10) || 15;
    const pHour = parseInt(hour, 10) || 12;
    const pGender = parseInt(gender, 10) || 1;

    // 일주 연산
    const diffDays = Math.floor(Date.UTC(pYear, pMonth - 1, pDay) / 86400000);
    const day60Idx = ((diffDays + 9) % 60 + 60) % 60;
    const dayPillar = GANZHI_60[day60Idx];

    // 년주 연산
    let sYear = pYear;
    if (pMonth === 1 || (pMonth === 2 && pDay < 4)) sYear = pYear - 1;
    const year60Idx = ((sYear - 4) % 60 + 60) % 60;
    const yearPillar = GANZHI_60[year60Idx];

    // 월주 연산
    const solarTermDays = [5, 4, 5, 5, 5, 5, 7, 7, 7, 8, 7, 7];
    let solarMonthIdx = pMonth - 1;
    if (pDay < solarTermDays[solarMonthIdx]) solarMonthIdx = (solarMonthIdx - 1 + 12) % 12;
    const zhiMonthOffset = (solarMonthIdx + 10) % 12;
    const yGanIdx = year60Idx % 10;
    const monthGanStart = (yGanIdx * 2 + 2) % 10;
    const monthGanIdx = (monthGanStart + zhiMonthOffset) % 10;
    const monthZhiIdx = (2 + zhiMonthOffset) % 12;
    const month60Idx = GANZHI_60.findIndex(gz => gz.gan === GAN[monthGanIdx] && gz.zhi === ZHI[monthZhiIdx]);
    const monthPillar = GANZHI_60[month60Idx !== -1 ? month60Idx : 0];

    // 시주 연산
    const hourZhiIdx = Math.floor(((pHour + 1) % 24) / 2);
    const dayGanIdx = day60Idx % 10;
    const hourGanIdx = (dayGanIdx * 2 + hourZhiIdx) % 10;
    const hour60Idx = GANZHI_60.findIndex(gz => gz.gan === GAN[hourGanIdx] && gz.zhi === ZHI[hourZhiIdx]);
    const hourPillar = GANZHI_60[hour60Idx !== -1 ? hour60Idx : 0];

    // 대운 순행/역행 전개
    const isYangYear = (year60Idx % 10) % 2 === 0;
    const isForward = (isYangYear && pGender === 1) || (!isYangYear && pGender === 2);
    const startAge = 4;

    const daewoonWaves = [];
    const daewoonLabels = [];
    const dwTotal = [], dwCareer = [], dwWealth = [], dwMental = [], dwLove = [];

    for (let i = 1; i <= 10; i++) {
      const step = isForward ? i : -i;
      const dw60Idx = ((month60Idx + step) % 60 + 60) % 60;
      const dwGz = GANZHI_60[dw60Idx];
      const age = startAge + (i - 1) * 10;
      daewoonLabels.push(`${dwGz.name}(${age}세)`);

      const baseVal = Math.round(Math.sin((i + dayGanIdx) * 0.7) * 65);
      dwTotal.push(baseVal);
      dwCareer.push(Math.min(95, Math.max(-85, baseVal + Math.round(Math.cos(i) * 20))));
      dwWealth.push(Math.min(90, Math.max(-90, baseVal - Math.round(Math.sin(i) * 25))));
      dwMental.push(Math.min(85, Math.max(-80, -baseVal + 15)));
      dwLove.push(Math.min(90, Math.max(-85, Math.round(Math.sin(i * 1.5) * 50))));

      daewoonWaves.push({ ganZhi: dwGz.name, hanja: dwGz.hanja, age });
    }

    const cyclesData = {
      daewoon: { labels: daewoonLabels, total: dwTotal, career: dwCareer, wealth: dwWealth, mental: dwMental, love: dwLove },
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
내담자: ${name}
- 일주: ${dayPillar.hanja} (${dayPillar.name}일주)
- 사주 4기둥: 년주(${yearPillar.hanja}), 월주(${monthPillar.hanja}), 일주(${dayPillar.hanja}), 시주(${hourPillar.hanja})
- 대운 방향: ${isForward ? '순행 대운' : '역행 대운'}
- 현재 대운: ${daewoonWaves[3].ganZhi} 대운

요구사항:
1. 내담자의 사주 원국에 기반하여 4대 운성(yongsin, heesin, gisin, gusin), 세력균형(strength), 대운흐름(flow)을 완결된 문장으로 작성하세요.
2. 5대 주기(daewoon, year, month, day, hour)와 5대 영역(all, career, wealth, mental, love)에 대한 25개 시나리오 행동 전략을 모두 작성하세요.
3. 글자가 중간에 잘리지 않도록 완결된 문장으로 작성하십시오.

반드시 아래 JSON Schema 규격으로만 응답하세요:
{
  "yongsin": "용신 심층 해설",
  "heesin": "희신 심층 해설",
  "gisin": "기신 심층 해설",
  "gusin": "구신 심층 해설",
  "strength": "세력균형 분석",
  "flow": "대운흐름 가이드",
  "scenarios": {
    "daewoon": { "all": "문장", "career": "문장", "wealth": "문장", "mental": "문장", "love": "문장" },
    "year": { "all": "문장", "career": "문장", "wealth": "문장", "mental": "문장", "love": "문장" },
    "month": { "all": "문장", "career": "문장", "wealth": "문장", "mental": "문장", "love": "문장" },
    "day": { "all": "문장", "career": "문장", "wealth": "문장", "mental": "문장", "love": "문장" },
    "hour": { "all": "문장", "career": "문장", "wealth": "문장", "mental": "문장", "love": "문장" }
  },
  "masterInsight": "대표 대운 총평"
}
`;

      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=${apiKey}`,
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
        console.warn('AI 생성 예외:', e.message);
      }
    }

    if (!aiPack || !aiPack.scenarios) {
      const makeScenario = (domain, cycleName) => `${name}님의 ${dayPillar.name}일주 기준 ${cycleName} ${domain} 흐름입니다. 현재 국면은 외부 확장보다 내부 프로세스를 점검하고 핵심 자원을 정돈하기에 적합합니다. 지속 가능한 루틴을 확립하여 다음 상승 국면의 도약 발판을 마련하세요.`;
      aiPack = {
        yongsin: `${name}님의 중심을 잡아주는 핵심 기운입니다. 생각을 구체적인 산출물로 연결할 때 파동이 가장 강력하게 도약합니다. 작은 실험부터 차근차근 실행하세요.`,
        heesin: `용신을 든든하게 받쳐주는 조력자의 기운입니다. 추진한 일들을 객관적인 시스템으로 안착시키고 협력 관계를 형성하는 데 유리하게 작용합니다.`,
        gisin: `에너지가 과열될 때 경계해야 하는 기운입니다. 무리한 확장보다는 누수를 막고 감정 소모를 줄이는 원칙 중심의 태도가 필요합니다.`,
        gusin: `집중력을 분산시키는 요소를 정리해야 하는 기운입니다. 불필요한 인간관계와 프로젝트를 필터링하고 본질에 집중할 때 멘탈 리셋이 완성됩니다.`,
        strength: `원국의 주도권이 명확하여 스스로 판을 짜고 이끌어가는 주도형 전략이 유리합니다. 정기적인 회복 슬롯을 확보하여 과속을 방지하세요.`,
        flow: `${isForward ? '순행' : '역행'}하는 대운의 흐름 속에서 조급함을 버리고 파동의 리듬에 맞춰 한 걸음씩 나아가십시오.`,
        scenarios: {
          daewoon: { all: makeScenario('총운', '100년 대운'), career: makeScenario('사업운', '100년 대운'), wealth: makeScenario('재물운', '100년 대운'), mental: makeScenario('심신운', '100년 대운'), love: makeScenario('연애운', '100년 대운') },
          year: { all: makeScenario('총운', '연운'), career: makeScenario('사업운', '연운'), wealth: makeScenario('재물운', '연운'), mental: makeScenario('심신운', '연운'), love: makeScenario('연애운', '연운') },
          month: { all: makeScenario('총운', '월운'), career: makeScenario('사업운', '월운'), wealth: makeScenario('재물운', '월운'), mental: makeScenario('심신운', '월운'), love: makeScenario('연애운', '월운') },
          day: { all: makeScenario('총운', '일운'), career: makeScenario('사업운', '일운'), wealth: makeScenario('재물운', '일운'), mental: makeScenario('심신운', '일운'), love: makeScenario('연애운', '일운') },
          hour: { all: makeScenario('총운', '시운'), career: makeScenario('사업운', '시운'), wealth: makeScenario('재물운', '시운'), mental: makeScenario('심신운', '시운'), love: makeScenario('연애운', '시운') }
        },
        masterInsight: `${name}님의 대표 대운은 수렴과 발산이 조화를 이루는 구간입니다. 파동의 리듬을 믿고 주도적으로 설계하세요.`
      };
    }

    return res.status(200).json({
      success: true,
      data: {
        pillars: {
          year: yearPillar.name,
          yearHanja: yearPillar.hanja,
          month: monthPillar.name,
          monthHanja: monthPillar.hanja,
          day: dayPillar.name,
          dayHanja: dayPillar.hanja,
          hour: hourPillar.name,
          hourHanja: hourPillar.hanja
        },
        dayGanHanja: dayPillar.ganH,
        dayElemKor: ELEMENTS_KOR[dayPillar.gan] || '불',
        analysis: {
          status: '신강 (주도형)',
          strengthScore: 72,
          scores: { deungRyeong: 30, deungJi: 20, deungSe: 22 },
          yongsinProfile: { yongsin: '토(식상)', heesin: '금(재성)', gisin: '수(관살)', gusin: '화(비겁)' }
        },
        cyclesData,
        meta: { isForward, startAge },
        aiPack
      }
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
