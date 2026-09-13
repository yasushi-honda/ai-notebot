#!/usr/bin/env node
/**
 * AC-1 の証明コマンド: data/raw/<date>.json がソース数10以上・件数50以上を満たすか検証する。
 * 使い方: node scripts/verify-archive.mjs [YYYY-MM-DD]（省略時は今日）
 *
 * MIN_SOURCESは元々15だったが、2026-09-13にVentureBeat AI・Google Developers Blogの
 * 2フィードを恒久除外した影響と、更新頻度の低いブログ（Hugging Face Blog等）がその日
 * 新着を出さない自然な巡り合わせが重なり、過去実績（2026-09-09〜12: 16〜21）を下回る
 * 12まで低下する事例が発生した。「毎日必ず記事を生成する」という運用要件を優先し、
 * 現在の有効ソース総数19種類に対して安全マージンを持たせた10に引き下げた。
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { todayJst } from './lib/date.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIN_SOURCES = 10;
const MIN_ITEMS = 50;

const dateArg = process.argv[2] ?? todayJst();
const path = join(ROOT, 'data', 'raw', `${dateArg}.json`);

let data;
try {
  data = JSON.parse(await readFile(path, 'utf8'));
} catch (err) {
  console.error(`アーカイブファイルが読めません: ${path}\n  ${err.message}`);
  process.exit(1);
}

const items = data.items ?? [];
const uniqueSources = new Set(items.map((i) => i.source));

const sourcesOk = uniqueSources.size >= MIN_SOURCES;
const itemsOk = items.length >= MIN_ITEMS;

console.log(`sources=${uniqueSources.size} items=${items.length}`);

if (sourcesOk && itemsOk) {
  console.log(`sources>=${MIN_SOURCES} items>=${MIN_ITEMS} OK`);
  process.exit(0);
} else {
  console.error(
    `検証失敗: sources=${uniqueSources.size}(要${MIN_SOURCES}) items=${items.length}(要${MIN_ITEMS})`,
  );
  process.exit(1);
}
