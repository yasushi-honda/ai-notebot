import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectWeeklyPool, buildWeeklyOverviewTable, pickOgImageDate, shouldAbortWeeklyGeneration } from '../curate-weekly.mjs';

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

function fixtureLegacyPost(sourceIds, tags) {
  // themeTitles導入前（2026-09-09等）の日次記事形式。themeTitlesは存在せずtagsだけ持つ
  return [
    '---',
    'title: "test"',
    `sourceIds: [${sourceIds.map((id) => `"${id}"`).join(', ')}]`,
    `tags: [${tags.map((t) => `"${t}"`).join(', ')}]`,
    '---',
    '',
    '本文',
  ].join('\n');
}

test('collectWeeklyPool: themeTitles未導入の日次記事はtagsにフォールバックする（codex review指摘の回帰テスト）', async () => {
  const dates = ['2026-09-09'];
  const posts = { '2026-09-09': fixtureLegacyPost(['s-aaa'], ['レガシータグA', 'レガシータグB']) };
  const archives = {
    '2026-09-09': { items: [{ id: 's-aaa', title: 't', url: 'https://x', source: 's', summary: 's', publishedAt: '2026-09-09T00:00:00Z' }] },
  };

  const result = await collectWeeklyPool({
    dates,
    readPostMarkdown: async (d) => posts[d] ?? null,
    readRawArchive: async (d) => archives[d] ?? null,
  });

  assert.deepEqual(result.dailyThemes[0], { date: '2026-09-09', themeTitles: ['レガシータグA', 'レガシータグB'] });
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

test('collectWeeklyPool: 日次記事のsourceIdsに載っているがアーカイブ側から解決できないidをunresolvedIdsとして返す（pr-review-toolkit指摘の回帰テスト）', async () => {
  const dates = ['2026-09-13'];
  const posts = { '2026-09-13': fixturePost(['s-found', 's-missing'], ['テーマA']) };
  const archives = {
    // s-missing はこのアーカイブに存在しない（欠損・破損を想定）
    '2026-09-13': { items: [{ id: 's-found', title: 't', url: 'https://x', source: 's', summary: 's', publishedAt: '2026-09-13T00:00:00Z' }] },
  };

  const result = await collectWeeklyPool({
    dates,
    readPostMarkdown: async (d) => posts[d] ?? null,
    readRawArchive: async (d) => archives[d] ?? null,
  });

  assert.deepEqual(result.unresolvedIds, ['s-missing']);
  assert.deepEqual(result.poolIds, ['s-found']);
});

test('collectWeeklyPool: 全idが解決できればunresolvedIdsは空配列', async () => {
  const dates = ['2026-09-13'];
  const posts = { '2026-09-13': fixturePost(['s-aaa'], ['テーマA']) };
  const archives = {
    '2026-09-13': { items: [{ id: 's-aaa', title: 't', url: 'https://x', source: 's', summary: 's', publishedAt: '2026-09-13T00:00:00Z' }] },
  };

  const result = await collectWeeklyPool({
    dates,
    readPostMarkdown: async (d) => posts[d] ?? null,
    readRawArchive: async (d) => archives[d] ?? null,
  });

  assert.deepEqual(result.unresolvedIds, []);
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

// shouldAbortWeeklyGeneration: MIN_DAYS_REQUIRED(=5)の境界値。ADRで明示した安全側
// フェイルセーフの中核のため、main()のprocess.exit(1)と混在させず純関数として検証する
// （pr-review-toolkitのテストカバレッジレビューで指摘）。
test('shouldAbortWeeklyGeneration: 実在日数が5日ちょうど（境界値）なら中止しない', () => {
  const decision = shouldAbortWeeklyGeneration({
    presentDates: ['a', 'b', 'c', 'd', 'e'],
    poolIds: ['s-1'],
  });
  assert.deepEqual(decision, { abort: false });
});

test('shouldAbortWeeklyGeneration: 実在日数が4日（境界値未満）なら中止する', () => {
  const decision = shouldAbortWeeklyGeneration({
    presentDates: ['a', 'b', 'c', 'd'],
    poolIds: ['s-1'],
  });
  assert.equal(decision.abort, true);
  assert.match(decision.reason, /5日未満/);
});

test('shouldAbortWeeklyGeneration: 実在日数が5日以上でもpoolIdsが0件なら中止する', () => {
  const decision = shouldAbortWeeklyGeneration({
    presentDates: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    poolIds: [],
  });
  assert.equal(decision.abort, true);
  assert.match(decision.reason, /候補となる出典が1件もありません/);
});

// collectWeeklyPoolの上限切り詰め: 上限超過時は新しい日を優先し古い日を間引く設計
// （素朴なslice(0, MAX)にリファクタすると挙動が逆転してサイレントに壊れるため、
// pr-review-toolkitのテストカバレッジレビューで指摘のとおり回帰テストを追加する）。
test('collectWeeklyPool: 候補が上限を超える場合、新しい日を優先し古い日から間引く', async () => {
  const MAX = 160; // curate-weekly.mjsのMAX_CANDIDATES_FOR_STAGE_Aと同じ値
  const dates = ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'];
  // 1日あたり30件、7日で210件（上限160を超える）
  const perDay = 30;
  const posts = {};
  const archives = {};
  for (const d of dates) {
    const ids = Array.from({ length: perDay }, (_, i) => `s-${d.replace(/-/g, '')}${String(i).padStart(2, '0')}`);
    posts[d] = fixturePost(ids, [`テーマ${d}`]);
    archives[d] = {
      items: ids.map((id) => ({ id, title: 't', url: `https://x/${id}`, source: 's', summary: 's', publishedAt: `${d}T00:00:00Z` })),
    };
  }

  const result = await collectWeeklyPool({
    dates,
    readPostMarkdown: async (d) => posts[d] ?? null,
    readRawArchive: async (d) => archives[d] ?? null,
  });

  assert.equal(result.poolIds.length, MAX);
  // 最も古い日（2026-09-13）の出典は全て間引かれ、最も新しい日（2026-09-19）は全て残る
  assert.ok(!result.poolIds.some((id) => id.startsWith('s-20260913')));
  assert.equal(result.poolIds.filter((id) => id.startsWith('s-20260919')).length, perDay);
  // 間引き後も日付昇順が維持されている（先頭は最古の残存日、末尾は最新日）
  assert.ok(result.poolIds[0].startsWith('s-20260914'));
  assert.ok(result.poolIds[result.poolIds.length - 1].startsWith('s-20260919'));
});
