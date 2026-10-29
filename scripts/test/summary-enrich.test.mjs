import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichSummaries } from '../lib/summary-enrich.mjs';

const mk = (n, summary) => ({ id: `s-${n}`, url: `https://e.test/${n}`, summary });
const long = 'あ'.repeat(200);

test('enrichSummaries: 要約が短い項目だけ取得して置き換え、十分長い項目は取得しない', async () => {
  const called = [];
  const { items, attempted, enriched } = await enrichSummaries([mk(0, ''), mk(1, long), mk(2, '短い')], {
    resolve: async (url) => (called.push(url), { ok: true, excerpt: '本文の抜粋'.repeat(40) }),
  });
  assert.deepEqual(called.sort(), ['https://e.test/0', 'https://e.test/2']);
  assert.equal(attempted, 2);
  assert.equal(enriched, 2);
  assert.equal(items[1].summary, long);
  assert.ok(items[0].summary.startsWith('本文の抜粋'));
});

test('enrichSummaries: 失敗は元の要約を残し、理由ごとに集計する（例外・HTTP・本文なし・元より短い抜粋）', async () => {
  const resolves = {
    'https://e.test/0': async () => { throw new TypeError('boom'); },
    'https://e.test/1': async () => ({ ok: false, httpStatus: 403 }),
    'https://e.test/2': async () => ({ ok: false, reason: 'no-extractable-text（本文が空）' }),
    'https://e.test/3': async () => ({ ok: true, excerpt: 'x' }),
  };
  const input = [mk(0, '元0'), mk(1, '元1'), mk(2, '元2'), mk(3, '元3の要約です')];
  const { items, enriched, failures } = await enrichSummaries(input, { resolve: (u) => resolves[u]() });
  assert.equal(enriched, 0);
  assert.deepEqual(items.map((i) => i.summary), ['元0', '元1', '元2', '元3の要約です']);
  assert.deepEqual(failures, { '例外: TypeError': 1, 'HTTP 403': 1, 'no-extractable-text': 1, '抜粋が元の要約より短い': 1 });
});

test('enrichSummaries: 理由に URL が混ざっていても、同じ種類として集計する', async () => {
  const { failures } = await enrichSummaries([mk(0, ''), mk(1, '')], {
    resolve: async (url) => ({ ok: false, error: `DNS解決先が許可されないアドレスです: ${url}` }),
  });
  assert.deepEqual(failures, { 'DNS解決先が許可されないアドレスです': 2 });
});

test('enrichSummaries: 対象は先頭 targetCount 件、取得は maxFetches 件まで、同時実行は concurrency まで', async () => {
  const items = Array.from({ length: 10 }, (_, i) => mk(i, ''));
  let active = 0;
  let maxActive = 0;
  const called = [];
  await enrichSummaries(items, {
    targetCount: 8,
    maxFetches: 5,
    concurrency: 2,
    resolve: async (url) => {
      called.push(url);
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { ok: true, excerpt: 'あ'.repeat(10) };
    },
  });
  assert.equal(called.length, 5);
  assert.ok(called.every((u) => Number(u.split('/').pop()) < 8));
  assert.ok(maxActive <= 2);
});
