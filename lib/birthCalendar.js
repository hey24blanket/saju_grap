import KoreanLunarCalendar from 'korean-lunar-calendar';

export class BirthInputError extends Error {
  constructor(message, field) { super(message); this.name = 'BirthInputError'; this.field = field; }
}
const fail = (message, field) => { throw new BirthInputError(message, field); };
const pad = n => String(n).padStart(2, '0');
export const dateLabel = p => `${p.year}-${pad(p.month)}-${pad(p.day)}`;

// This converter handles dates only. Lunar calendar months must never be used
// as the solar-term month pillar.
export function normalizeBirthCalendar(input) {
  const calendarType = input.calendarType ?? 'solar';
  if (!['solar', 'lunar'].includes(calendarType)) fail('양력 또는 음력을 선택해 주세요.', 'calendarType');
  const p = Object.fromEntries(['year', 'month', 'day'].map(k => [k, Number(input[k])]));
  if (!Number.isInteger(p.year) || p.year < 1900 || p.year > 2100) fail('출생연도는 1900~2100년이어야 합니다.', 'year');
  if (!Number.isInteger(p.month) || p.month < 1 || p.month > 12 || !Number.isInteger(p.day) || p.day < 1 || p.day > 31) fail('생년월일을 확인해 주세요.', 'day');
  const isLeapMonth = calendarType === 'lunar' ? input.isLeapMonth : false;
  let solar = { ...p };
  if (calendarType === 'lunar') {
    if (typeof isLeapMonth !== 'boolean') fail('음력 생일은 평달 또는 윤달을 명시해 주세요.', 'isLeapMonth');
    const c = new KoreanLunarCalendar();
    if (!c.setLunarDate(p.year, p.month, p.day, isLeapMonth)) fail('존재하지 않는 음력 날짜·윤달이거나 변환 지원 범위를 벗어났습니다. 음력은 2050-11-18까지 지원합니다.', 'day');
    solar = c.getSolarCalendar();
  } else {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
    if (d.getUTCFullYear() !== p.year || d.getUTCMonth() + 1 !== p.month || d.getUTCDate() !== p.day) fail('실제로 존재하는 양력 날짜를 입력해 주세요.', 'day');
  }
  for (const [k, max] of [['hour', 23], ['minute', 59]]) {
    if (input[k] == null || input[k] === '' || !Number.isInteger(Number(input[k])) || Number(input[k]) < 0 || Number(input[k]) > max) fail('태어난 시간을 확인해 주세요. 모르는 시간을 임의로 입력하면 원국이 달라질 수 있습니다.', k);
  }
  const dayBoundary = input.dayBoundary ?? 'midnight';
  if (!['midnight', 'zi'].includes(dayBoundary)) fail('날짜 변경 기준을 확인해 주세요.', 'dayBoundary');
  const timezone = input.timezone ?? 'Asia/Seoul';
  // Overseas and longitude corrections require a separate, explicit policy.
  if (timezone !== 'Asia/Seoul') fail('현재는 한국 출생 시각(Asia/Seoul)만 지원합니다.', 'timezone');
  const wall = { ...solar, hour: Number(input.hour), minute: Number(input.minute), second: Number(input.second ?? 0) };
  if (!Number.isInteger(wall.second) || wall.second < 0 || wall.second > 59) fail('초는 0~59여야 합니다.', 'second');
  const instant = resolveSeoulInstant(wall);
  return {
    calendarType, isLeapMonth, dayBoundary, timezone,
    solar, wall, instant,
    receipt: {
      inputDate: dateLabel(p), calendarType, isLeapMonth,
      solarDate: dateLabel(solar), birthTime: `${pad(wall.hour)}:${pad(wall.minute)}`,
      timezone, utcInstant: new Date(instant).toISOString(),
      dayBoundary, hourStemBasis: 'selected_day_stem', timeBasis: 'recorded_civil_time', longitudeCorrection: false,
      lunarConverter: calendarType === 'lunar' ? 'korean-lunar-calendar@0.4.0' : null,
      solarTermBasis: 'instant_in_UTC+08',
      interpretationPolicy: 'strength_useful_god_and_wave_scores_are_heuristics'
    }
  };
}

// Resolve historical Korean standard time and DST with the host IANA tzdb.
// Refuse gaps and repeated clocks rather than silently choosing an instant.
export function resolveSeoulInstant(p) {
  const naive = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second ?? 0);
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const matches = [];
  for (const offset of [8 * 3600, 8.5 * 3600, 9 * 3600, 9.5 * 3600, 10 * 3600, 30472]) {
    const t = naive - offset * 1000;
    const parts = Object.fromEntries(formatter.formatToParts(t).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
    if (['year', 'month', 'day', 'hour', 'minute', 'second'].every(k => parts[k] === (p[k] ?? 0))) matches.push(t);
  }
  if (matches.length !== 1) fail(matches.length ? '서머타임 종료로 같은 시각이 두 번 존재합니다. 출생 기록의 표준시 여부 확인이 필요합니다.' : '표준시·서머타임 전환으로 존재하지 않는 시각입니다. 출생 기록을 확인해 주세요.', 'hour');
  return matches[0];
}
