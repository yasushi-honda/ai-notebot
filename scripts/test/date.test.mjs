import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weeklyWindow } from '../lib/date.mjs';

test('weeklyWindow: 公開日の前日から遡って7日分を返す（通常ケース）', () => {
  const result = weeklyWindow('2026-09-20');
  assert.deepEqual(result, {
    weekStart: '2026-09-13',
    weekEnd: '2026-09-19',
    dates: [
      '2026-09-13',
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
    ],
  });
});

test('weeklyWindow: 境界値 - 月またぎ', () => {
  const result = weeklyWindow('2026-10-04');
  assert.equal(result.weekStart, '2026-09-27');
  assert.equal(result.weekEnd, '2026-10-03');
  assert.equal(result.dates.length, 7);
});

test('weeklyWindow: 境界値 - 年またぎ', () => {
  const result = weeklyWindow('2027-01-04');
  assert.equal(result.weekStart, '2026-12-28');
  assert.equal(result.weekEnd, '2027-01-03');
});

test('weeklyWindow: 境界値 - うるう年（2028年）2月を含む窓', () => {
  const result = weeklyWindow('2028-03-01');
  assert.deepEqual(result.dates, [
    '2028-02-23',
    '2028-02-24',
    '2028-02-25',
    '2028-02-26',
    '2028-02-27',
    '2028-02-28',
    '2028-02-29',
  ]);
});

test('weeklyWindow: 境界値 - 平年（2026年）2月末をまたぐ窓（うるう年と異なり28日で終わる）', () => {
  const result = weeklyWindow('2026-03-01');
  assert.deepEqual(result.dates, [
    '2026-02-22',
    '2026-02-23',
    '2026-02-24',
    '2026-02-25',
    '2026-02-26',
    '2026-02-27',
    '2026-02-28',
  ]);
});

test('weeklyWindow: 公開日が日曜以外でも「前日から遡って7日」の規則は変わらない', () => {
  const result = weeklyWindow('2026-09-16'); // 水曜日
  assert.equal(result.weekStart, '2026-09-09');
  assert.equal(result.weekEnd, '2026-09-15');
});
