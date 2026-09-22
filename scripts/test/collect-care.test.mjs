import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryOfficialFollowupSearch } from '../collect-care.mjs';

function fakeOfficialItem(id) {
  return {
    id,
    source: 'example.go.jp',
    sourceType: 'web',
    title: '公式ページ（テスト用）',
    url: `https://example.go.jp/${id}`,
    publishedAt: new Date().toISOString(),
    summary: '',
    tier: 'official',
    httpStatus: 200,
    checkedAt: new Date().toISOString(),
  };
}

// resolveChunks（内部でresolveSourceを呼び実際にfetchする）を経由せず検索ロジックだけを
// 検証するため、groundingChunksは常に空にし、officialが「見つかった」ことのシミュレートは
// search()自身がitems配列（クロージャで共有）へ直接officialアイテムを追加することで行う。
function makeFakeSearch({ officialFoundOnAttempt, items, calls }) {
  return async () => {
    calls.push(Date.now());
    const attempt = calls.length;
    if (officialFoundOnAttempt === attempt) {
      items.push(fakeOfficialItem(`attempt-${attempt}`));
    }
    return {
      text: 'テスト用の要約',
      webSearchQueries: [`query-${attempt}`],
      groundingChunks: [],
      searchEntryPointHtml: '',
    };
  };
}

test('retryOfficialFollowupSearch: 呼び出し前から official が1件以上あれば search を1回も呼ばない', async () => {
  const items = [fakeOfficialItem('pre-existing')];
  const calls = [];
  const officialCount = await retryOfficialFollowupSearch({
    researchSummary: '下調べメモ',
    items,
    seenUrls: new Set(),
    webSearchQueries: [],
    searchEntryPointHtmlParts: [],
    search: makeFakeSearch({ officialFoundOnAttempt: null, items, calls }),
  });
  assert.equal(calls.length, 0);
  assert.equal(officialCount, 1);
});

test('retryOfficialFollowupSearch: 1回目の追加検索で official が見つかれば2回目は呼ばない', async () => {
  const items = [];
  const calls = [];
  const officialCount = await retryOfficialFollowupSearch({
    researchSummary: '下調べメモ',
    items,
    seenUrls: new Set(),
    webSearchQueries: [],
    searchEntryPointHtmlParts: [],
    search: makeFakeSearch({ officialFoundOnAttempt: 1, items, calls }),
  });
  assert.equal(calls.length, 1);
  assert.equal(officialCount, 1);
});

test('retryOfficialFollowupSearch: 1回目で見つからなくても2回目（3回目の検索）が発火し、officialが見つかれば成功する', async () => {
  const items = [];
  const calls = [];
  const officialCount = await retryOfficialFollowupSearch({
    researchSummary: '下調べメモ',
    items,
    seenUrls: new Set(),
    webSearchQueries: [],
    searchEntryPointHtmlParts: [],
    search: makeFakeSearch({ officialFoundOnAttempt: 2, items, calls }),
  });
  assert.equal(calls.length, 2, '2回目の追加検索（全体では3回目の検索）が実際に呼ばれること');
  assert.equal(officialCount, 1);
});

test('retryOfficialFollowupSearch: maxAttempts回すべて見つからなければ officialCount=0 のまま試行回数ぶんで打ち切る（無限に続けない）', async () => {
  const items = [];
  const calls = [];
  const officialCount = await retryOfficialFollowupSearch({
    researchSummary: '下調べメモ',
    items,
    seenUrls: new Set(),
    webSearchQueries: [],
    searchEntryPointHtmlParts: [],
    search: makeFakeSearch({ officialFoundOnAttempt: null, items, calls }),
  });
  assert.equal(calls.length, 2, 'デフォルトのMAX_OFFICIAL_FOLLOWUP_ATTEMPTS(2)回で打ち切ること');
  assert.equal(officialCount, 0);
});

test('retryOfficialFollowupSearch: maxAttemptsを1に指定すれば1回で打ち切る（定数変更が実際に効くことの確認）', async () => {
  const items = [];
  const calls = [];
  const officialCount = await retryOfficialFollowupSearch({
    researchSummary: '下調べメモ',
    items,
    seenUrls: new Set(),
    webSearchQueries: [],
    searchEntryPointHtmlParts: [],
    maxAttempts: 1,
    search: makeFakeSearch({ officialFoundOnAttempt: 2, items, calls }),
  });
  assert.equal(calls.length, 1);
  assert.equal(officialCount, 0);
});
