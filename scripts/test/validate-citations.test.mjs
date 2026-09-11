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

test('validate-citations: カンマ区切りで複数idを1つの角括弧に詰め込んだ不正表記は exit 1', async () => {
  await setup();
  try {
    const md = `---\ntitle: test\n---\n\n## 見出し\n\n本文です[^s-aaaaaaaaaa, s-bbbbbbbbbb]。\n\n## この記事の出典\n\n[^s-aaaaaaaaaa]: A\n[^s-bbbbbbbbbb]: B\n`;
    await writeFile(postPath, md, 'utf8');
    await assert.rejects(
      () => execFileAsync('node', [SCRIPT, FIXTURE_DATE]),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /malformed footnotes/);
        return true;
      },
    );
  } finally {
    await teardown();
  }
});

test('validate-citations: 一部の段落にのみ脚注がある記事（裏取り率100%未満）は exit 1', async () => {
  await setup();
  try {
    const md = `---\ntitle: test\n---\n\n## 見出し\n\n脚注のある段落です[^s-aaaaaaaaaa]。\n\n脚注のない段落です。出典のない主張がここに入っています。\n\n[^s-aaaaaaaaaa]: A\n`;
    await writeFile(postPath, md, 'utf8');
    await assert.rejects(
      () => execFileAsync('node', [SCRIPT, FIXTURE_DATE]),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /裏取り率が100%未満です/);
        return true;
      },
    );
  } finally {
    await teardown();
  }
});

test('validate-citations: 同一段落内に脚注のある文と無い文が混在する記事は exit 1（文単位の検証）', async () => {
  await setup();
  try {
    // 段落全体としては脚注を含むが、1文目には脚注がない（実際にcuratee.mjsが
    // 生成した記事で発生したパターン: 段落の書き出しの一般論が無出典のまま残る）。
    // 段落単位の判定では見逃すため、文（句点区切り）単位での検証が必要。
    const md = `---\ntitle: test\n---\n\n## 見出し\n\n出典のない導入文です。続く具体的な事実です[^s-aaaaaaaaaa]。\n\n[^s-aaaaaaaaaa]: A\n`;
    await writeFile(postPath, md, 'utf8');
    await assert.rejects(
      () => execFileAsync('node', [SCRIPT, FIXTURE_DATE]),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /裏取り率が100%未満です/);
        assert.match(err.stderr, /出典のない導入文です/);
        return true;
      },
    );
  } finally {
    await teardown();
  }
});

test('validate-citations: 「！」で終わる無出典文が「。」で終わる有出典文と結合されず検出される', async () => {
  await setup();
  try {
    // 「！」で終わる文の直後に脚注付きの文が続くケース。句点「。」のみで分割すると
    // 両者が1つの「文」として結合され、後半の脚注に引きずられて見逃してしまう。
    const md = `---\ntitle: test\n---\n\n## 見出し\n\n驚きの発表です！詳細はこちらです[^s-aaaaaaaaaa]。\n\n[^s-aaaaaaaaaa]: A\n`;
    await writeFile(postPath, md, 'utf8');
    await assert.rejects(
      () => execFileAsync('node', [SCRIPT, FIXTURE_DATE]),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /裏取り率が100%未満です/);
        assert.match(err.stderr, /驚きの発表です！/);
        return true;
      },
    );
  } finally {
    await teardown();
  }
});

test('validate-citations: 小数点を含む文は誤分割されない（0.5等が独立文扱いにならない）', async () => {
  await setup();
  try {
    const md = `---\ntitle: test\n---\n\n## 見出し\n\n削減率は0.5倍になりました[^s-aaaaaaaaaa]。\n\n[^s-aaaaaaaaaa]: A\n`;
    await writeFile(postPath, md, 'utf8');
    const { stdout } = await execFileAsync('node', [SCRIPT, FIXTURE_DATE]);
    assert.match(stdout, /unresolved: 0 \/ total: 1/);
  } finally {
    await teardown();
  }
});

test('validate-citations: テーブル行（|始まり）は脚注が無くてもOK（機械生成の構造要素として除外）', async () => {
  await setup();
  try {
    const md = [
      '---\ntitle: test\n---',
      '',
      '## 今日のトピック',
      '',
      '| # | テーマ | 出典数 |',
      '|---|---|---|',
      '| 1 | サンプル | 2件 |',
      '',
      '## 見出し',
      '',
      '本文です[^s-aaaaaaaaaa]。',
      '',
      '[^s-aaaaaaaaaa]: A',
      '',
    ].join('\n');
    await writeFile(postPath, md, 'utf8');
    const { stdout } = await execFileAsync('node', [SCRIPT, FIXTURE_DATE]);
    assert.match(stdout, /unresolved: 0 \/ total: 1/);
  } finally {
    await teardown();
  }
});

