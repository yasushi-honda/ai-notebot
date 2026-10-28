import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, access } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotPaths, runPipeline } from '../lib/orchestrate.mjs';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'orchestrate-test-'));
  const post = join(dir, 'post.md');
  const rawDir = join(dir, 'raw');
  const rawFile = join(rawDir, 'day.json');
  // 子プロセス用の小さなスクリプト: 引数のファイルに内容を書き、指定コードで終了する
  const writer = join(dir, 'writer.mjs');
  await writeFile(
    writer,
    `import { writeFileSync, mkdirSync } from 'node:fs'; import { dirname } from 'node:path';
     const [file, content, code] = process.argv.slice(2);
     mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); process.exit(Number(code));`,
  );
  const sleeper = join(dir, 'sleeper.mjs');
  await writeFile(sleeper, `setTimeout(() => {}, 30000);`);
  return { dir, post, rawDir, rawFile, writer, sleeper };
}

test('snapshotPaths().restore(): 既存の内容は元に戻り、元々無かったパスは削除される', async () => {
  const { dir, post, rawFile, rawDir } = await setup();
  try {
    await writeFile(post, '既存の記事');
    const backup = await snapshotPaths([post, rawDir]);
    await writeFile(post, '新しい記事');
    await mkdir(rawDir, { recursive: true });
    await writeFile(rawFile, '新しいアーカイブ');
    await backup.restore();
    assert.equal(await readFile(post, 'utf8'), '既存の記事');
    assert.equal(await exists(rawDir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runPipeline: 全ステップ成功なら ok で、書かれた内容は保持される', async () => {
  const { dir, post, writer } = await setup();
  try {
    const r = await runPipeline({
      label: 't',
      cwd: dir,
      paths: [post],
      steps: [{ args: [writer, post, '新しい記事', '0'], failMessage: '失敗' }],
    });
    assert.equal(r.ok, true);
    assert.equal(await readFile(post, 'utf8'), '新しい記事');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runPipeline: 途中のステップが失敗すると、既存の記事とアーカイブが対で元に戻る', async () => {
  const { dir, post, rawFile, writer } = await setup();
  try {
    await mkdir(join(dir, 'raw'), { recursive: true });
    await writeFile(post, '既存の記事');
    await writeFile(rawFile, '既存のアーカイブ');
    const r = await runPipeline({
      label: 't',
      cwd: dir,
      paths: [post, rawFile],
      steps: [
        { args: [writer, rawFile, '新しいアーカイブ', '0'], failMessage: '収集失敗' },
        { args: [writer, post, '壊れた記事', '1'], failMessage: '生成失敗' },
      ],
    });
    assert.equal(r.ok, false);
    assert.equal(await readFile(post, 'utf8'), '既存の記事');
    assert.equal(await readFile(rawFile, 'utf8'), '既存のアーカイブ');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runPipeline: 初回（既存なし）の失敗では、書きかけのファイルが残らない', async () => {
  const { dir, post, rawFile, writer } = await setup();
  try {
    const r = await runPipeline({
      label: 't',
      cwd: dir,
      paths: [post, rawFile],
      steps: [
        { args: [writer, rawFile, 'アーカイブ', '0'], failMessage: '収集' },
        { args: [writer, post, '記事', '1'], failMessage: '生成失敗' },
      ],
    });
    assert.equal(r.ok, false);
    assert.equal(await exists(post), false);
    assert.equal(await exists(rawFile), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runPipeline: 時間予算を超えたステップは止められ、復元される', async () => {
  const { dir, post, sleeper } = await setup();
  try {
    await writeFile(post, '既存の記事');
    const started = Date.now();
    const r = await runPipeline({
      label: 't',
      cwd: dir,
      paths: [post],
      timeoutMs: 500,
      steps: [{ args: [sleeper], failMessage: '長すぎる' }],
    });
    assert.equal(r.ok, false);
    assert.ok(Date.now() - started < 10000, '予算を超えたら待たずに止める');
    assert.equal(await readFile(post, 'utf8'), '既存の記事');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runPipeline: 予期しない例外（子プロセス起動の失敗等）でも復元して ok:false を返す（旧 build-care は最上位 catch で復元しなかった）', async () => {
  const { dir, post } = await setup();
  try {
    await writeFile(post, '既存の記事');
    const r = await runPipeline({
      label: 't',
      cwd: dir,
      paths: [post],
      steps: [{ args: ['x'], failMessage: '生成失敗' }],
      spawn: () => {
        // 書きかけの状態を作ってから例外を投げる
        writeFileSync(post, '書きかけ');
        throw new Error('spawn 失敗');
      },
    });
    assert.equal(r.ok, false);
    assert.equal(await readFile(post, 'utf8'), '既存の記事');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
