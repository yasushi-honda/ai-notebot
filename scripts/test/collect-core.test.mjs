import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRecentUrls, selectCandidates, runCollection } from '../lib/collect-core.mjs';

// テスト対象が進捗を console に出す。出力がテストランナーの通信と混ざると CI で
// 「Unable to deserialize cloned data」になることがあるため、このファイルでは黙らせる。
for (const method of ['log', 'warn', 'error']) mock.method(console, method, () => {});

async function tmpRaw() {
  return mkdtemp(join(tmpdir(), 'collect-core-test-'));
}
async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
const day = (d) => new Date(`${d}T00:00:00Z`);
const archive = (urls) => JSON.stringify({ items: urls.map((url) => ({ url })) });

test('loadRecentUrls: 窓の境界（targetDate - lookbackDays は含み、その前日と targetDate 当日は含まない）', async () => {
  const rawDir = await tmpRaw();
  try {
    await writeFile(join(rawDir, '2099-03-02.json'), archive(['https://e.test/too-old'])); // 窓の1日前
    await writeFile(join(rawDir, '2099-03-03.json'), archive(['https://e.test/edge'])); // 窓の先頭（target-7日）
    await writeFile(join(rawDir, '2099-03-09.json'), archive(['https://e.test/yesterday']));
    await writeFile(join(rawDir, '2099-03-10.json'), archive(['https://e.test/same-day'])); // 当日は除外対象外
    const seen = await loadRecentUrls({ rawDir, targetDate: day('2099-03-10'), lookbackDays: 7 });
    assert.deepEqual([...seen].sort(), ['https://e.test/edge', 'https://e.test/yesterday']);
  } finally {
    await rm(rawDir, { recursive: true, force: true });
  }
});

test('loadRecentUrls: 日付形式でないファイル名は無視し、壊れた JSON があっても他のファイルの URL は集める', async () => {
  const rawDir = await tmpRaw();
  try {
    await writeFile(join(rawDir, 'notes.json'), archive(['https://e.test/ignored']));
    await writeFile(join(rawDir, '2099-03-08.json'), '{ 壊れた');
    await writeFile(join(rawDir, '2099-03-09.json'), archive(['https://e.test/ok']));
    const seen = await loadRecentUrls({ rawDir, targetDate: day('2099-03-10'), lookbackDays: 7 });
    assert.deepEqual([...seen], ['https://e.test/ok']);
  } finally {
    await rm(rawDir, { recursive: true, force: true });
  }
});

test('loadRecentUrls: rawDir が存在しなければ空の Set', async () => {
  const seen = await loadRecentUrls({ rawDir: join(tmpdir(), 'no-such-dir-collect-core'), targetDate: day('2099-03-10'), lookbackDays: 7 });
  assert.equal(seen.size, 0);
});

test('selectCandidates: 鮮度（JST 24時まで・3日以内）・正規化 URL での重複・1ソース上限・既出 URL を適用する', () => {
  const targetDate = day('2099-03-10'); // JST 2099-03-10 の 09:00 相当。終端は 2099-03-10T15:00Z
  const mk = (source, path, iso) => ({ source, sourceType: 'media', title: path, url: `https://e.test/${path}`, date: new Date(iso), description: '' });
  const all = [
    mk('A', 'fresh1', '2099-03-10T14:59:00Z'), // 終端の1分前 → 採用
    mk('A', 'future', '2099-03-10T15:00:00Z'), // 終端ちょうど → 除外（< futureCutoff）
    mk('A', 'edge-old', '2099-03-07T15:00:00Z'), // 窓の先頭ちょうど → 採用
    mk('A', 'too-old', '2099-03-07T14:59:00Z'), // 1分古い → 除外
    mk('A', 'seen-before', '2099-03-10T10:00:00Z'), // 既出 URL
    { ...mk('A', 'dup', '2099-03-10T09:00:00Z'), url: 'https://e.test/dup?utm_source=x' },
    { ...mk('B', 'dup', '2099-03-10T08:00:00Z'), url: 'https://e.test/dup' }, // 正規化すると同一
    mk('C', 'c1', '2099-03-10T07:00:00Z'),
    mk('C', 'c2', '2099-03-10T06:00:00Z'),
    mk('C', 'c3', '2099-03-10T05:00:00Z'),
    mk('C', 'c4', '2099-03-10T04:00:00Z'), // C は4件あるが上限3件
  ];
  const out = selectCandidates({
    all,
    targetDate,
    recentUrls: new Set(['https://e.test/seen-before']),
    maxAgeDays: 3,
    maxPerSource: 3,
  });
  const urls = out.map((c) => c.url);
  assert.ok(urls.includes('https://e.test/fresh1'));
  assert.ok(urls.includes('https://e.test/edge-old'));
  assert.ok(!urls.includes('https://e.test/future'));
  assert.ok(!urls.includes('https://e.test/too-old'));
  assert.ok(!urls.includes('https://e.test/seen-before'));
  assert.equal(urls.filter((u) => u.startsWith('https://e.test/dup')).length, 1);
  assert.equal(out.filter((c) => c.source === 'C').length, 3);
  assert.ok(out.every((c) => /^s-[0-9a-f]+$/.test(c.id)));
});

function profileWith(rawDir, items, overrides = {}) {
  return {
    rawDir,
    rawLabel: 'raw',
    feeds: [],
    collectExtra: async () => ({ items, successCount: 1 }),
    maxAgeDays: 3,
    dedupLookbackDays: 7,
    maxPerSource: 8,
    minSuccessSources: 1,
    minTotalItems: 2,
    ...overrides,
  };
}
const item = (n) => ({ source: 'S', sourceType: 'media', title: `t${n}`, url: `https://e.test/p${n}`, date: new Date('2099-03-10T10:00:00Z'), description: `d${n}` });

test('runCollection: しきい値を満たせばアーカイブを書き、前日アーカイブの URL は候補から落ちる', async () => {
  const rawDir = await tmpRaw();
  try {
    await writeFile(join(rawDir, '2099-03-09.json'), archive(['https://e.test/p1']));
    const r = await runCollection(profileWith(rawDir, [item(1), item(2), item(3)]), '2099-03-10');
    assert.equal(r.ok, true);
    const written = JSON.parse(await readFile(join(rawDir, '2099-03-10.json'), 'utf8'));
    assert.deepEqual(written.items.map((i) => i.url).sort(), ['https://e.test/p2', 'https://e.test/p3']);
    assert.equal(written.sourceSuccessCount, 1);
  } finally {
    await rm(rawDir, { recursive: true, force: true });
  }
});

test('runCollection: 候補件数がしきい値未満なら ok:false でアーカイブを書かない', async () => {
  const rawDir = await tmpRaw();
  try {
    const r = await runCollection(profileWith(rawDir, [item(1)], { minTotalItems: 2 }), '2099-03-10');
    assert.equal(r.ok, false);
    assert.equal(await exists(join(rawDir, '2099-03-10.json')), false);
  } finally {
    await rm(rawDir, { recursive: true, force: true });
  }
});

test('runCollection: 成功ソース数がしきい値未満なら ok:false でアーカイブを書かない', async () => {
  const rawDir = await tmpRaw();
  try {
    const r = await runCollection(profileWith(rawDir, [item(1), item(2), item(3)], { minSuccessSources: 2 }), '2099-03-10');
    assert.equal(r.ok, false);
    assert.equal(await exists(join(rawDir, '2099-03-10.json')), false);
  } finally {
    await rm(rawDir, { recursive: true, force: true });
  }
});
