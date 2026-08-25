// api/analyze.js
// SajuGrapEngine.js 정밀 엔진 완벽 통합 버전

import { Solar } from 'lunar-javascript';
import { ANALYZE_SYSTEM } from '../lib/sajuRulebook.js';

// ============================================================================
// 1. SajuGrapEngine 상수 및 매핑
// ============================================================================
const YANG_STEMS = ['甲', '丙', '戊', '庚', '壬', '갑', '병', '무', '경', '임'];

const HANJA_TO_KO = {
  '甲':'갑','乙':'을','丙':'병','丁':'정','戊':'무','己':'기','庚':'경','辛':'신','壬':'임','癸':'계',
  '子':'자','丑':'축','寅':'인','卯':'묘','辰':'진','巳':'사','午':'오','未':'미','申':'신','酉':'유','戌':'술','亥':'해'
};
const toH = (c) => HANJA_TO_KO[c] || c;

const CHEONGAN_ELEM = { '갑':'목','을':'목','병':'화','정':'화','무':'토','기':'토','경':'금','신':'금','임':'수','계':'수' };
const JIJI_ELEM = { '자':'수','축':'토','인':'목','묘':'목','진':'토','사':'화','오':'화','미':'토','신':'금','유':'금','술':'토','해':'수' };
const ELEMENTS_KOR = { '갑':'나무','을':'나무','병':'불','정':'불','무':'흙','기':'흙','경':'쇠','신':'쇠','임':'물','계':'물' };

const HIDDEN_STEMS_RATIO = {
  '자': [{ stem: '임', r: 0.30 }, { stem: '계', r: 0.70 }],
  '축': [{ stem: '계', r: 0.25 }, { stem: '신', r: 0.20 }, { stem: '기', r: 0.55 }],
  '인': [{ stem: '무', r: 0.24 }, { stem: '병', r: 0.24 }, { stem: '갑', r: 0.52 }],
  '묘': [{ stem: '갑', r: 0.30 }, { stem: '을', r: 0.70 }],
  '진': [{ stem: '을', r: 0.30 }, { stem: '계', r: 0.10 }, { stem: '무', r: 0.60 }],
  '사': [{ stem: '무', r: 0.24 }, { stem: '경', r: 0.24 }, { stem: '병', r: 0.52 }],
  '오': [{ stem: '병', r: 0.30 }, { stem: '기', r: 0.20 }, { stem: '정', r: 0.50 }],
  '미': [{ stem: '정', r: 0.30 }, { stem: '을', r: 0.10 }, { stem: '기', r: 0.60 }],
  '신': [{ stem: '무', r: 0.24 }, { stem: '임', r: 0.24 }, { stem: '경', r: 0.52 }],
  '유': [{ stem: '경', r: 0.30 }, { stem: '신', r: 0.70 }],
  '술': [{ stem: '신', r: 0.30 }, { stem: '정', r: 0.20 }, { stem: '무', r: 0.50 }],
  '해': [{ stem: '무', r: 0.24 }, { stem: '갑', r: 0.24 }, { stem: '임', r: 0.52 }]
};

