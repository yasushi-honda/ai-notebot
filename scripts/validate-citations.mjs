#!/usr/bin/env node
/**
 * AC-2 の証明コマンド（ハルシネーション遮断の要）。
 * site/src/content/posts/<date>.md（または --type=care 指定時は site/src/content/care/<date>.md）
 * 内の全脚注 [^s-<id>] が、当日アーカイブに実在する id に解決するかを検証する。
 * 未解決が1件でもあれば exit 1（LLM が収集していない情報を書いた場合、公開をここで止める）。
 *
 * 検証ロジック本体は scripts/lib/citation-gate.mjs の純関数（介護版と共有）。
 * 本ファイルはそれを呼び出し、既存の出力文言・終了コードを維持する薄いCLIラッパー。
 *
 * 使い方:
 *   node scripts/validate-citations.mjs [YYYY-MM-DD]                 # AIトレンド版（省略時は今日）
 *   node scripts/validate-citations.mjs [YYYY-MM-DD] --type=care     # 介護版
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { todayJst } from './lib/date.mjs';
import { checkCitations } from './lib/citation-gate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const typeArg = args.find((a) => a.startsWith('--type='))?.split('=')[1] ?? 'posts';
const dateArg = args.find((a) => !a.startsWith('--')) ?? todayJst();

const isCare = typeArg === 'care';
const rawPath = isCare
  ? join(ROOT, 'data', 'raw-care', `${dateArg}.json`)
  : join(ROOT, 'data', 'raw', `${dateArg}.json`);
const postPath = isCare
  ? join(ROOT, 'site', 'src', 'content', 'care', `${dateArg}.md`)
  : join(ROOT, 'site', 'src', 'content', 'posts', `${dateArg}.md`);
// テーブル行の脚注免除は「今日のトピック」テーブル（AIトレンド版のみ curate.mjs が機械生成）だけに
// 限定する。介護版は免除なしで全文100%の裏取りを要求する（docs/adr/ 参照）。
const exemptTableHeading = isCare ? null : '今日のトピック';

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

const result = checkCitations({ markdown, validIds, exemptTableHeading });

console.log(`total: ${result.cited.size} / unresolved: ${result.unresolved.length}`);
console.log(`裏取り率: ${result.backingRate}% (${result.citedSentences.length}/${result.sentences.length} 文に脚注あり)`);

if (result.malformed.length > 0) {
  console.error(`malformed footnotes: ${result.malformed.join(', ')}`);
  console.error('記事に不正な脚注表記（例: カンマ区切りで複数idを1つの角括弧に詰め込んだもの）があります。公開を中止します。');
  process.exit(1);
}

if (result.unresolved.length > 0) {
  console.error(`unresolved citations: ${result.unresolved.join(', ')}`);
  console.error('記事は当日アーカイブに存在しない出典を引用しています。公開を中止します。');
  process.exit(1);
}

if (result.cited.size === 0) {
  console.error('脚注が1件もありません。出典なしの記事は公開しません。');
  process.exit(1);
}

if (result.citedSentences.length < result.sentences.length) {
  console.error(`裏取り率が100%未満です（${result.backingRate}%）。脚注のない文が${result.uncited.length}件あります。`);
  console.error(`未引用の文（先頭80字）: ${result.uncited.map((s) => s.slice(0, 80)).join(' | ')}`);
  process.exit(1);
}

console.log(`unresolved: 0 / total: ${result.cited.size}`);
process.exit(0);
