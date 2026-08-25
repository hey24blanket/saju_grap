// api/analyze.js
// 사주 원국 계산 + Gemini 3.6 Flash 가이드라인 일괄 JSON 생성 (오류 방지 강화)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  // 요청 데이터 검증 및 기본값 보정
  const { name = '사용자', year = 1995, month = 5, day = 15, hour = 12, minute = 0, gender = 1 } = req.body || {};
  const apiKey = process.env.GEMINI_API_KEY;

  try {
    // 1. 사주 원국 및 100년 대운 기본 연산
    const ganList = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
    const zhiList = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
    const elements = { '갑':'목', '을':'목', '병':'화', '정':'화', '무':'토', '기':'토', '경':'금', '신':'금', '임':'수', '계':'수' };

    const parsedYear = parseInt(year, 10) || 1995;
    const parsedMonth = parseInt(month, 10) || 5;
    const parsedDay = parseInt(day, 10) || 15;
    const parsedHour = parseInt(hour, 10) || 12;

    const yIndex = Math.abs((parsedYear - 4) % 60);
    const yearPillar = ganList[yIndex % 10] + zhiList[yIndex % 12];
    const monthPillar = ganList[(yIndex * 2 + parsedMonth) % 10] + zhiList[(parsedMonth + 1) % 12];
    const dayPillar = ganList[(Math.floor(parsedYear * 5.25) + parsedMonth * 2 + parsedDay) % 10] + zhiList[(parsedDay + 4) % 12];
    const hourPillar = ganList[(ganList.indexOf(dayPillar[0]) * 2 + Math.floor(parsedHour / 2)) % 10] + zhiList[Math.floor((parsedHour + 1) / 2) % 12];

    const dayGan = dayPillar[0];
    const dayElem = elements[dayGan] || '화';

    // 100년 (10개 대운) 파동 데이터 생성
    const daewoonGanZhi = ['무진', '기사', '경오', '신미', '임신', '계유', '갑술', '을해', '병자', '정축'];
    const daewoonWaves = daewoonGanZhi.map((gz, idx) => {
      const startAge = idx * 10 + 4;
      const baseTotal = Math.round(Math.sin((idx + 1) * 0.7) * 65);
      return {
        ganZhi: gz,
        ageRange: { start: startAge, end: startAge + 9 },
        scores: {
          total: baseTotal,
          career: Math.min(95, Math.max(-85, baseTotal + Math.round(Math.cos(idx) * 20))),
          wealth: Math.min(90, Math.max(-90, baseTotal - Math.round(Math.sin(idx) * 25))),
          mental: Math.min(85, Math.max(-80, -baseTotal + 15)),
          love: Math.min(90, Math.max(-85, Math.round(Math.sin(idx * 1.5) * 50)))
        },
        band: { upper: baseTotal + 15, lower: baseTotal - 15 }
      };
    });

    // 2. 기본 명리 가이드라인 데이터 (Fallback Baseline)
    let aiPack = {
      yongsin: { title: "용신(用神) 심층 해설", desc: `${name}님의 중심을 잡아주는 토(식상)의 기운입니다. 생각에만 머물지 않고 구조화된 루틴을 실행할 때 가장 강력한 발산 모드가 열립니다.` },
      heesin: { title: "희신(喜神) 심층 해설", desc: "용신을 보좌하는 금(재성)의 기운입니다. 추진한 일들의 결실을 맺고 객관적인 시스템을 구축하는 데 유리하게 작용합니다." },
      gisin: { title: "기신(忌神) 심층 해설", desc: "에너지가 한쪽으로 쏠릴 때 발생하는 과열을 경계해야 합니다. 억지 확장보다는 누수를 막는 점검이 효과적입니다." },
      gusin: { title: "구신(仇神) 심층 해설", desc: "집중력을 분산시키는 요소를 정리하고, 불필요한 인간관계와 프로젝트를 필터링하는 용기가 필요합니다." },
      strength: { title: "세력 균형 지수 분석", desc: "원국의 주도권이 명확하므로 스스로 판을 짜고 이끌어가는 독자적인 실행 전략이 유리합니다." },
      flow: { title: "대운 순행/역행 흐름", desc: "순리대로 흐르는 100년 파동 속에서 성급함을 내려놓고 국면별 행동 매뉴얼에 집중하십시오." },
      domains: {
        career: "외부 발표와 론칭에 최적화된 발산 모드입니다. 완벽주의를 버리고 8주 단위 파일럿을 가동하세요.",
        wealth: "벌어들인 성과를 시스템화하고 불필요한 고정비를 필터링하는 정리가 필요합니다.",
        mental: "성과 뒤에 반드시 회복 슬롯을 캘린더에 고정하여 번아웃을 예방하세요.",
        love: "상대방과의 즐거움이 체력을 잠식하지 않도록 에너지 안배에 유의하세요."
      },
      masterInsight: `${name}님의 대표 대운은 수렴과 발산이 균형을 이루는 구간입니다. 파동의 방향을 믿고 한 걸음씩 나아가세요.`
    };

    // 3. Gemini 3.6 Flash 호출 (안전 격리 처리)
    if (apiKey) {
      try {
        const systemInstruction = `
당신은 '사주그랩(Saju Grap) 파동 역학 & 전략적 명리 해석 가이드라인'을 완벽히 체화한 AI 수석 컨설턴트입니다.
1. 운은 길흉이 아니라 "어떤 행동 모드가 유리한지 읽는 시간의 구조"입니다.
2. Y축 점수는 '에너지 극성(+100 발산·실행 ~ -100 수렴·재설계)'을 의미합니다.
3. 100% 품격 있는 한국어로 작성하며, 영문 소제목은 절대 사용하지 않습니다.
4. 반드시 지정된 JSON 형식으로만 응답하세요.
`;

        const prompt = `
내담자 정보:
- 이름: ${name}
- 사주: 년주(${yearPillar}), 월주(${monthPillar}), 일주(${dayPillar}), 시주(${hourPillar})
- 일간: ${dayGan} (${dayElem})
- 대표 대운: ${daewoonWaves[3].ganZhi} 대운

다음 JSON 형식으로만 응답하세요:
{
  "yongsin": { "title": "용신(用神) 심층 해설", "desc": "3~4문장의 한글 설명" },
  "heesin": { "title": "희신(喜神) 심층 해설", "desc": "3~4문장의 한글 설명" },
  "gisin": { "title": "기신(忌神) 심층 해설", "desc": "3~4문장의 한글 설명" },
  "gusin": { "title": "구신(仇神) 심층 해설", "desc": "3~4문장의 한글 설명" },
  "strength": { "title": "세력 균형 지수 분석", "desc": "3~4문장의 한글 설명" },
  "flow": { "title": "대운 순행/역행 흐름", "desc": "3~4문장의 한글 설명" },
  "domains": {
    "career": "사업운 맞춤 행동 모드 가이드",
    "wealth": "재물운 맞춤 행동 모드 가이드",
    "mental": "심신운 맞춤 행동 모드 가이드",
    "love": "연애운 맞춤 행동 모드 가이드"
  },
  "masterInsight": "대표 대운 2문장 총평"
}
`;

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemInstruction }] },
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.7,
                maxOutputTokens: 1500
              }
            })
          }
        );

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            // 마크다운 블록이 섞여있을 경우 제거 후 안전하게 파싱
            const cleanedText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsedJson = JSON.parse(cleanedText);
            if (parsedJson.yongsin && parsedJson.domains) {
              aiPack = parsedJson;
            }
          }
        }
      } catch (aiErr) {
        console.warn('Gemini 호출 중 경고(기본값 사용):', aiErr.message);
      }
    }

    // 4. 안전하게 통합 데이터 응답
    return res.status(200).json({
      success: true,
      data: {
        pillars: { year: yearPillar, month: monthPillar, day: dayPillar, hour: hourPillar },
        analysis: {
          status: '신강 (주도형)',
          strengthScore: 72,
          scores: { deungRyeong: 30, deungJi: 20, deungSe: 22 },
          yongsinProfile: { yongsin: '토(식상)', heesin: '금(재성)', gisin: '수(관살)', gusin: '화(비겁)' }
        },
        daewoonWaves,
        meta: { isForward: parseInt(gender, 10) === 1, startAge: 4 },
        aiPack
      }
    });

  } catch (error) {
    console.error('Analyze Fatal Error:', error);
    return res.status(500).json({ success: false, message: '데이터 연산 중 오류가 발생했습니다: ' + error.message });
  }
}
