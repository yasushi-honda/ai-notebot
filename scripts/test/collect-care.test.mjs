import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryFollowupSearch } from '../collect-care.mjs';

function fakeItem(id, tier = 'web') {
  return {
    id,
    source: tier === 'official' ? 'example.go.jp' : 'example.com',
    sourceType: 'web',
    title: tier === 'official' ? '公式ページ（テスト用）' : '一般ページ（テスト用）',
    url: `https://example.${tier === 'official' ? 'go.jp' : 'com'}/${id}`,
    publishedAt: new Date().toISOString(),
    summary: '',
    tier,
    httpStatus: 200,
    checkedAt: new Date().toISOString(),
  };
}

function fakeOfficialItem(id) {
  return fakeItem(id, 'official');
}

// resolveChunks（内部でresolveSourceを呼び実際にfetchする）を経由せず検索ロジックだけを
// 検証するため、groundingChunksは常に空にし、アイテムが「見つかった」ことのシミュレートは
// search()自身がitems配列（クロージャで共有）へ直接アイテムを追加することで行う。
function makeFakeSearch({ officialFoundOnAttempt, extraItemsPerAttempt = 0, items, calls }) {
  return async () => {
    calls.push(Date.now());
    const attempt = calls.length;
    if (officialFoundOnAttempt === attempt) {
      items.push(fakeOfficialItem(`attempt-${attempt}-official`));
    }
    for (let i = 0; i < extraItemsPerAttempt; i += 1) {
      items.push(fakeItem(`attempt-${attempt}-extra-${i}`));
    }
    return {
      text: 'テスト用の要約',
      webSearchQueries: [`query-${attempt}`],
      groundingChunks: [],
      searchEntryPointHtml: '',
    };
  };
}

test('retryFollowupSearch: 呼び出し前から official が1件以上・件数も充足していれば search を1回も呼ばない', async () => {
  const items = [fakeOfficialItem('pre-existing'), fakeItem('pre-existing-2'), fakeItem('pre-existing-3')];
  const calls = [];
  const officialCount = await retryFollowupSearch({
    researchSummary: '下調べメモ',
    items,
    seenUrls: new Set(),
    webSearchQueries: [],
    searchEntryPointHtmlParts: [],
    minResolvedSources: 3,
    search: makeFakeSearch({ officialFoundOnAttempt: null, items, calls }),
  });
  assert.equal(calls.length, 0);
  assert.equal(officialCount, 1);
});

test('retryFollowupSearch: 1回目の追加検索で official が見つかれば2回目は呼ばない', async () => {
  const items = [fakeItem('a'), fakeItem('b'), fakeItem('c')];
  const calls = [];
  const officialCount = await retryFollowupSearch({
    researchSummary: '下調べメモ',
    items,
    seenUrls: new Set(),
    webSearchQueries: [],
    searchEntryPointHtmlParts: [],
    minResolvedSources: 3,
    search: makeFakeSearch({ officialFoundOnAttempt: 1, items, calls }),
  });
  assert.equal(calls.length, 1);
  assert.equal(officialCount, 1);
});

test('retryFollowupSearch: 1回目で見つからなくても2回目（3回目の検索）が発火し、officialが見つかれば成功する', async () => {
  const items = [fakeItem('a'), fakeItem('b'), fakeItem('c')];
  const calls = [];
  const officialCount = await retryFollowupSearch({
    researchSummary: '下調べメモ',
    items,
    seenUrls: new Set(),
    webSearchQueries: [],
    searchEntryPointHtmlParts: [],
    minResolvedSources: 3,
    search: makeFakeSearch({ officialFoundOnAttempt: 2, items, calls }),
  });
  assert.equal(calls.length, 2, '2回目の追加検索（全体では3回目の検索）が実際に呼ばれること');
  assert.equal(officialCount, 1);
});

