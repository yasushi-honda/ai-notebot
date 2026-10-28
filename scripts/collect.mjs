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

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { RSS_FEEDS } from './lib/feeds.mjs';
import { fetchHackerNews, fetchReddit, fetchArxiv, fetchGitHubTrending } from './lib/collectors.mjs';
import { runCollection } from './lib/collect-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = join(ROOT, 'data', 'raw');

/** AI 版固有の API ソース（HN / Reddit / arXiv / GitHub）。RSS 以外はここで束ねる。 */
async function collectApiSources() {
  const apiResults = await Promise.allSettled([
    fetchHackerNews().then((items) => ({ name: 'Hacker News', items, type: 'hn' })),
    fetchReddit().then((items) => ({ name: 'Reddit', items, type: 'reddit' })),
    fetchArxiv().then((items) => ({ name: 'arXiv', items, type: 'arxiv' })),
    fetchGitHubTrending().then((items) => ({ name: 'GitHub Trending', items, type: 'github' })),
  ]);

  let successCount = 0;
  const items = [];
  for (const r of apiResults) {
    if (r.status === 'fulfilled' && r.value.items.length > 0) {
      successCount++;
      items.push(...r.value.items.map((it) => ({ ...it, sourceType: r.value.type })));
    } else if (r.status === 'rejected') {
      console.warn(`✗ API ソース失敗: ${r.reason?.message ?? r.reason}`);
    }
  }
  return { items, successCount };
}

const PROFILE = {
  rawDir: RAW_DIR,
  rawLabel: 'data/raw',
  feeds: RSS_FEEDS,
  collectExtra: collectApiSources,
  maxAgeDays: 3, // 新着とみなす日数（日次収集なので短め）
  dedupLookbackDays: 7, // 直近7日に既出のURLは新着から除外
  maxPerSource: 8, // 1ソースが候補を占拠しないための上限
  minSuccessSources: 8, // これを下回ったら公開しない（AC-1 の前提）
  minTotalItems: 50,
};

runCollection(PROFILE, process.argv[2])
  .then((result) => {
    if (!result.ok) process.exit(1);
  })
  .catch((err) => {
    console.error('収集処理が失敗しました:', err);
    process.exit(1);
  });