test('validate-citations: 「今日のトピック」セクション外でLLMが独自にテーブルを書いた場合は免除されない', async () => {
  await setup();
  try {
    // LLMのStage Bは自由形式のMarkdownを返すため、万一「今日のトピック」以外の
    // 場所で無出典のテーブルを書いても、脚注検証をすり抜けてはいけない
    // （codex review 7周目で指摘・修正: 全ての|始まり行を無条件除外していたのが原因）。
    const md = [
      '---\ntitle: test\n---',
      '',
      '## 今日のトピック',
      '',
      '| # | テーマ | 出典数 |',
      '|---|---|---|',
      '| 1 | サンプル | 1件 |',
      '',
      '## 見出し',
      '',
      '本文です[^s-aaaaaaaaaa]。',
      '',
      '| 無出典 | テーブル |',
      '|---|---|',
      '| A | B |',
      '',
      '[^s-aaaaaaaaaa]: A',
      '',
    ].join('\n');
    await writeFile(postPath, md, 'utf8');
    await assert.rejects(
      () => execFileAsync('node', [SCRIPT, FIXTURE_DATE]),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /裏取り率が100%未満です/);
        return true;
      },
    );
  } finally {
    await teardown();
  }
});

test('validate-citations: 箇条書きの各行が句点＋脚注で終われば正しく1文ずつ検証される', async () => {
  await setup();
  try {
    const md = `---\ntitle: test\n---\n\n## 見出し\n\n以下の点が挙げられます[^s-aaaaaaaaaa]。\n\n- 項目1です[^s-aaaaaaaaaa]。\n- 項目2です[^s-bbbbbbbbbb]。\n\n[^s-aaaaaaaaaa]: A\n[^s-bbbbbbbbbb]: B\n`;
    await writeFile(postPath, md, 'utf8');
    const { stdout } = await execFileAsync('node', [SCRIPT, FIXTURE_DATE]);
    assert.match(stdout, /裏取り率: 100%/);
  } finally {
    await teardown();
  }
});

test('validate-citations: 箇条書きの1行だけ脚注が無ければ検出される', async () => {
  await setup();
  try {
    const md = `---\ntitle: test\n---\n\n## 見出し\n\n以下の点が挙げられます[^s-aaaaaaaaaa]。\n\n- 項目1です[^s-aaaaaaaaaa]。\n- 出典のない項目です。\n\n[^s-aaaaaaaaaa]: A\n`;
    await writeFile(postPath, md, 'utf8');
    await assert.rejects(
      () => execFileAsync('node', [SCRIPT, FIXTURE_DATE]),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /裏取り率が100%未満です/);
        assert.match(err.stderr, /出典のない項目です/);
        return true;
      },
    );
  } finally {
    await teardown();
  }
});

test('validate-citations: 本文中で一度も引用されず脚注定義だけが存在する記事は exit 1', async () => {
  await setup();
  try {
    // 本文（地の文）は一切なく、脚注定義行だけが存在するケース。
    // 定義行の先頭も [^s-xxx] の形をしているため、定義行を除外しないと
    // 「引用済み」と誤認識されてしまう（実際はどの主張も裏付けていない）。
    const md = `---\ntitle: test\n---\n\n## 見出し\n\n[^s-aaaaaaaaaa]: A\n`;
    await writeFile(postPath, md, 'utf8');
    await assert.rejects(
      () => execFileAsync('node', [SCRIPT, FIXTURE_DATE]),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /脚注が1件もありません/);
        return true;
      },
    );
  } finally {
    await teardown();
  }
});

