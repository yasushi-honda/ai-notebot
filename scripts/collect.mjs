#!/usr/bin/env node
/**
 * ① 全ソース収集スクリプト。
 * RSS/Atom（ベンダー公式・技術メディア・日本語）＋ HN/Reddit/arXiv/GitHub の API ソースを束ね、
 * 正規化・重複排除・鮮度フィルタをかけて data/raw/YYYY-MM-DD.json に書き出す。
 *
 * 使い方: node scripts/collect.mjs [YYYY-MM-DD]（省略時は今日の日付・JST基準）
 *
 * フィードが1つ落ちていても他は生かす（Promise.allSettled）。
 * 成功ソース数が MIN_SUCCESS_SOURCES を下回ったら exit 1（古い/薄いアーカイブを書かない）。
 */

import { writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { RSS_FEEDS } from './lib/feeds.mjs';
import { fetchFeed } from './lib/rss.mjs';
import { fetchHackerNews, fetchReddit, fetchArxiv, fetchGitHubTrending } from './lib/collectors.mjs';
import { todayJst } from './lib/date.mjs';
import { normalizeUrl, makeId } from './lib/source-id.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = join(ROOT, 'data', 'raw');

const MAX_AGE_DAYS = 3; // 新着とみなす日数（日次収集なので短め）
const DEDUP_LOOKBACK_DAYS = 7; // 直近7日に既出のURLは新着から除外
const MAX_PER_SOURCE = 8; // 1ソースが候補を占拠しないための上限
const MIN_SUCCESS_SOURCES = 8; // これを下回ったら公開しない（AC-1 の前提）
const MIN_TOTAL_ITEMS = 50;

async function loadRecentUrls(targetDate) {
  const seen = new Set();
  let files;
  try {
    files = await readdir(RAW_DIR);
  } catch {
    return seen;
  }
  const cutoff = targetDate.getTime() - DEDUP_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  for (const f of files) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    const fileDate = new Date(`${m[1]}T00:00:00Z`);
    if (fileDate.getTime() >= cutoff && fileDate.getTime() < targetDate.getTime()) {
      try {
        const data = JSON.parse(await readFile(join(RAW_DIR, f), 'utf8'));
        for (const item of data.items ?? []) seen.add(normalizeUrl(item.url));
      } catch {
        // 壊れたアーカイブファイルは無視して続行
      }
    }
  }
  return seen;
}

async function collectAll() {
  const rssResults = await Promise.allSettled(RSS_FEEDS.map((f) => fetchFeed(f)));
  const rssItems = [];
  let rssSuccessCount = 0;
  RSS_FEEDS.forEach((feed, i) => {
    const r = rssResults[i];
    if (r.status === 'fulfilled' && r.value.length > 0) {
      rssSuccessCount++;
      rssItems.push(...r.value.map((it) => ({ ...it, sourceType: feed.category })));
    } else {
      console.warn(`✗ ${feed.source}: 取得失敗またはゼロ件`);
    }
  });

  const apiResults = await Promise.allSettled([
    fetchHackerNews().then((items) => ({ name: 'Hacker News', items, type: 'hn' })),
    fetchReddit().then((items) => ({ name: 'Reddit', items, type: 'reddit' })),
    fetchArxiv().then((items) => ({ name: 'arXiv', items, type: 'arxiv' })),
    fetchGitHubTrending().then((items) => ({ name: 'GitHub Trending', items, type: 'github' })),
  ]);

  let apiSuccessCount = 0;
  const apiItems = [];
  for (const r of apiResults) {
    if (r.status === 'fulfilled' && r.value.items.length > 0) {
      apiSuccessCount++;
      apiItems.push(...r.value.items.map((it) => ({ ...it, sourceType: r.value.type })));
    } else if (r.status === 'rejected') {
      console.warn(`✗ API ソース失敗: ${r.reason?.message ?? r.reason}`);
    }
  }

  return { items: [...rssItems, ...apiItems], successCount: rssSuccessCount + apiSuccessCount };
}

async function main() {
  const dateArg = process.argv[2];
  const targetDate = new Date(`${dateArg || todayJst()}T00:00:00Z`);
  const dateStr = targetDate.toISOString().slice(0, 10);

  console.log(`収集対象日: ${dateStr}`);
  const { items: all, successCount } = await collectAll();
  console.log(`ソース成功数: ${successCount} / 生データ件数: ${all.length}`);

  if (successCount < MIN_SUCCESS_SOURCES) {
    console.error(`成功ソース数が閾値(${MIN_SUCCESS_SOURCES})未満です。data/raw は更新しません。`);
    process.exit(1);
  }

  const recentUrls = await loadRecentUrls(targetDate);
  // targetDateはJST基準の日付文字列を`${dateStr}T00:00:00Z`としてUTC解釈しているため、
  // targetDateの実時刻はJSTでは既に「その日の09:00」になっている（todayJst()参照）。
  // JST日付としての「その日の終わり（24:00 JST）」に相当するUTC時刻は、targetDateから
  // 単純に24時間後ではなく、9時間のズレを補正した15時間後になる（例:
  // targetDate=2026-09-12T00:00Z(=2026-09-12 09:00 JST)+15h=2026-09-12T15:00Z
  // (=2026-09-13 00:00 JST)。+24時間のままだと翌日09:00 JSTまでのソースを誤って許容
  // してしまう（codex reviewで指摘・修正）。
  const JST_OFFSET_HOURS = 9;
  const futureCutoff = targetDate.getTime() + (24 - JST_OFFSET_HOURS) * 60 * 60 * 1000;
  const cutoff = futureCutoff - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

  const seenToday = new Set();
  const perSource = new Map();
  const candidates = all
    .filter(
      (i) =>
        i.date instanceof Date &&
        !Number.isNaN(i.date.getTime()) &&
        i.date.getTime() >= cutoff &&
        i.date.getTime() < futureCutoff,
    )
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .filter((i) => {
      const key = normalizeUrl(i.url);
      if (seenToday.has(key) || recentUrls.has(key)) return false;
      seenToday.add(key);
      const count = perSource.get(i.source) ?? 0;
      if (count >= MAX_PER_SOURCE) return false;
      perSource.set(i.source, count + 1);
      return true;
    })
    .map((i) => ({
      id: makeId(i.url),
      source: i.source,
      sourceType: i.sourceType,
      title: i.title,
      url: i.url,
      publishedAt: i.date.toISOString(),
      summary: i.description || '',
    }));

  console.log(`重複排除・鮮度フィルタ後の件数: ${candidates.length}`);

  if (candidates.length < MIN_TOTAL_ITEMS) {
    console.error(`候補件数が閾値(${MIN_TOTAL_ITEMS})未満です（${candidates.length}件）。data/raw は更新しません。`);
    process.exit(1);
  }

  await mkdir(RAW_DIR, { recursive: true });
  const payload = {
    date: dateStr,
    collectedAt: new Date().toISOString(),
    sourceSuccessCount: successCount,
    items: candidates,
  };
  await writeFile(join(RAW_DIR, `${dateStr}.json`), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`data/raw/${dateStr}.json を書き出しました（${candidates.length}件 / ${successCount}ソース成功）`);
}

main().catch((err) => {
  console.error('収集処理が失敗しました:', err);
  process.exit(1);
});
