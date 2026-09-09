/**
 * RSS/Atom 以外の API ソース用アダプタ（HN / Reddit / arXiv / GitHub）。
 * いずれも { title, url, date, description, source } の共通形に正規化して返す。
 * 個別の失敗は呼び出し元で Promise.allSettled により許容される想定のため、ここでは
 * 例外を握りつぶさず素直に throw する（部分障害の許容は呼び出し元の責務）。
 */

import { parseFeed, stripTags } from './rss.mjs';
import { HN_QUERY, REDDIT_SUBS, ARXIV_CATEGORIES, GITHUB_TOPICS } from './feeds.mjs';

const UA = 'ai-notebot/0.1 (+https://github.com/yasushi-honda/ai-notebot)';
const TIMEOUT_MS = 20000;

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Hacker News（Algolia 検索 API）。points 下限で話題性のあるものだけを候補にする。 */
export async function fetchHackerNews() {
  const { query, minPoints, hitsPerPage } = HN_QUERY;
  const url = `https://hn.algolia.com/api/v1/search_by_date?tags=story&query=${encodeURIComponent(query)}&hitsPerPage=${hitsPerPage}`;
  const data = await fetchJson(url);
  return (data.hits ?? [])
    .filter((h) => (h.points ?? 0) >= minPoints && h.title)
    .map((h) => ({
      title: h.title,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      date: new Date(h.created_at),
      description: `points=${h.points} comments=${h.num_comments} (Hacker News)`,
      source: 'Hacker News',
    }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Reddit。.json は 403 を返すため .rss（Atom 形式）を使う。
 * サブレディットごとに独立して失敗を許容する。IP レート制限（429）を避けるため
 * 並列にせず 1.5 秒間隔で順に取得する。
 */
export async function fetchReddit() {
  const out = [];
  for (const sub of REDDIT_SUBS) {
    try {
      const res = await fetch(`https://www.reddit.com/r/${sub}/top/.rss?t=day`, {
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      out.push(...parseFeed(xml).map((i) => ({ ...i, source: `Reddit r/${sub}` })));
    } catch (err) {
      console.warn(`✗ Reddit r/${sub}: ${err.message}`);
    }
    await sleep(1500);
  }
  return out;
}

/** arXiv。API のレスポンスは Atom 形式のため rss.mjs の parseFeed をそのまま再利用できる。 */
export async function fetchArxiv() {
  const results = await Promise.allSettled(
    ARXIV_CATEGORIES.map(async (cat) => {
      const url = `http://export.arxiv.org/api/query?search_query=cat:${cat}&sortBy=submittedDate&sortOrder=descending&max_results=10`;
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      return parseFeed(xml).map((i) => ({ ...i, source: `arXiv ${cat}` }));
    }),
  );
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

/**
 * GitHub Trending の代替。公式 Trending には API がないため、Search API で
 * 直近更新が多い AI 関連リポジトリ（stars>100）を拾う。GITHUB_TOKEN があればレート制限が緩和される。
 */
export async function fetchGitHubTrending() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const results = await Promise.allSettled(
    GITHUB_TOPICS.map(async (topic) => {
      const url = `https://api.github.com/search/repositories?q=topic:${topic}+stars:%3E100&sort=updated&order=desc&per_page=10`;
      const data = await fetchJson(url, headers);
      return (data.items ?? []).map((r) => ({
        title: `${r.full_name}: ${r.description || '(説明なし)'}`,
        url: r.html_url,
        date: new Date(r.pushed_at),
        description: stripTags(`★${r.stargazers_count} ${r.description || ''}`),
        source: `GitHub Trending (${topic})`,
      }));
    }),
  );
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}
