import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'validate-citations.mjs');

// 実日付と衝突しないテスト専用の日付を使う
const FIXTURE_DATE = '2099-01-01';
const rawPath = join(ROOT, 'data', 'raw', `${FIXTURE_DATE}.json`);
const postPath = join(ROOT, 'site', 'src', 'content', 'posts', `${FIXTURE_DATE}.md`);

const archive = {
  date: FIXTURE_DATE,
  items: [
    { id: 's-aaaaaaaaaa', source: 'Test Source', title: '実在するエントリA', url: 'https://example.com/a', publishedAt: `${FIXTURE_DATE}T00:00:00Z` },
    { id: 's-bbbbbbbbbb', source: 'Test Source', title: '実在するエントリB', url: 'https://example.com/b', publishedAt: `${FIXTURE_DATE}T00:00:00Z` },
  ],
};

async function setup() {
  await mkdir(dirname(rawPath), { recursive: true });
  await mkdir(dirname(postPath), { recursive: true });
  await writeFile(rawPath, JSON.stringify(archive, null, 2), 'utf8');
}

async function teardown() {
  await rm(rawPath, { force: true });
  await rm(postPath, { force: true });
}

test('validate-citations: 存在するidのみ引用した記事は exit 0', async () => {
  await setup();
  try {
    const md = `---\ntitle: test\n---\n\n## 見出し\n\n本文です[^s-aaaaaaaaaa]。もう一文[^s-bbbbbbbbbb]。\n\n## この記事の出典\n\n[^s-aaaaaaaaaa]: A\n[^s-bbbbbbbbbb]: B\n`;
    await writeFile(postPath, md, 'utf8');
    const { stdout } = await execFileAsync('node', [SCRIPT, FIXTURE_DATE]);
    assert.match(stdout, /unresolved: 0 \/ total: 2/);
  } finally {
    await teardown();
  }
});

test('validate-citations: 存在しないid（LLMのハルシネーション想定）を引用した記事は exit 1', async () => {
  await setup();
  try {
    const md = `---\ntitle: test\n---\n\n## 見出し\n\n本文です[^s-aaaaaaaaaa]。捏造された出典[^s-ffffffffff]。\n\n## この記事の出典\n\n[^s-aaaaaaaaaa]: A\n`;
    await writeFile(postPath, md, 'utf8');
    await assert.rejects(
      () => execFileAsync('node', [SCRIPT, FIXTURE_DATE]),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /unresolved citations: s-ffffffffff/);
        return true;
      },
    );
  } finally {
    await teardown();
  }
});

test('validate-citations: 脚注が1件もない記事は exit 1', async () => {
  await setup();
  try {
    const md = `---\ntitle: test\n---\n\n## 見出し\n\n脚注なしの本文です。\n`;
    await writeFile(postPath, md, 'utf8');
    await assert.rejects(
      () => execFileAsync('node', [SCRIPT, FIXTURE_DATE]),
      (err) => {
        assert.equal(err.code, 1);
        return true;
      },
    );
  } finally {
    await teardown();
  }
});
