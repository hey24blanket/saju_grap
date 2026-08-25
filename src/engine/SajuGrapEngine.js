// SajuGrapEngine.js
const { Solar } = require('lunar-javascript');
const readline = require('readline');

// ============================================================================
// 1. 역학 기준 매핑 테이블 및 가중치 상수
// ============================================================================
const YANG_STEMS = ['甲', '丙', '戊', '庚', '壬', '갑', '병', '무', '경', '임'];

const HANJA_TO_KO = {
  '甲':'갑','乙':'을','丙':'병','丁':'정','戊':'무','己':'기','庚':'경','辛':'신','壬':'임','癸':'계',
  '子':'자','丑':'축','寅':'인','卯':'묘','辰':'진','巳':'사','午':'오','未':'미','申':'신','酉':'유','戌':'술','亥':'해'
};
const toH = (c) => HANJA_TO_KO[c] || c;

const CHEONGAN_ELEM = { '갑':'목','을':'목','병':'화','정':'화','무':'토','기':'토','경':'금','신':'금','임':'수','계':'수' };
const JIJI_ELEM = { '자':'수','축':'토','인':'목','묘':'목','진':'토','사':'화','오':'화','미':'토','신':'금','유':'금','술':'토','해':'수' };

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
// 2. 신살(神殺), 귀인(貴人), 합·충·형 정밀 판별기
// ============================================================================
function detectStarsAndInteractions(pillars) {
  const dayGan = toH(pillars.day.charAt(0));
  const dayJi = toH(pillars.day.charAt(1));
  const yearJi = toH(pillars.year.charAt(1));

  const branches = [
    { pos: '년지', val: toH(pillars.year.charAt(1)) },
    { pos: '월지', val: toH(pillars.month.charAt(1)) },
    { pos: '일지', val: toH(pillars.day.charAt(1)) },
    { pos: '시지', val: toH(pillars.hour.charAt(1)) }
  ];

  const stems = [
    { pos: '년간', val: toH(pillars.year.charAt(0)) },
    { pos: '월간', val: toH(pillars.month.charAt(0)) },
    { pos: '일간', val: toH(pillars.day.charAt(0)) },
    { pos: '시간', val: toH(pillars.hour.charAt(0)) }
  ];

  const stars = [];
  const interactions = [];

  // A. 길신 / 귀인 (일간 기준)
  const NOBLE_MAP = {
    '갑': { 천을: ['축', '미'], 문창: '사', 학당: '해', 양인: '묘' },
    '을': { 천을: ['자', '신'], 문창: '오', 학당: '오', 양인: '진' },
    '병': { 천을: ['해', '유'], 문창: '신', 학당: '인', 양인: '오' },
    '정': { 천을: ['유', '해'], 문창: '유', 학당: '유', 양인: '미' },
    '무': { 천을: ['축', '미'], 문창: '신', 학당: '인', 양인: '오' },
    '기': { 천을: ['자', '신'], 문창: '유', 학당: '유', 양인: '미' },
    '경': { 천을: ['축', '미'], 문창: '해', 학당: '사', 양인: '유' },
    '신': { 천을: ['인', '오'], 문창: '자', 학당: '자', 양인: '술' },
    '임': { 천을: ['사', '묘'], 문창: '인', 학당: '신', 양인: '자' },
    '계': { 천을: ['사', '묘'], 문창: '묘', 학당: '묘', 양인: '축' }
  };

  const nobleRule = NOBLE_MAP[dayGan] || {};
  branches.forEach(b => {
    if (nobleRule.천을?.includes(b.val)) stars.push({ name: '천을귀인(天乙貴人)', pos: b.pos, type: 'good' });
    if (nobleRule.문창 === b.val) stars.push({ name: '문창귀인(文昌貴人)', pos: b.pos, type: 'good' });
    if (nobleRule.학당 === b.val) stars.push({ name: '학당귀인(學堂貴人)', pos: b.pos, type: 'good' });
    if (nobleRule.양인 === b.val) stars.push({ name: '양인살(陽刃殺)', pos: b.pos, type: 'strong' });
  });

  // B. 12신살 (년지/일지 기준 역마, 도화, 화개)
  const getShinsalGroup = (baseJi) => {
    if (['인', '오', '술'].includes(baseJi)) return { 역마: '신', 도화: '묘', 화개: '술' };
    if (['사', '유', '축'].includes(baseJi)) return { 역마: '해', 도화: '오', 화개: '축' };
    if (['신', '자', '진'].includes(baseJi)) return { 역마: '인', 도화: '유', 화개: '진' };
    if (['해', '묘', '미'].includes(baseJi)) return { 역마: '사', 도화: '자', 화개: '미' };
    return {};
  };

  const dayGroup = getShinsalGroup(dayJi);
  const yearGroup = getShinsalGroup(yearJi);

  branches.forEach(b => {
    if (b.val === dayGroup.역마 || b.val === yearGroup.역마) stars.push({ name: '역마살(驛馬殺)', pos: b.pos, type: 'move' });
    if (b.val === dayGroup.도화 || b.val === yearGroup.도화) stars.push({ name: '도화살(桃花殺)', pos: b.pos, type: 'charm' });
    if (b.val === dayGroup.화개 || b.val === yearGroup.화개) stars.push({ name: '화개살(華蓋殺)', pos: b.pos, type: 'art' });
  });

  // C. 특수살 (백호대살, 괴강살)
  const BAEKHO = ['갑진', '을미', '병술', '정축', '무진', '임술', '계축'];
  const GWEGANG = ['무술', '경술', '경진', '임진', '무진', '임술'];

  const pillarPairs = [
    { name: '년주', val: `${toH(pillars.year.charAt(0))}${toH(pillars.year.charAt(1))}` },
    { name: '월주', val: `${toH(pillars.month.charAt(0))}${toH(pillars.month.charAt(1))}` },
    { name: '일주', val: `${toH(pillars.day.charAt(0))}${toH(pillars.day.charAt(1))}` },
    { name: '시주', val: `${toH(pillars.hour.charAt(0))}${toH(pillars.hour.charAt(1))}` }
  ];

  pillarPairs.forEach(p => {
    if (BAEKHO.includes(p.val)) stars.push({ name: '백호대살(白虎大殺)', pos: p.name, type: 'power' });
    if (GWEGANG.includes(p.val)) stars.push({ name: '괴강살(魁罡殺)', pos: p.name, type: 'leader' });
  });

  // D. 지지 형·충·회·합 분석
  const branchVals = branches.map(b => b.val);
  
  // 삼형살 검출
  if (branchVals.includes('축') && branchVals.includes('술')) interactions.push({ type: '형(刑)', name: '축술형(丑戌刑)', desc: '조직/재산상 마찰 주의' });
  if (branchVals.includes('인') && branchVals.includes('사')) interactions.push({ type: '형(刑)', name: '인사형(寅巳刑)', desc: '급격한 추진과 구설' });
  
  // 충(沖)
  const CHUNG_PAIRS = { '자':'오', '축':'미', '인':'신', '묘':'유', '진':'술', '사':'해' };
  for (let i = 0; i < branches.length; i++) {
    for (let j = i + 1; j < branches.length; j++) {
      if (CHUNG_PAIRS[branches[i].val] === branches[j].val || CHUNG_PAIRS[branches[j].val] === branches[i].val) {
        interactions.push({ type: '충(沖)', name: `${branches[i].val}${branches[j].val}충`, desc: `${branches[i].pos}-${branches[j].pos} 간의 충돌 및 변동` });
      }
    }
  }

  // 삼합 / 반합
  if (branchVals.includes('오') && branchVals.includes('술')) interactions.push({ type: '반합(半合)', name: '오술반합(午戌合火)', desc: '화(火) 세력 결속 및 강화' });
  if (branchVals.includes('신') && branchVals.includes('진')) interactions.push({ type: '반합(半合)', name: '신진반합(申辰合水)', desc: '수(水) 세력 결속 및 유통' });
  if (branchVals.includes('사') && branchVals.includes('유')) interactions.push({ type: '반합(半合)', name: '사유반합(巳酉合金)', desc: '금(金) 결실 강화' });
  if (branchVals.includes('해') && branchVals.includes('묘')) interactions.push({ type: '반합(半合)', name: '해묘반합(亥卯合木)', desc: '목(木) 성장력 강화' });

  return { stars, interactions };
}

