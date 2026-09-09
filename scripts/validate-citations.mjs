#!/usr/bin/env node
/**
 * AC-2 の証明コマンド（ハルシネーション遮断の要）。
 * site/src/content/posts/<date>.md 内の全脚注 [^s-<id>] が、
 * data/raw/<date>.json の当日アーカイブに実在する id に解決するかを検証する。
 * 未解決が1件でもあれば exit 1（LLM が収集していない情報を書いた場合、公開をここで止める）。
 *
 * 使い方: node scripts/validate-citations.mjs [YYYY-MM-DD]（省略時は今日）
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const dateArg = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const rawPath = join(ROOT, 'data', 'raw', `${dateArg}.json`);
const postPath = join(ROOT, 'site', 'src', 'content', 'posts', `${dateArg}.md`);

let archive;
try {
  archive = JSON.parse(await readFile(rawPath, 'utf8'));
} catch (err) {
  console.error(`アーカイブが読めません: ${rawPath}\n  ${err.message}`);
  process.exit(1);
}

let markdown;
try {
  markdown = await readFile(postPath, 'utf8');
} catch (err) {
  console.error(`記事ファイルが読めません: ${postPath}\n  ${err.message}`);
  process.exit(1);
}

const validIds = new Set((archive.items ?? []).map((i) => i.id));

// frontmatter を除いた本文部分から脚注を抽出（frontmatter の sourceIds は自己申告のため対象外）
const bodyStart = markdown.indexOf('\n---\n', 4);
const body = bodyStart >= 0 ? markdown.slice(bodyStart + 5) : markdown;

// 脚注定義行（[^s-xxx]: 出典タイトル ...）を除いた「地の文」だけを引用抽出の対象にする。
// 定義行の先頭も [^s-xxx] という形をしているため、除外しないと「本文中で一度も
// 引用されていないが定義だけ存在するid」を誤って「引用済み」と扱ってしまい、
// どの主張も裏付けていない出典が紛れ込む（codex reviewで指摘・修正）。
const definitionLinePattern = /^\[\^s-[0-9a-f]+\]:.*$/gm;
const prose = body.replace(definitionLinePattern, '');

const footnotePattern = /\[\^(s-[0-9a-f]+)\]/g;
const cited = new Set();
for (const m of prose.matchAll(footnotePattern)) cited.add(m[1]);

// 不正な脚注表記を検出する（例: [^s-aaa, s-bbb] のようにカンマ区切りで複数idを
// 1つの角括弧に詰め込んだもの。LLMがまれにこの形式で出力し、GFM footnote構文として
// 認識されず角括弧がそのまま画面に表示されてしまうため、正しい形式のみ許容する）。
// "[^" で始まり "]" で終わる角括弧のうち、footnotePattern に完全一致しないものを拾う。
const bracketPattern = /\[\^[^\]]*\]/g;
const malformed = [...prose.matchAll(bracketPattern)]
  .map((m) => m[0])
  .filter((s) => !/^\[\^s-[0-9a-f]+\]$/.test(s));

const unresolved = [...cited].filter((id) => !validIds.has(id));

// 裏取り率: 段落（空行区切り、見出し・出典セクション除く）のうち脚注を含む割合
// (.test() は /g フラグ付きだと lastIndex が状態を持つため、判定専用に非グローバル正規表現を使う)
const hasFootnote = /\[\^s-[0-9a-f]+\]/;
const paragraphs = prose
  .split(/\n{2,}/)
  .map((p) => p.trim())
  .filter((p) => p && !p.startsWith('#') && !p.startsWith('[^'));
const citedParagraphs = paragraphs.filter((p) => hasFootnote.test(p));
const backingRate = paragraphs.length > 0 ? Math.round((citedParagraphs.length / paragraphs.length) * 100) : 0;

console.log(`total: ${cited.size} / unresolved: ${unresolved.length}`);
console.log(`裏取り率: ${backingRate}% (${citedParagraphs.length}/${paragraphs.length} 段落に脚注あり)`);

if (malformed.length > 0) {
  console.error(`malformed footnotes: ${malformed.join(', ')}`);
  console.error('記事に不正な脚注表記（例: カンマ区切りで複数idを1つの角括弧に詰め込んだもの）があります。公開を中止します。');
  process.exit(1);
}

if (unresolved.length > 0) {
  console.error(`unresolved citations: ${unresolved.join(', ')}`);
  console.error('記事は当日アーカイブに存在しない出典を引用しています。公開を中止します。');
  process.exit(1);
}

if (cited.size === 0) {
  console.error('脚注が1件もありません。出典なしの記事は公開しません。');
  process.exit(1);
}

// 裏取り率100%を必須とする: 出典のある段落と無い段落が混在すると、
// unresolved=0 かつ cited.size>0 の条件だけでは検出できず、出典のない主張が
// そのまま公開されてしまう（codex reviewで指摘・修正）。
if (citedParagraphs.length < paragraphs.length) {
  const uncited = paragraphs.filter((p) => !hasFootnote.test(p));
  console.error(`裏取り率が100%未満です（${backingRate}%）。脚注のない段落が${uncited.length}件あります。`);
  console.error(`未引用の段落（先頭80字）: ${uncited.map((p) => p.slice(0, 80)).join(' | ')}`);
  process.exit(1);
}

console.log(`unresolved: 0 / total: ${cited.size}`);
process.exit(0);
