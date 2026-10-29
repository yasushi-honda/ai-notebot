#!/usr/bin/env node
/**
 * セキュリティ版の収集スクリプト。SECURITY_FEEDS（RSS/Atom）を収集し、要約が短い項目は
 * 元ページの本文で補ったうえで data/raw-security/YYYY-MM-DD.json に書き出す。
 * 収集ロジック本体は AI 版と共通（lib/collect-core.mjs）。違いはソース一覧・保存先・しきい値・要約の補強だけ。
 *
 * 使い方: node scripts/collect-security.mjs [YYYY-MM-DD]（省略時は今日の日付・JST基準）
 * 成功ソース数または候補件数がしきい値を下回ったら exit 1（薄いアーカイブを書かない）。
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { SECURITY_FEEDS } from './lib/feeds.mjs';
import { runCollection } from './lib/collect-core.mjs';
import { enrichSummaries } from './lib/summary-enrich.mjs';
import { resolveSource } from './lib/source-resolver.mjs';
import { extractMainText } from './lib/article-text.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXCERPT_LENGTH = 1500;

/** Actions のアノテーション（運営者が見える）として警告を出す。通知経路が無い劣化を気づけるようにする。 */
const warn = (message) => console.warn(`::warning::[collect-security] ${message}`);

async function enrich(candidates) {
  const { items, attempted, enriched, failures } = await enrichSummaries(candidates, {
    resolve: (url) => resolveSource(url, { extractText: (html) => extractMainText(html, EXCERPT_LENGTH) }),
  });
  console.log(`要約の補強: ${attempted}件を取得し、${enriched}件で本文の抜粋に置き換えました`);
  if (attempted > 0 && enriched * 2 < attempted) {
    // 取得が半分未満しか成功しない場合、要約が薄いまま記事が作られ、出典にない一般論が増えやすい
    const reasons = Object.entries(failures).map(([r, n]) => `${r}×${n}`).join(' / ');
    warn(`要約の補強が${attempted}件中${enriched}件しか成功しませんでした（失敗の内訳: ${reasons}）。本文の材料が薄い記事になる可能性があります。`);
  }
  if (!items.some((i) => i.sourceType === 'official')) {
    warn('公的機関（JPCERT/CC・IPA・JVN・CISA）の項目が1件もありません。一次情報を含まない記事になります。ソースの取得状況を確認してください。');
  }
  return items;
}

// しきい値（minSuccessSources / minTotalItems）は 2026-10-29 の初回確認（9ソース全て取得・直近3日で約166件）を
// 踏まえた暫定値。数日分の実データ（休日を含む）で見直す。
export const PROFILE = {
  rawDir: join(ROOT, 'data', 'raw-security'),
  rawLabel: 'data/raw-security',
  feeds: SECURITY_FEEDS,
  enrich,
  maxAgeDays: 3,
  dedupLookbackDays: 7,
  maxPerSource: 8,
  minSuccessSources: 5,
  minTotalItems: 20,
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCollection(PROFILE, process.argv[2])
    .then((result) => {
      if (!result.ok) process.exit(1);
    })
    .catch((err) => {
      console.error('セキュリティ版の収集処理が失敗しました:', err);
      process.exit(1);
    });
}
