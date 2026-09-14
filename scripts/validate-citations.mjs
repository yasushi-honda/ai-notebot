#!/usr/bin/env node
/**
 * AC-2 の証明コマンド（ハルシネーション遮断の要）。
 * site/src/content/posts/<date>.md（または --type=care 指定時は site/src/content/care/<date>.md、
 * --type=weekly 指定時は site/src/content/weekly/<weekStart>.md）内の全脚注 [^s-<id>] が、
 * 実在するアーカイブの id に解決するかを検証する。
 * 未解決が1件でもあれば exit 1（LLM が収集していない情報を書いた場合、公開をここで止める）。
 *
 * 検証ロジック本体は scripts/lib/citation-gate.mjs の純関数（介護版・週刊版と共有）。
 * 本ファイルはそれを呼び出し、既存の出力文言・終了コードを維持する薄いCLIラッパー。
 *
 * --type=weekly は複数日のアーカイブにまたがるため、記事 frontmatter の sourceDates を
 * 信用せず、公開日から weeklyWindow()（scripts/curate-weekly.mjsの生成側と同じ純関数）で
 * 対象7日を再計算し、その各日の data/raw/<date>.json の id を union して validIds を作る
 * （生成側と検証側が同じ関数を使うことで対象期間が構造的に一致する）。
 * frontmatter の sourceDates が再計算した窓の部分集合であることも別途検査する（防御的多重化）。
 *
 * 使い方:
 *   node scripts/validate-citations.mjs [YYYY-MM-DD]                 # AIトレンド版（省略時は今日）
 *   node scripts/validate-citations.mjs [YYYY-MM-DD] --type=care     # 介護版
 *   node scripts/validate-citations.mjs [YYYY-MM-DD(公開日)] --type=weekly  # 週刊版
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { todayJst, weeklyWindow } from './lib/date.mjs';
import { checkCitations } from './lib/citation-gate.mjs';
import { parseFrontmatter } from './lib/frontmatter.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const typeArg = args.find((a) => a.startsWith('--type='))?.split('=')[1] ?? 'posts';
const dateArg = args.find((a) => !a.startsWith('--')) ?? todayJst();

const isCare = typeArg === 'care';
const isWeekly = typeArg === 'weekly';

// テーブル行の脚注免除は各版の機械生成テーブル見出しだけに限定する。介護版は免除なしで
// 全文100%の裏取りを要求する（docs/adr/ 参照）。
const exemptTableHeading = isWeekly ? '今週のトピック' : isCare ? null : '今日のトピック';

let validIds;
let postPath;
let markdown;

if (isWeekly) {
  const { weekStart, dates } = weeklyWindow(dateArg);
  postPath = join(ROOT, 'site', 'src', 'content', 'weekly', `${weekStart}.md`);

  try {
    markdown = await readFile(postPath, 'utf8');
  } catch (err) {
    console.error(`記事ファイルが読めません: ${postPath}\n  ${err.message}`);
    process.exit(1);
  }

  validIds = new Set();
  let archivesFound = 0;
  for (const date of dates) {
    try {
      const archive = JSON.parse(await readFile(join(ROOT, 'data', 'raw', `${date}.json`), 'utf8'));
      for (const item of archive.items ?? []) validIds.add(item.id);
      archivesFound++;
    } catch (err) {
      // その日の日次アーカイブが無い（ENOENT、収集失敗等）ことは想定内。curate-weekly.mjs側で
      // 実在日数の下限チェック済みのため、ここでは黙ってスキップする。それ以外（権限エラー・
      // JSON構文エラー等）は本来起きてはいけない異常なので、握りつぶさずログに残す
      // （pr-review-toolkitのsilent-failureレビューで指摘・修正）。
      if (err.code !== 'ENOENT') {
        console.error(`日次アーカイブの読み込みで想定外のエラー（${date}）: ${err.message}`);
      }
    }
  }
  console.log(`対象週${dates.length}日中${archivesFound}日分のアーカイブを読み込みました。`);
  if (archivesFound === 0) {
    console.error(`対象週（${weekStart}〜${dates[dates.length - 1]}）のアーカイブが1件も読めません。`);
    process.exit(1);
  }

  const { frontmatter } = parseFrontmatter(markdown);
  const sourceDates = Array.isArray(frontmatter.sourceDates) ? frontmatter.sourceDates : [];
  const windowSet = new Set(dates);
  const outOfWindow = sourceDates.filter((d) => !windowSet.has(d));
  if (outOfWindow.length > 0) {
    console.error(`記事のsourceDatesが対象週の範囲外の日付を含んでいます: ${outOfWindow.join(', ')}`);
    process.exit(1);
  }
} else {
  const rawPath = isCare
    ? join(ROOT, 'data', 'raw-care', `${dateArg}.json`)
    : join(ROOT, 'data', 'raw', `${dateArg}.json`);
  postPath = isCare
    ? join(ROOT, 'site', 'src', 'content', 'care', `${dateArg}.md`)
    : join(ROOT, 'site', 'src', 'content', 'posts', `${dateArg}.md`);

  let archive;
  try {
    archive = JSON.parse(await readFile(rawPath, 'utf8'));
  } catch (err) {
    console.error(`アーカイブが読めません: ${rawPath}\n  ${err.message}`);
    process.exit(1);
  }

  try {
    markdown = await readFile(postPath, 'utf8');
  } catch (err) {
    console.error(`記事ファイルが読めません: ${postPath}\n  ${err.message}`);
    process.exit(1);
  }

  validIds = new Set((archive.items ?? []).map((i) => i.id));
}

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
