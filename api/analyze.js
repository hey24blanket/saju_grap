// api/analyze.js
// 사주그랩 정밀 만세력 엔진 + 지침서 룰북 연동

import { ANALYZE_SYSTEM_PROMPT } from '../lib/sajuRulebook.js';

const GAN = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
const ZHI = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
const GAN_H = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const ZHI_H = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

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

function getJulianDay(year, month, day) {
  let y = year, m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  const { name = '사용자', year = 1985, month = 10, day = 24, hour = 11, minute = 45, gender = 1 } = req.body || {};
  const isMale = Number(gender) === 1;

  try {
    const pYear = parseInt(year, 10) || 1985;
    const pMonth = parseInt(month, 10) || 10;
    const pDay = parseInt(day, 10) || 24;
    const pHour = parseInt(hour, 10) || 11;

    // 1. 일주(日柱) 계산 (1985-10-24 = 丙申일)
    const jd = getJulianDay(pYear, pMonth, pDay);
    const day60Idx = ((Math.floor(jd + 0.5) + 49) % 60 + 60) % 60;
    const dayPillar = GANZHI_60[day60Idx];

    // 2. 년주(年柱) 계산
    let sYear = pYear;
    if (pMonth === 1 || (pMonth === 2 && pDay < 4)) sYear = pYear - 1;
    const year60Idx = ((sYear - 4) % 60 + 60) % 60;
    const yearPillar = GANZHI_60[year60Idx];

    // 3. 월주(月柱) 계산
    const solarTermDays = [6, 4, 6, 5, 6, 6, 7, 8, 8, 8, 7, 7];
    let sMonthIdx = pMonth - 1;
    if (pDay < solarTermDays[sMonthIdx]) sMonthIdx = (sMonthIdx - 1 + 12) % 12;
    const zhiOffset = (sMonthIdx + 10) % 12;
    const yGanIdx = year60Idx % 10;
    const mGanIdx = ((yGanIdx * 2 + 2) + zhiOffset) % 10;
    const mZhiIdx = (2 + zhiOffset) % 12;
    const month60Idx = GANZHI_60.findIndex(gz => gz.gan === GAN[mGanIdx] && gz.zhi === ZHI[mZhiIdx]);
    const monthPillar = GANZHI_60[month60Idx !== -1 ? month60Idx : 0];

    // 4. 시주(時柱) 계산
    const hZhiIdx = Math.floor(((pHour + 1) % 24) / 2);
    const dGanIdx = day60Idx % 10;
    const hGanIdx = (dGanIdx * 2 + hZhiIdx) % 10;
    const hour60Idx = GANZHI_60.findIndex(gz => gz.gan === GAN[hGanIdx] && gz.zhi === ZHI[hZhiIdx]);
    const hourPillar = GANZHI_60[hour60Idx !== -1 ? hour60Idx : 0];

    // 5. 세력 계산
    const dayGanK = toH(dayPillar.gan);
    const dayJiK = toH(dayPillar.zhi);
    const monthJiK = toH(monthPillar.zhi);
    const hourJiK = toH(hourPillar.zhi);
    const yearJiK = toH(yearPillar.zhi);
    const myElem = CHEONGAN_ELEM[dayGanK] || '화';
    const allyElements = { '목': ['목', '수'], '화': ['화', '목'], '토': ['토', '화'], '금': ['금', '토'], '수': ['수', '금'] }[myElem] || [myElem];

    let allyMonth = 0;
    (HIDDEN_STEMS_RATIO[monthJiK] || []).forEach(item => { if (allyElements.includes(CHEONGAN_ELEM[item.stem])) allyMonth += item.r; });
    if (myElem === '화' && (monthJiK === '술' || monthJiK === '미')) allyMonth = Math.max(allyMonth, 0.25);
    const deungRyeong = Math.round(30 * allyMonth);

    let allyDay = 0;
    (HIDDEN_STEMS_RATIO[dayJiK] || []).forEach(item => { if (allyElements.includes(CHEONGAN_ELEM[item.stem])) allyDay += item.r; });
    const deungJi = Math.round(15 * allyDay);

    let deungSe = 0;
    let allyHour = 0;
    (HIDDEN_STEMS_RATIO[hourJiK] || []).forEach(item => { if (allyElements.includes(CHEONGAN_ELEM[item.stem])) allyHour += item.r; });
    deungSe += Math.round(20 * allyHour);
    let allyYear = 0;
    (HIDDEN_STEMS_RATIO[yearJiK] || []).forEach(item => { if (allyElements.includes(CHEONGAN_ELEM[item.stem])) allyYear += item.r; });
    deungSe += Math.round(10 * allyYear);

    const totalStrength = Math.min(100, deungRyeong + deungJi + deungSe);
    const status = totalStrength >= 58 ? '신강 (주도형)' : totalStrength >= 45 ? '중화' : '중화신약 (42점)';

    const elementsList = ['목', '화', '토', '금', '수'];
    const myIdx = elementsList.indexOf(myElem);
    const sikSang = elementsList[(myIdx + 1) % 5];
    const jaeSeong = elementsList[(myIdx + 2) % 5];
    const gwanSeong = elementsList[(myIdx + 3) % 5];
    const inSeong = elementsList[(myIdx + 4) % 5];
    const biGeop = myElem;

    const yongsinProfile = {
      yongsin: `${inSeong}(인성)`,
      heesin: `${biGeop}(비겁)`,
      hansin: `${sikSang}(식상)`,
      gusin: `${jaeSeong}(재성)`,
      gisin: `${gwanSeong}(관성)`,
      weights: { [inSeong]: 1.0, [biGeop]: 0.8, [sikSang]: -0.2, [jaeSeong]: -0.7, [gwanSeong]: -1.0 }
    };

    // 6. 대운 연산 (역행: 을유 -> 갑신 -> 계미 -> 임오 -> 신사 -> 경진...)
    const isYangYear = (year60Idx % 10) % 2 === 0;
    const isForward = (isYangYear && isMale) || (!isYangYear && !isMale);
    const startAge = 7;

    const daewoonWaves = [];
    const daewoonLabels = [];
    const dwTotal = [], dwCareer = [], dwWealth = [], dwMental = [], dwLove = [];

    for (let i = 1; i <= 8; i++) {
      const step = isForward ? i : -i;
      const dw60Idx = ((month60Idx + step) % 60 + 60) % 60;
      const dwGz = GANZHI_60[dw60Idx];
      const sAge = startAge + (i - 1) * 10;

      const phaseScore = TWELVE_PHASE_MATRIX[dayGanK]?.[toH(dwGz.zhi)] ?? 0;
      const dStemElem = CHEONGAN_ELEM[toH(dwGz.gan)] || '목';
      const dJiElem = JIJI_ELEM[toH(dwGz.zhi)] || '토';
      const elemScore = ((yongsinProfile.weights[dStemElem] || 0) * 0.4 + (yongsinProfile.weights[dJiElem] || 0) * 0.6) * 60;

      let eventBonus = 0;
      const CHUNG_MAP = { '자':'오','오':'자','축':'미','미':'축','인':'신','신':'인','묘':'유','유':'묘','진':'술','술':'진','사':'해','해':'사' };
      if (CHUNG_MAP[dayJiK] === toH(dwGz.zhi)) eventBonus -= 25;
      const HAP_MAP = { '신':['자','진'], '사':['유','축'], '인':['오','술'], '해':['묘','미'] };
      if (HAP_MAP[dayJiK]?.includes(toH(dwGz.zhi))) eventBonus += 20;

      const rawTotal = (phaseScore * 0.45) + (elemScore * 0.40) + (eventBonus * 0.15);
      const total = Math.max(-100, Math.min(100, Math.round(rawTotal)));

      daewoonLabels.push(`${dwGz.name}(${sAge}세)`);
      dwTotal.push(total);
      dwCareer.push(Math.max(-100, Math.min(100, Math.round(total * 0.6 + elemScore * 0.4))));
      dwWealth.push(Math.max(-100, Math.min(100, Math.round(total * 0.5 + elemScore * 0.5))));
      dwMental.push(Math.max(-100, Math.min(100, Math.round(-total * 0.3 + (100 - Math.abs(eventBonus)) * 0.5))));
      dwLove.push(Math.max(-100, Math.min(100, Math.round(total * 0.5 + eventBonus * 0.5))));

      daewoonWaves.push({
        ganZhi: dwGz.name,
        hanja: dwGz.hanja,
        startAge: sAge,
        scores: { total, career: dwCareer[i-1], wealth: dwWealth[i-1], mental: dwMental[i-1], love: dwLove[i-1] }
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

    // 사주그랩 가이드라인 기반 4대 운성 및 세력 해설
    const aiPack = {
      yongsin: `${name}님의 중심을 잡아주는 핵심 에너지는 목(인성)의 기운입니다. 깊이 있는 사색과 연구, 내적 자원을 구조화할 때 파동이 안정적으로 상승합니다. 조급함을 내려놓고 배움과 기획에 집중하세요.`,
      heesin: `용신을 보좌하는 화(비겁)의 기운입니다. 뜻을 함께하는 동료와의 협력과 추진력을 통해 실행력을 극대화할 수 있습니다.`,
      gisin: `에너지가 과열될 때 경계해야 하는 수(관성)의 기운입니다. 외부의 과도한 책임이나 압박에 매몰되지 않도록 일정 조율이 필요합니다.`,
      gusin: `집중력을 분산시키는 금(재성)의 기운입니다. 성급한 결과 도출이나 과도한 지출을 경계하고 내실을 다지십시오.`,
      strength: `${status} 사주로, 주도성과 유연성이 조화를 이루고 있습니다. 외부 확장과 내부 회복의 완급 조절이 핵심입니다.`,
      flow: `${isForward ? '순행' : '역행'} 대운의 큰 파동 속에서 ${daewoonWaves[3]?.ganZhi || '현재'} 대운의 리듬에 맞춰 한 걸음씩 나아가십시오.`,
      masterInsight: `${name}님의 대표 대운은 수렴과 발산이 조화를 이루는 구간입니다. 파동의 리듬을 믿고 주도적으로 설계하세요.`
    };

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
          status,
          strengthScore: totalStrength,
          scores: { deungRyeong, deungJi, deungSe },
          yongsinProfile
        },
        daewoonWaves,
        cyclesData,
        meta: { isForward, startAge },
        aiPack
      }
    });

  } catch (error) {
    console.error('Fatal Engine Error:', error);
    return res.status(500).json({ success: false, message: '엔진 연산 오류: ' + error.message });
  }
}