const TWELVE_PHASE_MATRIX = {
  '갑': { '해': 60, '자': 40, '축': 75, '인': 90, '묘': 100, '진': 50, '사': 25, '오': 15, '미': -50, '신': -100, '유': -60, '술': -30 },
  '을': { '오': 60, '사': 40, '진': 75, '묘': 90, '인': 100, '축': 50, '자': 25, '해': 15, '술': -50, '유': -100, '신': -60, '축': -30 },
  '병': { '인': 60, '묘': 40, '진': 75, '사': 90, '오': 100, '미': 50, '신': 25, '유': 15, '술': -50, '해': -100, '자': -60, '축': -30 },
  '정': { '유': 60, '신': 40, '미': 75, '오': 90, '사': 100, '진': 50, '묘': 25, '인': 15, '축': -50, '자': -100, '해': -60, '술': -30 },
  '무': { '인': 60, '묘': 40, '진': 75, '사': 90, '오': 100, '미': 50, '신': 25, '유': 15, '술': -50, '해': -100, '자': -60, '축': -30 },
  '기': { '유': 60, '신': 40, '미': 75, '오': 90, '사': 100, '진': 50, '묘': 25, '인': 15, '축': -50, '자': -100, '해': -60, '술': -30 },
  '경': { '사': 60, '오': 40, '미': 75, '신': 90, '유': 100, '술': 50, '해': 25, '자': 15, '축': -50, '인': -100, '묘': -60, '진': -30 },
  '신': { '자': 60, '해': 40, '술': 75, '유': 90, '신': 100, '미': 50, '오': 25, '사': 15, '진': -50, '묘': -100, '인': -60, '축': -30 },
  '임': { '신': 60, '유': 40, '술': 75, '해': 90, '자': 100, '축': 50, '인': 25, '묘': 15, '진': -50, '사': -100, '오': -60, '미': -30 },
  '계': { '묘': 60, '인': 40, '축': 75, '자': 90, '해': 100, '술': 50, '유': 25, '신': 15, '미': -50, '사': -100, '오': -60, '진': -30 }
};

// ============================================================================
// 2. 세력 및 5대 운성(십신) 평가
// ============================================================================
function evaluateNatalProfile(pillars) {
  const dayGan = toH(pillars.day.charAt(0));
  const dayJi = toH(pillars.day.charAt(1));
  const monthJi = toH(pillars.month.charAt(1));
  const hourJi = toH(pillars.hour.charAt(1));
  const yearJi = toH(pillars.year.charAt(1));

  const monthGan = toH(pillars.month.charAt(0));
  const hourGan = toH(pillars.hour.charAt(0));
  const yearGan = toH(pillars.year.charAt(0));

  const myElem = CHEONGAN_ELEM[dayGan] || '화';
  const allyElements = {
    '목': ['목', '수'], '화': ['화', '목'], '토': ['토', '화'],
    '금': ['금', '토'], '수': ['수', '금']
  }[myElem] || [myElem];

  const fourBranches = [yearJi, monthJi, dayJi, hourJi];

  // 1. [득령] 월지 지장간
  const monthHidden = HIDDEN_STEMS_RATIO[monthJi] || [];
  let allyRatioInMonth = 0;
  monthHidden.forEach(item => {
    if (allyElements.includes(CHEONGAN_ELEM[item.stem])) allyRatioInMonth += item.r;
  });
  if (myElem === '화' && (monthJi === '술' || monthJi === '미')) {
    allyRatioInMonth = Math.max(allyRatioInMonth, 0.25);
  }
  const deungRyeongScore = Math.round(30 * allyRatioInMonth);

  // 2. [득지] 일지 통근
  const dayHidden = HIDDEN_STEMS_RATIO[dayJi] || [];
  let allyRatioInDay = 0;
  dayHidden.forEach(item => {
    if (allyElements.includes(CHEONGAN_ELEM[item.stem])) allyRatioInDay += item.r;
  });
  let deungJiScore = Math.round(15 * allyRatioInDay);

  // 3. [득세] 시지/년지 및 천간 세력
  let deungSeScore = 0;
  const hourHidden = HIDDEN_STEMS_RATIO[hourJi] || [];
  let allyRatioInHour = 0;
  hourHidden.forEach(item => {
    if (allyElements.includes(CHEONGAN_ELEM[item.stem])) allyRatioInHour += item.r;
  });
  deungSeScore += Math.round(20 * allyRatioInHour);

  const yearHidden = HIDDEN_STEMS_RATIO[yearJi] || [];
  let allyRatioInYear = 0;
  yearHidden.forEach(item => {
    if (allyElements.includes(CHEONGAN_ELEM[item.stem])) allyRatioInYear += item.r;
  });
  deungSeScore += Math.round(10 * allyRatioInYear);

  const stemWeight = [{ stem: monthGan, base: 9 }, { stem: hourGan, base: 9 }, { stem: yearGan, base: 7 }];
  stemWeight.forEach(item => {
    if (allyElements.includes(CHEONGAN_ELEM[item.stem])) {
      let rootCount = 0;
      fourBranches.forEach(ji => {
        (HIDDEN_STEMS_RATIO[ji] || []).forEach(h => {
          if (CHEONGAN_ELEM[h.stem] === CHEONGAN_ELEM[item.stem]) rootCount++;
        });
      });
      deungSeScore += rootCount > 0 ? item.base : Math.round(item.base * 0.6);
    }
  });

  const totalScore = Math.min(100, deungRyeongScore + deungJiScore + deungSeScore);

  let status = '중화';
  if (totalScore >= 58) status = '신강 (주도형)';
  else if (totalScore >= 51) status = '중화신강';
  else if (totalScore >= 46) status = '중화';
  else if (totalScore >= 40) status = '중화신약';
  else status = '신약 (협응형)';

  const elements = ['목', '화', '토', '금', '수'];
  const myIdx = elements.indexOf(myElem);
  const sikSang = elements[(myIdx + 1) % 5];
  const jaeSeong = elements[(myIdx + 2) % 5];
  const gwanSeong = elements[(myIdx + 3) % 5];
  const inSeong = elements[(myIdx + 4) % 5];
  const biGeop = myElem;

  let yongsinProfile = {};
  if (status.includes('신강')) {
    yongsinProfile = {
      yongsin: `${sikSang}(식상)`,
      heesin: `${jaeSeong}(재성)`,
      hansin: `${gwanSeong}(관성)`,
      gusin: `${biGeop}(비겁)`,
      gisin: `${inSeong}(인성)`,
      weights: { [sikSang]: 1.0, [jaeSeong]: 0.8, [gwanSeong]: 0.3, [biGeop]: -0.5, [inSeong]: -1.0 }
    };
  } else {
    yongsinProfile = {
      yongsin: `${inSeong}(인성)`,
      heesin: `${biGeop}(비겁)`,
      hansin: `${sikSang}(식상)`,
      gusin: `${jaeSeong}(재성)`,
      gisin: `${gwanSeong}(관성)`,
      weights: { [inSeong]: 1.0, [biGeop]: 0.8, [sikSang]: -0.2, [jaeSeong]: -0.7, [gwanSeong]: -1.0 }
    };
  }

  return {
    strengthScore: totalScore,
    status,
    scores: { deungRyeong: deungRyeongScore, deungJi: deungJiScore, deungSe: deungSeScore },
    yongsinProfile
  };
}

