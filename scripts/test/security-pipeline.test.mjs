/**
 * セキュリティ版パイプライン（build-security → collect-security → curate-security → validate-citations）を、
 * fetch スタブで end-to-end 実行する。実ネットワーク・実 Vertex AI は使わない。
 * golden の更新: UPDATE_GOLDEN=1 node --test scripts/test/security-pipeline.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STUB = pathToFileURL(join(ROOT, 'scripts', 'test', 'fixtures', 'stub-fetch.mjs')).href;
const GOLDEN_DIR = join(ROOT, 'scripts', 'test', 'fixtures', 'golden');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

// 他テストの日付（2099-01-0x / 2098-12-20 / 2097-06-10）と、収集の直近7日窓の両方から離す
const DATE = '2097-07-12';
const rawPath = join(ROOT, 'data', 'raw-security', `${DATE}.json`);
const postPath = join(ROOT, 'site', 'src', 'content', 'security', `${DATE}.md`);

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function run(script, args, env) {
  try {
    const { stdout, stderr } = await execFileAsync('node', [join(ROOT, 'scripts', script), ...args], {
      env: { ...process.env, NODE_OPTIONS: `--import=${STUB}`, GEMINI_ACCESS_TOKEN: 'stub', ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function cleanup() {
  await rm(rawPath, { force: true });
  await rm(postPath, { force: true });
}

test('build-security: 収集→生成→出典検証が通り、記事・アーカイブが書かれる（対策・用語の除外経路を含む）', async () => {
  try {
    const r = await run('build-security.mjs', [DATE, '--strict'], { STUB_RSS_DATE: DATE });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const post = await readFile(postPath, 'utf8');

    // 存在しない id を引用した対策と、出典に無い用語は検証で除外される（警告ログが出る）
    assert.match(r.stderr, /対策・用語を除外（テーマ乙不正）: このテーマに与えられていない id/);
    assert.match(r.stderr, /用語が引用した出典の本文に見当たりません/);
    assert.ok(!post.includes('s-ffffffffff'));
    assert.ok(!post.includes('出典に無い語'));
    // 通った対策・用語は本文と frontmatter の両方に出る
    assert.match(post, /### すぐできる対策\n\n- 旧版を使っている場合、該当製品の利用者は、最新版へ更新してください\[\^s-[0-9a-f]+\]。/);
    assert.match(post, /## 今日の用語\n\n- <strong>脆弱性<\/strong>（ぜいじゃくせい）：システムの弱点のこと\[\^s-[0-9a-f]+\]。/);
    assert.match(post, /^glossary: \[\{"term":"脆弱性","reading":"ぜいじゃくせい"/m);
    assert.match(r.stdout, /出典検証|unresolved: 0/);

    if (UPDATE) {
      await mkdir(GOLDEN_DIR, { recursive: true });
      await writeFile(join(GOLDEN_DIR, 'security-post.md'), post, 'utf8');
    } else {
      assert.equal(post, await readFile(join(GOLDEN_DIR, 'security-post.md'), 'utf8'));
    }
  } finally {
    await cleanup();
  }
});

test('build-security: 収集に失敗しても既定では exit 0 で、記事・アーカイブを残さない。--strict なら exit 1', async () => {
  try {
    const lenient = await run('build-security.mjs', [DATE], {}); // STUB_RSS_DATE なし → 全フィード 404
    assert.equal(lenient.code, 0, lenient.stdout + lenient.stderr);
    assert.match(lenient.stdout + lenient.stderr, /::warning::\[build-security\] 収集に失敗しました/);
    assert.equal(await exists(rawPath), false);
    assert.equal(await exists(postPath), false);

    const strict = await run('build-security.mjs', [DATE, '--strict'], {});
    assert.equal(strict.code, 1);
  } finally {
    await cleanup();
  }
});

test('build-security: 同日に生成済みの記事があり再実行が失敗しても、公開済みの記事とアーカイブを保持する', async () => {
  try {
    await mkdir(dirname(rawPath), { recursive: true });
    await mkdir(dirname(postPath), { recursive: true });
    await writeFile(rawPath, '{"items":[]}', 'utf8');
    await writeFile(postPath, '既存の記事', 'utf8');
    const r = await run('build-security.mjs', [DATE], {}); // 収集に失敗する
    assert.equal(r.code, 0);
    assert.equal(await readFile(postPath, 'utf8'), '既存の記事');
    assert.equal(await readFile(rawPath, 'utf8'), '{"items":[]}');
  } finally {
    await cleanup();
  }
});
