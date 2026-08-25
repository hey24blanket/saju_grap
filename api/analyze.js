// api/analyze.js
const { calculateSajuGrap } = require('../src/engine/SajuGrapEngine');

module.exports = async (req, res) => {
  // 1. CORS(모바일 앱 및 웹 통신 허용) 헤더 설정
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // 브라우저 Preflight(OPTIONS) 요청 즉각 통과
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // 2. POST 요청만 허용
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: 'Method Not Allowed. POST 요청만 지원합니다.'
    });
  }

  try {
    const { year, month, day, hour, minute, gender } = req.body;

    // 필수 파라미터 유효성 검증
    if (!year || !month || !day) {
      return res.status(400).json({
        success: false,
        message: 'year, month, day 값은 필수 입력 항목입니다.'
      });
    }

    // 3. 은닉된 코어 엔진 연산 수행
    const result = calculateSajuGrap({
      year: parseInt(year, 10),
      month: parseInt(month, 10),
      day: parseInt(day, 10),
      hour: hour !== undefined ? parseInt(hour, 10) : 12,
      minute: minute !== undefined ? parseInt(minute, 10) : 0,
      gender: gender !== undefined ? parseInt(gender, 10) : 1
    });

    // 4. 결과 JSON 반환
    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('엔진 연산 에러:', error);
    return res.status(500).json({
      success: false,
      message: '사주 분석 연산 중 오류가 발생했습니다.',
      error: error.message
    });
  }
};
