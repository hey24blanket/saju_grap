// api/analyze.js
// 사주그랩 지침서 전문 룰북 내장 + 25개 시나리오 300자 일괄 생성

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
        labels: ['2021년', '2022년', '2023년', '2024년', '2025년', '2026년', '2027년', '2028년', '2029년', '2030년'],
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
      // PDF 가이드라인 전문 압축 시스템 프롬프트
      const systemInstruction = `
[사주그랩(Saju Grap) 파동 역학 & 전략적 명리 지침서 v1.0]

1. 3대 핵심 철학:
- 모든 운은 파동과 리듬이다: 길/흉의 이분법적 단정을 철저히 배제하고 '발산·중립·수렴' 3극 에너지 스펙트럼으로 해석한다.
- 사주에 나쁜 것은 없다: 기운의 성패를 묻지 않고 "지금 이 기운을 어떻게 쓸 것인가" 행동 쓰임새를 제시한다.
- 바닥을 알면 버틸 수 있고 전체를 보면 무너지지 않는다: 저점(묘·절·태)은 '추가 하락 여지가 없는 절대 바닥'의 안도감으로 해석하며, 영역 간 엇갈림(Divergence)을 통해 에너지를 재배분한다.

2. Y축 극성 & 행동 모드:
- +70~+100 (발산·전면 실행): 론칭, 영업, 발표, 주도권 행사. (과열·과속 방지 슬롯 필수)
- +30~+69 (태동·실전 적용): 배움의 실전 적용, 8주 단위 파일럿, 씨앗 뿌리기.
- -20~+20 (전환·중립): 결론보다 데이터 정리, 시스템 누수 점검.
- -21~-69 (수렴·정리): 결실 수확, 불필요한 프로젝트/관계 필터링, Deep Work.
- -70~-100 (심화·재설계): 추가 하락 없음, 기획서 작성, 연구·자격 취득, 멘탈 리셋.

3. 금지/권장 어휘:
- 금지: "대박운", "최악이다", "조심하라", "망한다", "배우자운이 없다", "Practical Coaching" 등 영문.
- 권장: "외부 확장에 유리한 모드", "내부 구조를 다질 시기", "변동성이 큰 구간", "에너지 재배분".

반드시 100% 한국어로 지정된 JSON 규격에 맞추어 작성하십시오.
`;

      const prompt = `
내담자: ${name} (일간: ${dayGanHanja} ${dayElemKor}, 원국: ${yearGan}${yearZhi}년 ${monthGan}${monthZhi}월 ${dayGan}${dayZhi}일 ${hourGan}${hourZhi}시)

요구사항:
사주그랩 지침서에 따라 각 항목별로 공백 포함 250~300자 내외의 구체적인 행동 전략을 작성하세요.
반드시 아래 JSON Schema로만 반환하세요:
{
  "yongsin": "용신 250~300자 설명",
  "heesin": "희신 250~300자 설명",
  "gisin": "기신 250~300자 설명",
  "gusin": "구신 250~300자 설명",
  "strength": "세력균형 250~300자 설명",
  "flow": "대운흐름 250~300자 설명",
  "scenarios": {
    "daewoon": { "all": "300자", "career": "300자", "wealth": "300자", "mental": "300자", "love": "300자" },
    "year": { "all": "300자", "career": "300자", "wealth": "300자", "mental": "300자", "love": "300자" },
    "month": { "all": "300자", "career": "300자", "wealth": "300자", "mental": "300자", "love": "300자" },
    "day": { "all": "300자", "career": "300자", "wealth": "300자", "mental": "300자", "love": "300자" },
    "hour": { "all": "300자", "career": "300자", "wealth": "300자", "mental": "300자", "love": "300자" }
  },
  "masterInsight": "대표 대운 2문장 총평"
}
`;

      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemInstruction }] },
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.7,
                maxOutputTokens: 3500
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
        console.warn('AI 생성 에러:', e.message);
      }
    }

    // Fallback 데이터
    if (!aiPack || !aiPack.scenarios) {
      const fallback300 = `${name}님의 파동을 분석한 결과, 현재 구간은 외부로 무리하게 확장하기보다 내부 프로세스를 정비하고 핵심 역량을 구조화하기에 최적화된 시기입니다. 성과에 대한 조급함을 내려놓고 8주 단위의 작은 실행 루틴을 확립하세요[cite: 2]. 에너지가 수렴할 때 축적된 내실은 다음 발산 국면에서 폭발적인 추진력으로 전환됩니다[cite: 2].`;
      aiPack = {
        yongsin: `${name}님을 살게 하는 중심 에너지는 식상의 기운입니다[cite: 2]. 생각에만 머물지 않고 구조화된 산출물을 세상에 내놓을 때 파동이 최고점으로 도약합니다[cite: 2]. 완벽주의를 버리고 작게 실험하는 태도를 유지하세요[cite: 2].`,
        heesin: `용신을 든든하게 받쳐주는 재성의 기운입니다[cite: 2]. 추진한 일들의 결실을 객관적인 지표로 전환하고, 유리한 협업 관계를 형성하는 데 강력한 조력자로 작용합니다[cite: 2].`,
        gisin: `에너지가 한쪽으로 쏠릴 때 발생하는 과열을 경계해야 하는 기운입니다[cite: 2]. 억지 확장보다는 누수를 점검하고 감정적 소모를 차단하는 원칙 중심의 태도가 필요합니다[cite: 2].`,
        gusin: `집중력을 분산시키는 요소를 정리해야 하는 기운입니다[cite: 2]. 불필요한 인간관계와 프로젝트를 과감히 필터링하고 본질에 집중할 때 멘탈 리셋이 완성됩니다[cite: 2].`,
        strength: `원국의 주도권이 명확하여 스스로 판을 짜고 실행하는 주도형 전략이 유리합니다[cite: 2]. 다만 과속으로 인한 번아웃을 방지하기 위해 정기적인 회복 슬롯을 일정에 고정하세요[cite: 2].`,
        flow: `시간의 큰 물결이 순리대로 흐르는 구간입니다[cite: 2]. 결과에 집착하지 않고 파동의 리듬에 맞춰 한 걸음씩 나아갈 때 장기적인 안정성을 확보할 수 있습니다[cite: 2].`,
        scenarios: {
          daewoon: { all: fallback300, career: fallback300, wealth: fallback300, mental: fallback300, love: fallback300 },
          year: { all: fallback300, career: fallback300, wealth: fallback300, mental: fallback300, love: fallback300 },
          month: { all: fallback300, career: fallback300, wealth: fallback300, mental: fallback300, love: fallback300 },
          day: { all: fallback300, career: fallback300, wealth: fallback300, mental: fallback300, love: fallback300 },
          hour: { all: fallback300, career: fallback300, wealth: fallback300, mental: fallback300, love: fallback300 }
        },
        masterInsight: `${name}님의 대표 대운은 수렴과 발산이 조화를 이루는 구간입니다[cite: 2]. 파동의 방향을 믿고 실행하세요[cite: 2].`
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
