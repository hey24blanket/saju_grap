import assert from 'node:assert/strict';
import { normalizeBirthCalendar } from '../lib/birthCalendar.js';
import { calculateSajuGrap, toLegacyApiData } from '../src/engine/SajuGrapEngine.js';
import { normalizeCachedProfile } from '../lib/userProfileCache.js';
import analyze from '../api/analyze.js';
const base = { year: 1985, month: 10, day: 24, hour: 11, minute: 45, gender: 1 };
const input = p => ({ ...base, ...p });
// Published converter examples; not an independent KASI certification.
for (const [lunar, solar] of [
  [{ year: 2017, month: 5, day: 1, isLeapMonth: true }, '2017-06-24'],
  [{ year: 1956, month: 1, day: 21, isLeapMonth: false }, '1956-03-03'],
  [{ year: 2023, month: 2, day: 1, isLeapMonth: true }, '2023-03-22']
]) {
  const p = input({ ...lunar, calendarType: 'lunar' });
  const c = normalizeBirthCalendar(p);
  assert.equal(c.receipt.solarDate, solar);
  const a = calculateSajuGrap(p);
  const b = calculateSajuGrap(input({ ...c.solar, calendarType: 'solar' }));
  assert.deepEqual(a.natal, b.natal, 'equivalent birth dates have identical pillars');
  assert.deepEqual(a.cycles, b.cycles, 'equivalent dates have identical cycles');
  assert.ok(toLegacyApiData(a).pillars.hour);
}
for (const p of [
  { year: 2024, month: 2, day: 30 },
  { year: 2017, month: 3, day: 1, calendarType: 'lunar', isLeapMonth: true },
  { calendarType: 'lunar' }, { calendarType: 'invalid' },
  { hour: null }, { minute: null }, { timezone: 'UTC' }, { dayBoundary: 'invalid' },
  { year: 2051, month: 1, day: 1, calendarType: 'lunar', isLeapMonth: false }
]) assert.throws(() => normalizeBirthCalendar(input(p)));
assert.equal(normalizeBirthCalendar(input({ year: 2024, month: 2, day: 29 })).solar.day, 29);
assert.equal(normalizeBirthCalendar(input({ year: 1956, month: 3, day: 3, hour: 11, minute: 45 })).receipt.utcInstant, '1956-03-03T03:15:00.000Z');
assert.equal(normalizeBirthCalendar(input({ year: 1988, month: 7, day: 1, hour: 11, minute: 45 })).receipt.utcInstant, '1988-07-01T01:45:00.000Z');
// Li Chun 2024 occurs at 16:27:07 UTC+08 = 17:27:07 Seoul.
const before = calculateSajuGrap(input({ year: 2024, month: 2, day: 4, hour: 17, minute: 27, second: 6 }));
const after = calculateSajuGrap(input({ year: 2024, month: 2, day: 4, hour: 17, minute: 27, second: 8 }));
assert.equal(before.natal.year.ganzhi, '癸卯');
assert.equal(after.natal.year.ganzhi, '甲辰');
assert.notEqual(before.natal.month.ganzhi, after.natal.month.ganzhi);
assert.equal(before.natal.day.ganzhi, after.natal.day.ganzhi);
assert.equal(before.natal.hour.ganzhi, after.natal.hour.ganzhi);
const midnight = calculateSajuGrap(input({ hour: 23, dayBoundary: 'midnight' }));
const zi = calculateSajuGrap(input({ hour: 23, dayBoundary: 'zi' }));
const next = calculateSajuGrap(input({ day: 25, hour: 0 }));
assert.notEqual(midnight.natal.day.ganzhi, zi.natal.day.ganzhi);
assert.equal(zi.natal.day.ganzhi, next.natal.day.ganzhi);
assert.notEqual(midnight.natal.hour.ganzhi, zi.natal.hour.ganzhi);
assert.equal(zi.natal.hour.ganzhi, next.natal.hour.ganzhi);
const cached = normalizeCachedProfile(input({ year: 2023, month: 2, day: 30, calendarType: 'lunar', isLeapMonth: true, dayBoundary: 'zi' }));
assert.equal(cached.calendarType, 'lunar');
assert.equal(cached.day, 30);
assert.equal(cached.isLeapMonth, true);
assert.equal(cached.dayBoundary, 'zi');
for (const p of [{ calendarType: 'lunar' }, { hour: null }, { year: 2024, month: 2, day: 30 }, { year: '1985oops' }, { hour: 11.5 }]) {
  let status; let result;
  await analyze({ method: 'POST', body: input(p), headers: {} }, { setHeader() {}, status(n) { status = n; return this; }, json(j) { result = j; return this; } });
  assert.equal(status, 400); assert.equal(result.success, false);
}
assert.throws(() => calculateSajuGrap({ birthDateTime: '1985-10-24', gender: 1 }));
console.log('testBirthCalendar: conversion, historical clock, boundaries, cache and API validation passed');