// ============================================================================
// 3. 원국 세력 및 5대 운성(용·희·한·구·기신) 도출
// ============================================================================
function evaluateNatalProfile(solarDate, pillars) {
  const dayGan = toH(pillars.day.charAt(0));
  const dayJi = toH(pillars.day.charAt(1));
  const monthJi = toH(pillars.month.charAt(1));
  const hourJi = toH(pillars.hour.charAt(1));
  const yearJi = toH(pillars.year.charAt(1));

  const monthGan = toH(pillars.month.charAt(0));
  const hourGan = toH(pillars.hour.charAt(0));
  const yearGan = toH(pillars.year.charAt(0));

  const myElem = CHEONGAN_ELEM[dayGan];
  const allyElements = {
    '목': ['목', '수'], '화': ['화', '목'], '토': ['토', '화'],
    '금': ['금', '토'], '수': ['수', '금']
  }[myElem] || [myElem];

  const fourBranches = [yearJi, monthJi, dayJi, hourJi];

  // 1. [득령] 월지 지장간 분석
  const monthHidden = HIDDEN_STEMS_RATIO[monthJi] || [];
  let allyRatioInMonth = 0;
  monthHidden.forEach(item => {
    if (allyElements.includes(CHEONGAN_ELEM[item.stem])) allyRatioInMonth += item.r;
  });
  if (myElem === '화' && (monthJi === '술' || monthJi === '미')) {
    allyRatioInMonth = Math.max(allyRatioInMonth, 0.25);
  }
  const deungRyeongScore = Math.round(30 * allyRatioInMonth);

  // 2. [득지] 일지 통근 분석
  const dayHidden = HIDDEN_STEMS_RATIO[dayJi] || [];
  let allyRatioInDay = 0;
  dayHidden.forEach(item => {
    if (allyElements.includes(CHEONGAN_ELEM[item.stem])) allyRatioInDay += item.r;
  });
  let deungJiScore = Math.round(15 * allyRatioInDay);
  const isRokWangDay = (dayGan === '갑' && dayJi === '인') || (dayGan === '을' && dayJi === '묘') ||
                       (dayGan === '병' && dayJi === '오') || (dayGan === '정' && dayJi === '사') ||
                       (dayGan === '경' && dayJi === '신') || (dayGan === '신' && dayJi === '유') ||
                       (dayGan === '임' && dayJi === '자') || (dayGan === '계' && dayJi === '해');
  if (isRokWangDay) deungJiScore += 5;

  // 3. [득세] 시지/년지 및 천간 세력
  let deungSeScore = 0;
  const hourHidden = HIDDEN_STEMS_RATIO[hourJi] || [];
  let allyRatioInHour = 0;
  hourHidden.forEach(item => {
    if (allyElements.includes(CHEONGAN_ELEM[item.stem])) allyRatioInHour += item.r;
  });
  let hourBranchScore = Math.round(20 * allyRatioInHour);
  const isYangInOrRokHour = (dayGan === '병' && hourJi === '오') || (dayGan === '갑' && (hourJi === '인' || hourJi === '묘')) ||
                           (dayGan === '경' && (hourJi === '신' || hourJi === '유')) || (dayGan === '임' && (hourJi === '해' || hourJi === '자'));
  if (isYangInOrRokHour) hourBranchScore += 5;
  deungSeScore += hourBranchScore;

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
  if (totalScore >= 58) status = '신강';
  else if (totalScore >= 51) status = '중화신강';
  else if (totalScore >= 46) status = '중화';
  else if (totalScore >= 40) status = '중화신약';
  else status = '신약';

  // 5대 운성(십신) 완전 분리 설계
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
  } else if (status.includes('신약')) {
    yongsinProfile = {
      yongsin: `${inSeong}(인성)`,
      heesin: `${biGeop}(비겁)`,
      hansin: `${sikSang}(식상)`,
      gusin: `${jaeSeong}(재성)`,
      gisin: `${gwanSeong}(관성)`,
      weights: { [inSeong]: 1.0, [biGeop]: 0.8, [sikSang]: -0.2, [jaeSeong]: -0.7, [gwanSeong]: -1.0 }
    };
  } else {
    yongsinProfile = {
      yongsin: `${sikSang}(식상/유통)`,
      heesin: `${jaeSeong}(재성)`,
      hansin: `${inSeong}(인성)`,
      gusin: `${biGeop}(비겁)`,
      gisin: `${gwanSeong}(관살혼잡)`,
      weights: { [sikSang]: 0.9, [jaeSeong]: 1.0, [inSeong]: 0.2, [biGeop]: -0.3, [gwanSeong]: -0.6 }
    };
  }

  const metaStars = detectStarsAndInteractions(pillars);

  return {
    strengthScore: totalScore,
    status,
    scores: { deungRyeong: deungRyeongScore, deungJi: deungJiScore, deungSe: deungSeScore },
    yongsinProfile,
    metaStars
  };
}

