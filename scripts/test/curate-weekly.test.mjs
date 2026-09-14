import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectWeeklyPool, buildWeeklyOverviewTable, pickOgImageDate } from '../curate-weekly.mjs';

function fixturePost(sourceIds, themeTitles) {
  return [
    '---',
    'title: "test"',
    `sourceIds: [${sourceIds.map((id) => `"${id}"`).join(', ')}]`,
    'themeTitles:',
    ...themeTitles.map((t) => `  - "${t}"`),
    '---',
    '',
    '本文',
  ].join('\n');
}

test('collectWeeklyPool: 7日分すべて実在する場合、全日のsourceIdsを収集する', async () => {
  const dates = ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'];
  const posts = {
    '2026-09-13': fixturePost(['s-aaa'], ['テーマA']),
    '2026-09-14': fixturePost(['s-bbb'], ['テーマB']),
    '2026-09-15': fixturePost(['s-ccc'], ['テーマC']),
    '2026-09-16': fixturePost(['s-ddd'], ['テーマD']),
    '2026-09-17': fixturePost(['s-eee'], ['テーマE']),
    '2026-09-18': fixturePost(['s-fff'], ['テーマF']),
    '2026-09-19': fixturePost(['s-ggg'], ['テーマG']),
  };
  const archives = Object.fromEntries(
    dates.map((d) => [d, { items: [{ id: posts[d].match(/s-\w+/)[0], title: 't', url: 'https://x', source: 's', summary: 's', publishedAt: `${d}T00:00:00Z` }] }]),
  );

  const result = await collectWeeklyPool({
    dates,
    readPostMarkdown: async (d) => posts[d] ?? null,
    readRawArchive: async (d) => archives[d] ?? null,
  });

  assert.deepEqual(result.presentDates, dates);
  assert.equal(result.poolIds.length, 7);
  assert.equal(result.dailyThemes.length, 7);
  assert.deepEqual(result.dailyThemes[0], { date: '2026-09-13', themeTitles: ['テーマA'] });
});

test('collectWeeklyPool: 記事が存在しない日はスキップされpresentDatesに含まれない', async () => {
  const dates = ['2026-09-13', '2026-09-14', '2026-09-15'];
  const posts = {
    '2026-09-13': fixturePost(['s-aaa'], ['テーマA']),
    '2026-09-15': fixturePost(['s-ccc'], ['テーマC']),
  };
  const archives = {
    '2026-09-13': { items: [{ id: 's-aaa', title: 't', url: 'https://x', source: 's', summary: 's', publishedAt: '2026-09-13T00:00:00Z' }] },
    '2026-09-15': { items: [{ id: 's-ccc', title: 't', url: 'https://x', source: 's', summary: 's', publishedAt: '2026-09-15T00:00:00Z' }] },
  };

  const result = await collectWeeklyPool({
    dates,
    readPostMarkdown: async (d) => posts[d] ?? null,
    readRawArchive: async (d) => archives[d] ?? null,
  });

  assert.deepEqual(result.presentDates, ['2026-09-13', '2026-09-15']);
  assert.equal(result.poolIds.length, 2);
});

test('collectWeeklyPool: 同一idが複数日に出現しても重複排除される（同一URLは同じid）', async () => {
  const dates = ['2026-09-13', '2026-09-14'];
  const posts = {
    '2026-09-13': fixturePost(['s-shared'], ['テーマA']),
    '2026-09-14': fixturePost(['s-shared'], ['テーマB']),
  };
  const archives = {
    '2026-09-13': { items: [{ id: 's-shared', title: '共有記事', url: 'https://x', source: 's', summary: 's', publishedAt: '2026-09-13T00:00:00Z' }] },
    '2026-09-14': { items: [{ id: 's-shared', title: '共有記事', url: 'https://x', source: 's', summary: 's', publishedAt: '2026-09-14T00:00:00Z' }] },
  };

  const result = await collectWeeklyPool({
    dates,
    readPostMarkdown: async (d) => posts[d] ?? null,
    readRawArchive: async (d) => archives[d] ?? null,
  });

  assert.equal(result.poolIds.length, 1);
  assert.equal(result.itemsById.size, 1);
});

test('collectWeeklyPool: sourceIdsが空配列の日は実在しても集計対象から除外する', async () => {
  const dates = ['2026-09-13', '2026-09-14'];
  const posts = {
    '2026-09-13': fixturePost([], []),
    '2026-09-14': fixturePost(['s-bbb'], ['テーマB']),
  };
  const archives = {
    '2026-09-14': { items: [{ id: 's-bbb', title: 't', url: 'https://x', source: 's', summary: 's', publishedAt: '2026-09-14T00:00:00Z' }] },
  };

  const result = await collectWeeklyPool({
    dates,
    readPostMarkdown: async (d) => posts[d] ?? null,
    readRawArchive: async (d) => archives[d] ?? null,
  });

  assert.deepEqual(result.presentDates, ['2026-09-14']);
});

test('buildWeeklyOverviewTable: 日付昇順でテーブル行を組み立て、日次記事へのリンクを含む', () => {
  const table = buildWeeklyOverviewTable([
    { date: '2026-09-13', themeTitles: ['テーマA', 'テーマB'] },
    { date: '2026-09-14', themeTitles: [] },
  ]);
  assert.ok(table.includes('## 今週のトピック'));
  assert.ok(table.includes('[2026-09-13](../../posts/2026-09-13/)'));
  assert.ok(table.includes('テーマA / テーマB'));
  assert.ok(table.includes('(記録なし)'));
});

test('buildWeeklyOverviewTable: テーマ見出しに含まれる | をエスケープする', () => {
  const table = buildWeeklyOverviewTable([{ date: '2026-09-13', themeTitles: ['A|B'] }]);
  assert.ok(table.includes('A\\|B'));
});

test('pickOgImageDate: 実在するhero.jpgのうち最新の日を選ぶ', async () => {
  const existing = new Set(['2026-09-13', '2026-09-15']);
  const date = await pickOgImageDate(
    ['2026-09-13', '2026-09-14', '2026-09-15'],
    async (d) => existing.has(d),
  );
  assert.equal(date, '2026-09-15');
});

test('pickOgImageDate: hero.jpgが1件も実在しなければnullを返す（新規画像生成はしない）', async () => {
  const date = await pickOgImageDate(['2026-09-13', '2026-09-14'], async () => false);
  assert.equal(date, null);
});
