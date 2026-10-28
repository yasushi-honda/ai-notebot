/**
 * 共通化リファクタ（収集・記事生成の抽出）の前後で挙動が変わらないことを固定する特性テスト。
 * 実ネットワーク・実 Vertex AI は使わず、scripts/test/fixtures/stub-fetch.mjs で fetch を差し替えて
 * collect.mjs / curate.mjs を子プロセスとして end-to-end 実行し、出力を golden と完全一致で比較する。
 *
 * golden の更新: UPDATE_GOLDEN=1 node --test scripts/test/digest-characterization.test.mjs
 * （意図した挙動変更のときだけ更新する。リファクタ中に差分が出たら挙動が変わっている）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STUB = pathToFileURL(join(ROOT, 'scripts', 'test', 'fixtures', 'stub-fetch.mjs')).href;
const GOLDEN_DIR = join(ROOT, 'scripts', 'test', 'fixtures', 'golden');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

// 実日付・他テスト（2099-01-01 / 2099-01-02）と衝突しない専用日付。
// collect は直近7日の既出 URL を除外するため、data/raw に fixture を書く他テスト（2099-01-01 等）の窓から十分離す。
const COLLECT_DATE = '2097-06-10';
const CURATE_DATE = '2098-12-20';

async function expectGolden(name, actual) {
  const path = join(GOLDEN_DIR, name);
  if (UPDATE) {
    await mkdir(GOLDEN_DIR, { recursive: true });
    await writeFile(path, actual, 'utf8');
    return;
  }
  const expected = await readFile(path, 'utf8');
  assert.equal(actual, expected, `${name} が golden と異なります（意図した変更なら UPDATE_GOLDEN=1 で更新）`);
}

async function run(script, args, env) {
  try {
    const { stdout, stderr } = await execFileAsync('node', ['--import', STUB, join(ROOT, 'scripts', script), ...args], {
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('collect.mjs: 固定 RSS から data/raw のアーカイブを組み立てる（鮮度・重複排除・1ソース上限・保存先）', async () => {
  const rawPath = join(ROOT, 'data', 'raw', `${COLLECT_DATE}.json`);
  try {
    const r = await run('collect.mjs', [COLLECT_DATE], { STUB_RSS_DATE: COLLECT_DATE });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const archive = JSON.parse(await readFile(rawPath, 'utf8'));
    delete archive.collectedAt; // 実行時刻のみ非決定
    await expectGolden('collect-archive.json', JSON.stringify(archive, null, 2) + '\n');
    await expectGolden('collect-log.txt', r.stdout + '\n---stderr---\n' + r.stderr);
  } finally {
    await rm(rawPath, { force: true });
  }
});

test('collect.mjs: 成功ソース数が閾値未満なら exit 1 で data/raw を書かない', async () => {
  const rawPath = join(ROOT, 'data', 'raw', `${COLLECT_DATE}.json`);
  try {
    const r = await run('collect.mjs', [COLLECT_DATE], {}); // STUB_RSS_DATE なし → 全フィード 404
    assert.equal(r.code, 1);
    await assert.rejects(readFile(rawPath, 'utf8'));
  } finally {
    await rm(rawPath, { force: true });
  }
});

function curateFixtureArchive() {
  const items = [];
  for (let i = 0; i < 12; i++) {
    const id = `s-a${String(i).padStart(9, '0')}`;
    items.push({
      id,
      source: i % 2 === 0 ? 'ソースA' : 'ソースB',
      sourceType: 'media',
      title: `候補${i}`,
      url: `https://example.test/c${i}`,
      publishedAt: `${CURATE_DATE}T0${i % 10}:00:00.000Z`,
      summary: `候補${i}の要約`,
    });
  }
  return { date: CURATE_DATE, collectedAt: `${CURATE_DATE}T00:00:00.000Z`, sourceSuccessCount: 12, items };
}

test('curate.mjs: Stage A/B・再生成・テーマ除外・記事組み立てが従来どおり（記事 Markdown と LLM へ送ったプロンプトを固定）', async () => {
  const rawPath = join(ROOT, 'data', 'raw', `${CURATE_DATE}.json`);
  const postPath = join(ROOT, 'site', 'src', 'content', 'posts', `${CURATE_DATE}.md`);
  const logPath = join(tmpdir(), `curate-char-${process.pid}.jsonl`);
  try {
    await mkdir(dirname(rawPath), { recursive: true });
    await writeFile(rawPath, JSON.stringify(curateFixtureArchive(), null, 2), 'utf8');
    const r = await run('curate.mjs', [CURATE_DATE], { GEMINI_ACCESS_TOKEN: 'stub', STUB_LOG: logPath });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    await expectGolden('curate-post.md', await readFile(postPath, 'utf8'));
    await expectGolden('curate-log.txt', r.stdout + '\n---stderr---\n' + r.stderr);
    const prompts = (await readFile(logPath, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    await expectGolden('curate-llm-requests.json', JSON.stringify(prompts, null, 2) + '\n');
  } finally {
    await rm(rawPath, { force: true });
    await rm(postPath, { force: true });
    await rm(logPath, { force: true });
  }
});

test('curate.mjs: 残るテーマが最小数未満なら exit 1 で記事を書かない', async () => {
  const rawPath = join(ROOT, 'data', 'raw', `${CURATE_DATE}.json`);
  const postPath = join(ROOT, 'site', 'src', 'content', 'posts', `${CURATE_DATE}.md`);
  try {
    await mkdir(dirname(rawPath), { recursive: true });
    // 候補を2件に絞ると Stage A の各テーマが有効 id を持てず、テーマが最小数（3）未満になる
    const archive = curateFixtureArchive();
    archive.items = archive.items.slice(0, 1);
    await writeFile(rawPath, JSON.stringify(archive, null, 2), 'utf8');
    const r = await run('curate.mjs', [CURATE_DATE], { GEMINI_ACCESS_TOKEN: 'stub' });
    assert.equal(r.code, 1);
    await assert.rejects(readFile(postPath, 'utf8'));
  } finally {
    await rm(rawPath, { force: true });
    await rm(postPath, { force: true });
  }
});