// ============================================================================
// 4. 대운 파동 및 6대 도메인 궤적
// ============================================================================
function evaluateDaewoonPoint(dayGan, dayJi, dStem, dJi, yongsinProfile) {
  const dGanH = toH(dStem);
  const dJiH = toH(dJi);
  const myGanH = toH(dayGan);
  const myJiH = toH(dayJi);

  const phaseScore = TWELVE_PHASE_MATRIX[myGanH]?.[dJiH] ?? 0;

  const dStemElem = CHEONGAN_ELEM[dGanH];
  const dJiElem = JIJI_ELEM[dJiH];
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
    mental: Math.max(-100, Math.min(100, Math.round(-total * 0.3 + (100 - Math.abs(eventBonus)) * 0.5))),
    growth: Math.max(-100, Math.min(100, Math.round(total * 0.5 + 20))),
    upperBand: Math.min(100, total + frictionWidth),
    lowerBand: Math.max(-100, total - frictionWidth),
    frictionWidth
  };
}

// ============================================================================
// 5. [마스터 모듈] SajuGrapEngine 인터페이스
// ============================================================================
function calculateSajuGrap(input) {
  const { year, month, day, hour = 12, minute = 0, gender = 1 } = input;
  const isMale = Number(gender) === 1;

  const solar = Solar.fromYmdHms(year, month, day, hour, minute, 0);
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

  const natalAnalysis = evaluateNatalProfile(solar, pillars);

  const yun = eightChar.getYun(isMale ? 1 : 0);
  const daYunList = yun.getDaYun();
  const firstDaYun = daYunList[1] || daYunList[0];
  const startAge = firstDaYun ? firstDaYun.getStartAge() : yun.getStartYear();

  const isYangYear = YANG_STEMS.includes(yearGan);
  const isForward = (isYangYear && isMale) || (!isYangYear && !isMale);

  const daewoonWaves = [];
  for (let i = 1; i <= 8; i++) {
    const daYun = daYunList[i];
    if (!daYun) continue;

    const ganZhi = daYun.getGanZhi();
    if (!ganZhi || ganZhi.length < 2) continue;

    const dStem = ganZhi.charAt(0);
    const dJi = ganZhi.charAt(1);
    const sAge = daYun.getStartAge();
    const eAge = daYun.getEndAge();
    const sYear = daYun.getStartYear();

    const wave = evaluateDaewoonPoint(dayGan, dayJi, dStem, dJi, natalAnalysis.yongsinProfile);

    daewoonWaves.push({
      step: i,
      ganZhi,
      ageRange: { start: sAge, end: eAge },
      startYear: sYear,
      scores: {
        total: wave.total,
        career: wave.career,
        wealth: wave.wealth,
        love: wave.love,
        mental: wave.mental,
        growth: wave.growth
      },
      band: {
        upper: wave.upperBand,
        lower: wave.lowerBand,
        margin: wave.frictionWidth
      }
    });
  }

  return {
    meta: {
      inputDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      gender: isMale ? 'male' : 'female',
      isForward,
      startAge
    },
    pillars,
    analysis: natalAnalysis,
    daewoonWaves
  };
}