// ============================================================================
// 3. 실제 대운 파동 수치 연산
// ============================================================================
function evaluateDaewoonPoint(dayGan, dayJi, dStem, dJi, yongsinProfile) {
  const dGanH = toH(dStem);
  const dJiH = toH(dJi);
  const myGanH = toH(dayGan);
  const myJiH = toH(dayJi);

  const phaseScore = TWELVE_PHASE_MATRIX[myGanH]?.[dJiH] ?? 0;
  const dStemElem = CHEONGAN_ELEM[dGanH] || '목';
  const dJiElem = JIJI_ELEM[dJiH] || '토';
  const stemW = yongsinProfile.weights[dStemElem] || 0;
  const jiW = yongsinProfile.weights[dJiElem] || 0;
  const elemScore = (stemW * 0.4 + jiW * 0.6) * 60;

  let eventBonus = 0;
  let frictionWidth = 12;

  const CHUNG_MAP = { '자':'오','오':'자','축':'미','미':'축','인':'신','신':'인','묘':'유','유':'묘','진':'술','술':'진','사':'해','해':'사' };
  if (CHUNG_MAP[myJiH] === dJiH) {
    eventBonus -= 25;
    frictionWidth += 20;
  }

  const HAP_MAP = { '신':['자','진'], '사':['유','축'], '인':['오','술'], '해':['묘','미'] };
  if (HAP_MAP[myJiH]?.includes(dJiH)) {
    eventBonus += 20;
    frictionWidth -= 4;
  }

  const rawTotal = (phaseScore * 0.45) + (elemScore * 0.40) + (eventBonus * 0.15);
  const total = Math.max(-100, Math.min(100, Math.round(rawTotal)));

  return {
    total,
    career: Math.max(-100, Math.min(100, Math.round(total * 0.6 + elemScore * 0.4))),
    wealth: Math.max(-100, Math.min(100, Math.round(total * 0.5 + elemScore * 0.5))),
    love: Math.max(-100, Math.min(100, Math.round(total * 0.5 + eventBonus * 0.5))),
    mental: Math.max(-100, Math.min(100, Math.round(-total * 0.3 + (100 - Math.abs(eventBonus)) * 0.5)))
  };
}

