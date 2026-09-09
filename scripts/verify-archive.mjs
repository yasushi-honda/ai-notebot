#!/usr/bin/env node
/**
 * AC-1 の証明コマンド: data/raw/<date>.json がソース数15以上・件数50以上を満たすか検証する。
 * 使い方: node scripts/verify-archive.mjs [YYYY-MM-DD]（省略時は今日）
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIN_SOURCES = 15;
const MIN_ITEMS = 50;

const dateArg = process.argv[2] ?? new Date().toISOString().slice(0, 10);
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