// remark-gfmはコードスパン（`...`）内では脚注参照構文を解釈せずリテラル表示するため、
// `[^s-xxx]` のようにバッククォートで囲まれたものは実際にはどの出典にもリンクしない
// 「見た目だけの引用」になる。生Markdownへの正規表現マッチだけでは区別できず誤って
// 「引用済み」と判定してしまうバイパスの回帰テスト（codex reviewで指摘・修正）
test('validate-citations: コードスパンで囲まれた脚注マーカーは本物の引用として扱わない', async () => {
  await setup();
  try {
    const md = `---\ntitle: test\n---\n\n## 見出し\n\n本文です\`[^s-aaaaaaaaaa]\`。\n\n## この記事の出典\n\n[^s-aaaaaaaaaa]: A\n`;
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

// --- 介護版（--type=care）: data/raw-care + site/src/content/care を参照し、
//     AIトレンド版と違ってテーブル行の免除が一切ない（全文100%の裏取りを要求する）

const careRawPath = join(ROOT, 'data', 'raw-care', `${FIXTURE_DATE}.json`);
const carePostPath = join(ROOT, 'site', 'src', 'content', 'care', `${FIXTURE_DATE}.md`);

async function setupCare() {
  await mkdir(dirname(careRawPath), { recursive: true });
  await mkdir(dirname(carePostPath), { recursive: true });
  await writeFile(careRawPath, JSON.stringify(archive, null, 2), 'utf8');
}

async function teardownCare() {
  await rm(careRawPath, { force: true });
  await rm(carePostPath, { force: true });
}

test('validate-citations --type=care: 存在するidのみ引用した記事は exit 0', async () => {
  await setupCare();
  try {
    const md = `---\ntitle: test\n---\n\n## なぜ手間がかかるのか\n\n背景です[^s-aaaaaaaaaa]。\n\n## 手順\n\n1. 手順1です[^s-bbbbbbbbbb]。\n`;
    await writeFile(carePostPath, md, 'utf8');
    const { stdout } = await execFileAsync('node', [SCRIPT, FIXTURE_DATE, '--type=care']);
    assert.match(stdout, /unresolved: 0 \/ total: 2/);
  } finally {
    await teardownCare();
  }
});

test('validate-citations --type=care: テーブル行があっても免除されない（AIトレンド版と違い「今日のトピック」免除が無い）', async () => {
  await setupCare();
  try {
    const md = `---\ntitle: test\n---\n\n## 今日のトピック\n\n| 項目 | 値 |\n|---|---|\n| 出典なしの行 | X |\n\n## 手順\n\n1. 手順1です[^s-aaaaaaaaaa]。\n`;
    await writeFile(carePostPath, md, 'utf8');
    await assert.rejects(
      () => execFileAsync('node', [SCRIPT, FIXTURE_DATE, '--type=care']),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /裏取り率が100%未満/);
        return true;
      },
    );
  } finally {
    await teardownCare();
  }
});

test('validate-citations --type=care: 見出しと本文の間に空行が無く連結されていても本文の未引用文は検出される（実データで発覚したゲートバイパスの回帰テスト）', async () => {
  await setupCare();
  try {
    // 見出し行の直後に空行を挟まず本文が続くケース（LLMが空行を入れ忘れた場合に実際に発生した）。
    // 段落全体が「#始まり」として丸ごと免除されると、本文の無出典文がすり抜けてしまう。
    const md = `---\ntitle: test\n---\n\n## なぜ手間がかかるのか\n背景です[^s-aaaaaaaaaa]。無出典の文です。\n\n## 手順\n\n1. 手順1です[^s-bbbbbbbbbb]。\n`;
    await writeFile(carePostPath, md, 'utf8');
    await assert.rejects(
      () => execFileAsync('node', [SCRIPT, FIXTURE_DATE, '--type=care']),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /裏取り率が100%未満/);
        assert.match(err.stderr, /無出典の文です/);
        return true;
      },
    );
  } finally {
    await teardownCare();
  }
});

test('validate-citations --type=care: 見出し単独の段落（本文が続かない）は従来どおり検証対象外', async () => {
  await setupCare();
  try {
    const md = `---\ntitle: test\n---\n\n## なぜ手間がかかるのか\n\n背景です[^s-aaaaaaaaaa]。\n\n## 手順\n\n1. 手順1です[^s-bbbbbbbbbb]。\n`;
    await writeFile(carePostPath, md, 'utf8');
    const { stdout } = await execFileAsync('node', [SCRIPT, FIXTURE_DATE, '--type=care']);
    assert.match(stdout, /unresolved: 0 \/ total: 2/);
  } finally {
    await teardownCare();
  }
});

test('validate-citations --type=care: コードスパンで囲まれた脚注マーカーは本物の引用として扱わない', async () => {
  await setupCare();
  try {
    const md = `---\ntitle: test\n---\n\n## なぜ手間がかかるのか\n\n背景です\`[^s-aaaaaaaaaa]\`。\n\n## 手順\n\n1. 手順1です[^s-bbbbbbbbbb]。\n`;
    await writeFile(carePostPath, md, 'utf8');
    await assert.rejects(
      () => execFileAsync('node', [SCRIPT, FIXTURE_DATE, '--type=care']),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /裏取り率が100%未満/);
        return true;
      },
    );
  } finally {
    await teardownCare();
  }
});

test('validate-citations --type=care: 手順の1ステップに脚注が無ければ検出される', async () => {
  await setupCare();
  try {
    const md = `---\ntitle: test\n---\n\n## なぜ手間がかかるのか\n\n背景です[^s-aaaaaaaaaa]。\n\n## 手順\n\n1. 脚注のない手順です。\n2. こちらは脚注ありです[^s-bbbbbbbbbb]。\n`;
    await writeFile(carePostPath, md, 'utf8');
    await assert.rejects(
      () => execFileAsync('node', [SCRIPT, FIXTURE_DATE, '--type=care']),
      (err) => {
        assert.equal(err.code, 1);
        assert.match(err.stderr, /裏取り率が100%未満/);
        return true;
      },
    );
  } finally {
    await teardownCare();
  }
});