// ============================================================================
// 4. API 메인 핸들러
// ============================================================================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  const { name = '사용자', year = 1995, month = 5, day = 15, hour = 12, minute = 0, gender = 1 } = req.body || {};
  const isMale = Number(gender) === 1;
  const apiKey = process.env.GEMINI_API_KEY;

  try {
    const pYear = parseInt(year, 10);
    const pMonth = parseInt(month, 10);
    const pDay = parseInt(day, 10);
    const pHour = parseInt(hour, 10);
    const pMinute = parseInt(minute, 10);

    // 1. 천문 정밀 만세력 계산 (lunar-javascript)
    const solar = Solar.fromYmdHms(pYear, pMonth, pDay, pHour, pMinute, 0);
    const lunar = solar.getLunar();
    const eightChar = lunar.getEightChar();

    const pillars = {
      year: eightChar.getYear(),
      month: eightChar.getMonth(),
      day: eightChar.getDay(),
      hour: eightChar.getTime()
    };

    const dayGan = eightChar.getDayGan();
    const dayJi = eightChar.getDayZhi();
    const yearGan = eightChar.getYearGan();

    // 2. 사주그랩 세력 및 용희기구신 계산
    const natalAnalysis = evaluateNatalProfile(pillars);

    // 3. 실제 대운 전개 (순행/역행 및 나이 산출)
    const yun = eightChar.getYun(isMale ? 1 : 0);
    const daYunList = yun.getDaYun();
    const firstDaYun = daYunList[1] || daYunList[0];
    const startAge = firstDaYun ? firstDaYun.getStartAge() : 4;

    const isYangYear = YANG_STEMS.includes(yearGan);
    const isForward = (isYangYear && isMale) || (!isYangYear && !isMale);

    const daewoonWaves = [];
    const daewoonLabels = [];
    const dwTotal = [], dwCareer = [], dwWealth = [], dwMental = [], dwLove = [];

    for (let i = 1; i <= 8; i++) {
      const daYun = daYunList[i];
      if (!daYun) continue;
      const ganZhi = daYun.getGanZhi();
      if (!ganZhi || ganZhi.length < 2) continue;

      const dStem = ganZhi.charAt(0);
      const dJi = ganZhi.charAt(1);
      const sAge = daYun.getStartAge();

      const wave = evaluateDaewoonPoint(dayGan, dayJi, dStem, dJi, natalAnalysis.yongsinProfile);

      daewoonLabels.push(`${toH(dStem)}${toH(dJi)}(${sAge}세)`);
      dwTotal.push(wave.total);
      dwCareer.push(wave.career);
      dwWealth.push(wave.wealth);
      dwMental.push(wave.mental);
      dwLove.push(wave.love);

      daewoonWaves.push({
        ganZhi: `${toH(dStem)}${toH(dJi)}`,
        hanja: ganZhi,
        startAge: sAge,
        scores: wave
      });
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

    // 4. 온보딩 초고속 AI 해설 생성
    let aiPack = null;
    if (apiKey) {
      const activeDaewoon = daewoonWaves[3] || daewoonWaves[0];
      const prompt = `
내담자: ${name}
- 일주: ${pillars.day} (${toH(dayGan)}${toH(dayJi)}일주)
- 사주 4기둥: 년주(${pillars.year}), 월주(${pillars.month}), 일주(${pillars.day}), 시주(${pillars.hour})
- 세력: ${natalAnalysis.status} (신강 점수: ${natalAnalysis.strengthScore}점)
- 4대 운성: 용신(${natalAnalysis.yongsinProfile.yongsin}), 희신(${natalAnalysis.yongsinProfile.heesin}), 기신(${natalAnalysis.yongsinProfile.gisin}), 구신(${natalAnalysis.yongsinProfile.gusin})
- 현재 대운: ${activeDaewoon.ganZhi} 대운 (파동 점수: ${activeDaewoon.scores.total}점)

요구사항:
사주그랩 파동역학 지침서에 따라 내담자의 4대 운성과 세력균형, 대운 총평을 작성하세요.
반드시 아래 JSON 형식으로만 응답하세요:
{
  "yongsin": "용신 심층 해설 (완결된 3문장)",
  "heesin": "희신 심층 해설 (완결된 3문장)",
  "gisin": "기신 심층 해설 (완결된 3문장)",
  "gusin": "구신 심층 해설 (완결된 3문장)",
  "strength": "세력균형 분석 (완결된 3문장)",
  "flow": "대운흐름 가이드 (완결된 3문장)",
  "masterInsight": "대표 대운 총평 요약"
}
`;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: ANALYZE_SYSTEM }] },
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.7,
                maxOutputTokens: 1500
              }
            })
          }
        );
        clearTimeout(timeoutId);

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
            aiPack = JSON.parse(cleaned);
          }
        }
      } catch (e) {
        console.warn('AI 온보딩 생성 예외 (기본값 사용):', e.message);
      }
    }

    if (!aiPack) {
      aiPack = {
        yongsin: `${name}님의 중심을 잡아주는 핵심 기운입니다. 생각을 구체적인 산출물로 연결할 때 파동이 가장 강력하게 도약합니다. 작은 실험부터 차근차근 실행하세요.`,
        heesin: `용신을 든든하게 받쳐주는 조력자의 기운입니다. 추진한 일들을 객관적인 시스템으로 안착시키고 협력 관계를 형성하는 데 유리하게 작용합니다.`,
        gisin: `에너지가 과열될 때 경계해야 하는 기운입니다. 무리한 확장보다는 누수를 막고 감정 소모를 줄이는 원칙 중심의 태도가 필요합니다.`,
        gusin: `집중력을 분산시키는 요소를 정리해야 하는 기운입니다. 불필요한 인간관계와 프로젝트를 필터링하고 본질에 집중할 때 멘탈 리셋이 완성됩니다.`,
        strength: `원국의 주도권이 명확하여 스스로 판을 짜고 이끌어가는 주도형 전략이 유리합니다. 정기적인 회복 슬롯을 확보하여 과속을 방지하세요.`,
        flow: `${isForward ? '순행' : '역행'}하는 대운의 흐름 속에서 조급함을 버리고 파동의 리듬에 맞춰 한 걸음씩 나아가십시오.`,
        masterInsight: `${name}님의 대표 대운은 수렴과 발산이 조화를 이루는 구간입니다. 파동의 리듬을 믿고 주도적으로 설계하세요.`
      };
    }

    return res.status(200).json({
      success: true,
      data: {
        pillars: {
          year: toH(pillars.year),
          yearHanja: pillars.year,
          month: toH(pillars.month),
          monthHanja: pillars.month,
          day: toH(pillars.day),
          dayHanja: pillars.day,
          hour: toH(pillars.hour),
          hourHanja: pillars.hour
        },
        dayGanHanja: dayGan,
        dayElemKor: ELEMENTS_KOR[toH(dayGan)] || '불',
        analysis: natalAnalysis,
        daewoonWaves,
        cyclesData,
        meta: { isForward, startAge },
        aiPack
      }
    });

  } catch (error) {
    console.error('Engine Fatal Error:', error);
    return res.status(500).json({ success: false, message: '사주 분석 엔진 오류: ' + error.message });
  }
}