test('retryFollowupSearch: maxAttempts回すべて見つからなければ officialCount=0 のまま試行回数ぶんで打ち切る（無限に続けない）', async () => {
  const items = [fakeItem('a'), fakeItem('b'), fakeItem('c')];
  const calls = [];
  const officialCount = await retryFollowupSearch({
    researchSummary: '下調べメモ',
    items,
    seenUrls: new Set(),
    webSearchQueries: [],
    searchEntryPointHtmlParts: [],
    minResolvedSources: 3,
    search: makeFakeSearch({ officialFoundOnAttempt: null, items, calls }),
  });
  assert.equal(calls.length, 2, 'デフォルトのMAX_FOLLOWUP_ATTEMPTS(2)回で打ち切ること');
  assert.equal(officialCount, 0);
});

test('retryFollowupSearch: maxAttemptsを1に指定すれば1回で打ち切る（定数変更が実際に効くことの確認）', async () => {
  const items = [fakeItem('a'), fakeItem('b'), fakeItem('c')];
  const calls = [];
  const officialCount = await retryFollowupSearch({
    researchSummary: '下調べメモ',
    items,
    seenUrls: new Set(),
    webSearchQueries: [],
    searchEntryPointHtmlParts: [],
    minResolvedSources: 3,
    maxAttempts: 1,
    search: makeFakeSearch({ officialFoundOnAttempt: 2, items, calls }),
  });
  assert.equal(calls.length, 1);
  assert.equal(officialCount, 0);
});

test('retryFollowupSearch【拡張】: officialは充足済みでも件数がminResolvedSources未満なら追加検索が発火する', async () => {
  const items = [fakeOfficialItem('pre-existing')]; // official 1件のみ、総数1件（3件未満）
  const calls = [];
  const officialCount = await retryFollowupSearch({
    researchSummary: '下調べメモ',
    items,
    seenUrls: new Set(),
    webSearchQueries: [],
    searchEntryPointHtmlParts: [],
    minResolvedSources: 3,
    search: makeFakeSearch({ officialFoundOnAttempt: null, extraItemsPerAttempt: 1, items, calls }),
  });
  assert.equal(calls.length, 2, '件数不足が解消しない限りmaxAttempts回まで発火すること');
  assert.equal(items.length, 3, '2回の追加検索でそれぞれ1件ずつ増え、合計3件に達すること');
  assert.equal(officialCount, 1, '既存のofficial件数は保たれること');
});

test('retryFollowupSearch【拡張】: 件数不足が1回の追加検索で解消すれば2回目は呼ばない', async () => {
  const items = [fakeOfficialItem('pre-existing')]; // official 1件のみ、総数1件（3件未満）
  const calls = [];
  const officialCount = await retryFollowupSearch({
    researchSummary: '下調べメモ',
    items,
    seenUrls: new Set(),
    webSearchQueries: [],
    searchEntryPointHtmlParts: [],
    minResolvedSources: 3,
    search: makeFakeSearch({ officialFoundOnAttempt: null, extraItemsPerAttempt: 2, items, calls }),
  });
  assert.equal(calls.length, 1, '1回目の追加検索で3件に達するため2回目は呼ばれないこと');
  assert.equal(items.length, 3);
  assert.equal(officialCount, 1);
});

test('retryFollowupSearch【拡張】: officialが0件かつ件数も不足している場合、両方の条件が満たされるまで発火する', async () => {
  const items = []; // official 0件、総数0件
  const calls = [];
  const officialCount = await retryFollowupSearch({
    researchSummary: '下調べメモ',
    items,
    seenUrls: new Set(),
    webSearchQueries: [],
    searchEntryPointHtmlParts: [],
    minResolvedSources: 3,
    maxAttempts: 3,
    // 1回目でofficialが見つかる（+1件）が、各回+1件のextraと合わせても1回目終了時点では
    // 2件（3件未満）のため継続し、2回目でさらに1件追加され合計3件に達して打ち切られることを検証する
    search: makeFakeSearch({ officialFoundOnAttempt: 1, extraItemsPerAttempt: 1, items, calls }),
  });
  assert.equal(calls.length, 2, 'officialが見つかった後も件数不足である限り継続すること');
  assert.equal(items.length, 3);
  assert.equal(officialCount, 1);
});