module.exports = { calculateSajuGrap };

// ============================================================================
// 6. 터미널 대화형 인터페이스
// ============================================================================
if (require.main === module) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (q, def) => new Promise(r => rl.question(`${q} [기본값: ${def}]: `, a => r(a.trim() || def)));

  (async () => {
    console.log('\n=============================================================');
    console.log('       🌟  사주그랩 (SAJU GRAP) 통합 분석 엔진  🌟       ');
    console.log('=============================================================\n');

    const year = parseInt(await question('1. 출생 연도 (YYYY)', '2000'), 10);
    const month = parseInt(await question('2. 출생 월 (1~12)', '1'), 10);
    const day = parseInt(await question('3. 출생 일 (1~31)', '1'), 10);
    const hour = parseInt(await question('4. 출생 시 (0~23)', '12'), 10);
    const minute = parseInt(await question('5. 출생 분 (0~59)', '0'), 10);
    const gender = parseInt(await question('6. 성별 (1: 남성, 2: 여성)', '1'), 10);

    rl.close();

    const output = calculateSajuGrap({ year, month, day, hour, minute, gender });
    const p = output.analysis.yongsinProfile;
    const s = output.analysis.metaStars;

    console.log('\n=============================================================');
    console.log('                     📊 원국 및 세력 분석                     ');
    console.log('=============================================================');
    console.log(`• 사주 원국 : [년] ${output.pillars.year}  [월] ${output.pillars.month}  [일] ${output.pillars.day}  [시] ${output.pillars.hour}`);
    console.log(`• 세력 판정 : ${output.analysis.strengthScore}점 / 100점 ➔ [ ${output.analysis.status} ]`);
    console.log(`• 5대 운성  : 용신 [ ${p.yongsin} ] | 희신 [ ${p.heesin} ] | 한신 [ ${p.hansin} ]`);
    console.log(`              구신 [ ${p.gusin} ] | 기신 [ ${p.gisin} ]`);
    console.log('─────────────────────────────────────────────────────────────');
    console.log('✨ [보유 귀인 및 특수 신살]');
    if (s.stars.length > 0) {
      s.stars.forEach(st => console.log(`  - [${st.pos}] ${st.name}`));
    } else {
      console.log('  - 특이 신살 없음');
    }
    console.log('─────────────────────────────────────────────────────────────');
    console.log('⚡ [원국 내 지지 합·충·형]');
    if (s.interactions.length > 0) {
      s.interactions.forEach(it => console.log(`  - ${it.name} (${it.type}): ${it.desc}`));
    } else {
      console.log('  - 특이 합충형 없음');
    }
    console.log('─────────────────────────────────────────────────────────────');
    console.log(`• 대운 정보 : 만 ${output.meta.startAge}세 시작 (${output.meta.isForward ? '순행' : '역행'})`);
    console.log('🌊 [80년 대운 10년 주기 마스터 파동 곡선 (-100 ~ +100)]');
    console.log('─────────────────────────────────────────────────────────────');

    output.daewoonWaves.forEach(w => {
      const normalized = Math.round((w.scores.total + 100) / 5);
      const bar = '█'.repeat(Math.max(1, normalized)).padEnd(40, ' ');
      const sign = w.scores.total >= 0 ? `+${w.scores.total}` : `${w.scores.total}`;
      console.log(`[${w.step}대운] ${w.ageRange.start.toString().padStart(2, ' ')}~${w.ageRange.end}세 (${w.startYear}년) | ${w.ganZhi} | 점수: ${sign.padStart(4, ' ')} | [${bar}]`);
    });

    console.log('=============================================================\n');
  })();
}
