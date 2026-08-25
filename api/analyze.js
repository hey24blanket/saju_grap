// api/analyze.js
// 사주 원국 계산 + Gemini 3.6 Flash 가이드라인 일괄 JSON 생성

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  const { name = '사용자', year, month, day, hour, minute = 0, gender = 1 } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  try {
    // 1. 사주 원국 및 100년 대운 기본 연산
    const ganList = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
    const zhiList = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
    const elements = { '갑':'목', '을':'목', '병':'화', '정':'화', '무':'토', '기':'토', '경':'금', '신':'금', '임':'수', '계':'수' };

    const yIndex = Math.abs((year - 4) % 60);
    const yearPillar = ganList[yIndex % 10] + zhiList[yIndex % 12];
    const monthPillar = ganList[(yIndex * 2 + month) % 10] + zhiList[(month + 1) % 12];
    const dayPillar = ganList[(Math.floor(year * 5.25) + month * 2 + day) % 10] + zhiList[(day + 4) % 12];
    const hourPillar = ganList[(ganList.indexOf(dayPillar[0]) * 2 + Math.floor(hour / 2)) % 10] + zhiList[Math.floor((hour + 1) / 2) % 12];

    const dayGan = dayPillar[0];
    const dayElem = elements[dayGan] || '화';

    // 가상 대운 10구간 (100년 파동)
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

    // 2. Gemini 3.6 Flash 가이드라인 기반 일괄 JSON 생성
    let aiPack = null;
    if (apiKey) {
      const systemInstruction = `
당신은 '사주그랩(Saju Grap) 파동 역학 & 전략적 명리 해석 가이드라인'을 완벽히 체화한 AI 수석 컨설턴트입니다.

[사주그랩 핵심 철학]
1. 운은 길흉(좋다/나쁘다)이 아니라 "어떤 행동 모드가 유리한지 읽는 시간의 구조"입니다.
2. Y축 점수는 '운의 성패'가 아니라 '에너지 극성(+100 발산·실행 ~ -100 수렴·재설계)'을 의미합니다.
3. 4대 운성(용·희·기·구신)과 세력 균형은 결핍을 한탄하는 것이 아니라 삶의 에너지를 능동적으로 경영하는 도구입니다.
4. 모든 문장은 100% 품격 있는 한국어로 작성하며, 영문 소제목은 절대 사용하지 않습니다.

반드시 아래 JSON Schema 규격에 맞추어 완전한 JSON 객체 하나만 반환하세요.
`;

      const prompt = `
내담자 정보:
- 이름: ${name}
- 사주: 년주(${yearPillar}), 월주(${monthPillar}), 일주(${dayPillar}), 시주(${hourPillar})
- 일간: ${dayGan} (${dayElem})
- 대표 대운: ${daewoonWaves[3].ganZhi} 대운 (파동 점수: ${daewoonWaves[3].scores.total}점)

요구사항:
내담자의 사주 원국과 대표 대운을 분석하여 다음 키를 포함하는 JSON을 작성하세요.
{
  "yongsin": { "title": "용신(用神) 심층 해설", "desc": "용신 기운의 본질과 이를 활용한 돌파 전략 (3~4문장)" },
  "heesin": { "title": "희신(喜神) 심층 해설", "desc": "희신 기운의 역할과 귀인/환경 활용 전략 (3~4문장)" },
  "gisin": { "title": "기신(忌神) 심층 해설", "desc": "과잉 에너지에 대한 주의점과 내실 관리 팁 (3~4문장)" },
  "gusin": { "title": "구신(仇神) 심층 해설", "desc": "방해 요소를 사전 차단하고 멘탈을 지키는 팁 (3~4문장)" },
  "strength": { "title": "세력 균형 지수 분석", "desc": "신강/신약 판정에 따른 에너지 완급 조절법 (3~4문장)" },
  "flow": { "title": "대운 순행/역행 흐름", "desc": "시간의 물결을 타는 방향성과 호흡 조절 가이드 (3~4문장)" },
  "domains": {
    "career": "현재 대운에서의 사업/추진 행동 모드 가이드 (발산/수렴 적용)",
    "wealth": "현재 대운에서의 재물/안정 행동 모드 가이드 (수확/필터링 적용)",
    "mental": "현재 대운에서의 심신/회복 행동 모드 가이드 (Deep Work 적용)",
    "love": "현재 대운에서의 연애/인연 행동 모드 가이드 (동시성 조율)"
  },
  "masterInsight": "사주그랩 철학을 반영한 대표 대운 2문장 총평"
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
              maxOutputTokens: 2000
            }
          })
        }
      );

      const geminiData = await geminiRes.json();
      const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawText) {
        aiPack = JSON.parse(rawText);
      }
    }

    // AI 통신 실패 시 폴백 가이드라인 데이터
    if (!aiPack) {
      aiPack = {
        yongsin: { title: "용신(用神) 심층 해설", desc: "당신의 중심을 잡아주는 토(식상)의 기운입니다. 생각에 머물지 않고 구조화된 루틴을 실행할 때 가장 강력한 발산 모드가 열립니다." },
        heesin: { title: "희신(喜神) 심층 해설", desc: "용신을 돕는 금(재성)의 기운입니다. 추진한 일들의 결실을 맺고 객관적인 시스템을 구축하는 데 유리하게 작용합니다." },
        gisin: { title: "기신(忌神) 심층 해설", desc: "에너지가 한쪽으로 쏠릴 때 발생하는 과열을 경계해야 합니다. 억지 확장보다는 누수를 막는 점검이 효과적입니다." },
        gusin: { title: "구신(仇神) 심층 해설", desc: "집중력을 분산시키는 요소를 정리하고, 불필요한 인간관계와 프로젝트를 필터링하는 용기가 필요합니다." },
        strength: { title: "세력 균형 지수", desc: "원국의 주도권이 명확하므로 스스로 판을 짜고 이끌어가는 독자적인 실행 전략이 유리합니다." },
        flow: { title: "대운 순행/역행 흐름", desc: "순리대로 흐르는 파동 속에서 성급함을 내려놓고 국면별 행동 매뉴얼에 집중하십시오." },
        domains: {
          career: "외부 발표와 론칭에 최적화된 발산 모드입니다. 완벽주의를 버리고 8주 단위 파일럿을 가동하세요.",
          wealth: "벌어들인 성과를 시스템화하고 불필요한 고정비를 필터링하는 정리가 필요합니다.",
          mental: "성과 뒤에 반드시 회복 슬롯을 캘린더에 고정하여 번아웃을 예방하세요.",
          love: "상대방과의 즐거움이 체력을 잠식하지 않도록 에너지 안배에 유의하세요."
        },
        masterInsight: `${name}님의 대표 대운은 수렴과 발산이 균형을 이루는 구간입니다. 파동의 방향을 믿고 한 걸음씩 나아가세요.`
      };
    }

    // 3. 통합 결과 반환
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
        meta: { isForward: gender === 1, startAge: 4 },
        aiPack // 팝업/버튼용 즉시 로드 데이터
      }
    });

  } catch (error) {
    console.error('Analyze Error:', error);
    return res.status(500).json({ success: false, message: '데이터 연산 중 오류가 발생했습니다.' });
  }
}
