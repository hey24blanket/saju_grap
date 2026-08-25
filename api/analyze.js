// api/analyze.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  const { name = '사용자', year = 1995, month = 5, day = 15, hour = 12, minute = 0, gender = 1 } = req.body || {};

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
        meta: { isForward: parseInt(gender, 10) === 1, startAge: 4 }
      }
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
