import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { snapshot } from '../build-care.mjs';

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'build-care.mjs');

// 実日付と衝突しないテスト専用の日付を使う
const FIXTURE_DATE = '2099-01-02';
const carePostPath = join(ROOT, 'site', 'src', 'content', 'care', `${FIXTURE_DATE}.md`);
const careImagesDir = join(ROOT, 'site', 'public', 'images', 'care', FIXTURE_DATE);
const rawCarePath = join(ROOT, 'data', 'raw-care', `${FIXTURE_DATE}.json`);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test('build-care: 収集が失敗しても（GEMINI_ACCESS_TOKEN未設定を模擬）exit 0 で終わり、記事は生成されない（AC-C4）', async () => {
  const env = { ...process.env };
  delete env.GEMINI_ACCESS_TOKEN;

  try {
    const { stdout, stderr } = await execFileAsync('node', [SCRIPT, FIXTURE_DATE], { env });
    const combined = stdout + stderr;
    assert.match(combined, /::warning::\[build-care\]/);
    assert.equal(await exists(carePostPath), false);
    assert.equal(await exists(careImagesDir), false);
  } finally {
    await rm(carePostPath, { force: true });
    await rm(careImagesDir, { recursive: true, force: true });
  }
});

test('build-care: 既に有効な記事が存在する状態で失敗すると、削除せず既存の記事を保持する（同日再実行での破壊的削除の回帰テスト。codex reviewで指摘・修正）', async () => {
  const env = { ...process.env };
  delete env.GEMINI_ACCESS_TOKEN;

  const existingMarkdown = '---\ntitle: "既存の有効な記事"\n---\n\n本文です。\n';
  const existingSvg = '<svg xmlns="http://www.w3.org/2000/svg"><text>既存の図解</text></svg>';
  const svgPath = join(careImagesDir, 'steps.svg');

  await mkdir(dirname(carePostPath), { recursive: true });
  await mkdir(careImagesDir, { recursive: true });
  await writeFile(carePostPath, existingMarkdown, 'utf8');
  await writeFile(svgPath, existingSvg, 'utf8');

  try {
    await execFileAsync('node', [SCRIPT, FIXTURE_DATE], { env });
    assert.equal(await exists(carePostPath), true);
    assert.equal(await readFile(carePostPath, 'utf8'), existingMarkdown);
    assert.equal(await exists(svgPath), true);
    assert.equal(await readFile(svgPath, 'utf8'), existingSvg);
  } finally {
    await rm(carePostPath, { force: true });
    await rm(careImagesDir, { recursive: true, force: true });
  }
});

test('snapshot().restore(): post/images だけでなく data/raw-care アーカイブも一緒に元の内容へ復元する（同日再実行でarchiveだけ新しくなり記事と不整合になる回帰テスト。codex reviewで指摘・修正）', async () => {
  const day1Markdown = '---\ntitle: "1回目に成功した記事"\n---\n\n本文です[^s-day1id001].\n';
  const day1RawCare = JSON.stringify({ date: FIXTURE_DATE, items: [{ id: 's-day1id001', tier: 'official' }] });
  const day2RawCare = JSON.stringify({ date: FIXTURE_DATE, items: [{ id: 's-day2id002', tier: 'web' }] });

  await mkdir(dirname(carePostPath), { recursive: true });
  await mkdir(dirname(rawCarePath), { recursive: true });
  await writeFile(carePostPath, day1Markdown, 'utf8');
  await writeFile(rawCarePath, day1RawCare, 'utf8');

  try {
    // 1回目成功後の状態をスナップショット
    const backup = await snapshot(FIXTURE_DATE);

    // 2回目の実行で collect-care.mjs が data/raw-care を新しい内容に上書きしたことを模擬する
    await writeFile(rawCarePath, day2RawCare, 'utf8');

    // その後 curate-care や citation-gate が失敗し、復元される
    await backup.restore();

    assert.equal(await readFile(carePostPath, 'utf8'), day1Markdown);
    assert.equal(await readFile(rawCarePath, 'utf8'), day1RawCare);
  } finally {
    await rm(carePostPath, { force: true });
    await rm(rawCarePath, { force: true });
  }
});
