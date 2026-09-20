// Browser profile cache helpers (shared with privacy regression tests).

export const EMPTY_PROFILE_STATE = {
  name: '',
  year: null,
  month: null,
  day: null,
  hour: null,
  minute: null,
  gender: null
};

export const USER_PROFILE_CACHE_KEY = 'saju_grap_user_profile_cache';

export function isValidGender(gender) {
  const g = Number(gender);
  return g === 1 || g === 2;
}

export function normalizeCachedProfile(parsed) {
  const next = { ...EMPTY_PROFILE_STATE };
  if (!parsed || typeof parsed !== 'object') return next;

  if (typeof parsed.name === 'string') {
    next.name = parsed.name.trim();
  }

  const year = Number(parsed.year);
  const month = Number(parsed.month);
  const day = Number(parsed.day);
  const hour = Number(parsed.hour);
  const minute = Number(parsed.minute);

  if (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    Number.isInteger(hour) &&
    Number.isInteger(minute) &&
    year >= 1900 &&
    year <= 2100 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= 31 &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59
  ) {
    const realDate = new Date(Date.UTC(year, month - 1, day));
    const validDate =
      realDate.getUTCFullYear() === year &&
      realDate.getUTCMonth() === month - 1 &&
      realDate.getUTCDate() === day;

    if (validDate) {
      next.year = year;
      next.month = month;
      next.day = day;
      next.hour = hour;
      next.minute = minute;
    }
  }

  if (isValidGender(parsed.gender)) {
    next.gender = Number(parsed.gender);
  }

  return next;
}
