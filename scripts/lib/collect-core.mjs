/**
 * 日次ダイジェスト（AIトレンド版・セキュリティ版）共通の収集ロジック。
 * ソース一覧・保存先・しきい値は呼び出し側のプロファイルで差し替える（collect.mjs が AI 版、
 * collect-security.mjs がセキュリティ版）。挙動は scripts/test/digest-characterization.test.mjs で固定している。
 *
 * 流れ: RSS/Atom（＋プロファイル固有の追加ソース）→ 鮮度フィルタ → 直近の既出 URL 除外 →
 *       1ソース上限 → <rawDir>/<date>.json。フィードが1つ落ちていても他は生かす。
 */

import { writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { fetchFeed } from './rss.mjs';
import { todayJst } from './date.mjs';
import { normalizeUrl, makeId } from './source-id.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_HOURS = 9;

/** 直近 lookbackDays 日のアーカイブに既出の URL（正規化済み）を集める。壊れたファイルは無視する。 */
export async function loadRecentUrls({ rawDir, targetDate, lookbackDays }) {
  const seen = new Set();
  let files;
  try {
    files = await readdir(rawDir);
  } catch {
    return seen;
  }
  const cutoff = targetDate.getTime() - lookbackDays * DAY_MS;
  for (const f of files) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    const fileDate = new Date(`${m[1]}T00:00:00Z`);
    if (fileDate.getTime() >= cutoff && fileDate.getTime() < targetDate.getTime()) {
      try {
        const data = JSON.parse(await readFile(join(rawDir, f), 'utf8'));
        for (const item of data.items ?? []) seen.add(normalizeUrl(item.url));
      } catch {
        // 壊れたアーカイブファイルは無視して続行
      }
    }
  }
  return seen;
}

/** RSS/Atom フィード群を並列取得する。ゼロ件・失敗のフィードは警告だけ出して他は生かす。 */
export async function collectRssFeeds(feeds) {
  const results = await Promise.allSettled(feeds.map((f) => fetchFeed(f)));
  const items = [];
  let successCount = 0;
  feeds.forEach((feed, i) => {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value.length > 0) {
      successCount++;
      items.push(...r.value.map((it) => ({ ...it, sourceType: feed.category })));
    } else {
      console.warn(`✗ ${feed.source}: 取得失敗またはゼロ件`);
    }
  });
  return { items, successCount };
}

/**
 * 鮮度フィルタ・既出 URL 除外・当日内の重複除外・1ソース上限をかけ、アーカイブ項目の形に整える。
 *
 * targetDate は JST 基準の日付文字列を `${dateStr}T00:00:00Z` として UTC 解釈しているため、
 * 実時刻は JST では既に「その日の09:00」になっている（todayJst() 参照）。JST 日付としての
 * 「その日の終わり（24:00 JST）」に相当する UTC 時刻は、targetDate から単純に24時間後ではなく、
 * 9時間のズレを補正した15時間後になる（+24時間のままだと翌日09:00 JST までのソースを誤って
 * 許容してしまう。codex review で指摘・修正）。
 */
export function selectCandidates({ all, targetDate, recentUrls, maxAgeDays, maxPerSource }) {
  const futureCutoff = targetDate.getTime() + (24 - JST_OFFSET_HOURS) * 60 * 60 * 1000;
  const cutoff = futureCutoff - maxAgeDays * DAY_MS;

  const seenToday = new Set();
  const perSource = new Map();
  return all
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
      if (count >= maxPerSource) return false;
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
}

/**
 * 収集のオーケストレーション。しきい値未満なら { ok: false } を返し、アーカイブは書かない
 * （呼び出し側が exit 1 にする。古い/薄いアーカイブを書かないための安全弁）。
 *
 * @param {object} profile
 * @param {string} profile.rawDir 保存先ディレクトリ（絶対パス）
 * @param {string} profile.rawLabel ログ表示用の相対パス（例: 'data/raw'）
 * @param {Array} profile.feeds RSS/Atom ソース定義（feeds.mjs の形）
 * @param {() => Promise<{items: Array, successCount: number}>} [profile.collectExtra] RSS 以外のソース（API 等）
 * @param {number} profile.maxAgeDays 新着とみなす日数
 * @param {number} profile.dedupLookbackDays 直近何日の既出 URL を除外するか
 * @param {number} profile.maxPerSource 1ソースが候補を占拠しないための上限
 * @param {number} profile.minSuccessSources 成功ソース数の下限
 * @param {number} profile.minTotalItems 候補件数の下限
 * @param {(candidates: Array) => Promise<Array>} [profile.enrich] しきい値を満たした候補に対する補強（要約の取得等）。
 *   書き出し直前に1回だけ呼ぶ。失敗しても候補を返す責任は enrich 側が持つ
 * @param {string} [dateArg] YYYY-MM-DD（省略時は今日・JST）
 */
export async function runCollection(profile, dateArg) {
  const targetDate = new Date(`${dateArg || todayJst()}T00:00:00Z`);
  const dateStr = targetDate.toISOString().slice(0, 10);

  console.log(`収集対象日: ${dateStr}`);
  const rss = await collectRssFeeds(profile.feeds);
  const extra = profile.collectExtra ? await profile.collectExtra() : { items: [], successCount: 0 };
  const all = [...rss.items, ...extra.items];
  const successCount = rss.successCount + extra.successCount;
  console.log(`ソース成功数: ${successCount} / 生データ件数: ${all.length}`);

  if (successCount < profile.minSuccessSources) {
    console.error(`成功ソース数が閾値(${profile.minSuccessSources})未満です。${profile.rawLabel} は更新しません。`);
    return { ok: false };
  }

  const recentUrls = await loadRecentUrls({
    rawDir: profile.rawDir,
    targetDate,
    lookbackDays: profile.dedupLookbackDays,
  });
  let candidates = selectCandidates({
    all,
    targetDate,
    recentUrls,
    maxAgeDays: profile.maxAgeDays,
    maxPerSource: profile.maxPerSource,
  });

  console.log(`重複排除・鮮度フィルタ後の件数: ${candidates.length}`);

  if (candidates.length < profile.minTotalItems) {
    console.error(`候補件数が閾値(${profile.minTotalItems})未満です（${candidates.length}件）。${profile.rawLabel} は更新しません。`);
    return { ok: false };
  }

  if (profile.enrich) candidates = await profile.enrich(candidates);

  await mkdir(profile.rawDir, { recursive: true });
  const payload = {
    date: dateStr,
    collectedAt: new Date().toISOString(),
    sourceSuccessCount: successCount,
    items: candidates,
  };
  await writeFile(join(profile.rawDir, `${dateStr}.json`), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`${profile.rawLabel}/${dateStr}.json を書き出しました（${candidates.length}件 / ${successCount}ソース成功）`);
  return { ok: true, dateStr, count: candidates.length, successCount };
}
