/**
 * RSS/Atom ソース定義テーブル。ソースの追加・削除はこのファイルの編集のみで完結する。
 * 全 URL は 2026-09-10 時点で実疎通確認済み（HTTP 200）。
 *
 * 除外した候補と理由:
 * - Anthropic 公式ブログ RSS: 提供なし（/rss.xml, /news/rss.xml とも 404）
 *   → 代替として GitHub の Claude Code リリース Atom を採用
 * - Meta AI blog RSS (ai.meta.com/blog/rss/): 404
 * - Mistral AI news feed (mistral.ai/news/feed.xml): 404
 */

/** @type {Array<{source: string, category: 'vendor'|'media'|'japanese', urls: string[]}>} */
export const RSS_FEEDS = [
  // --- vendor: 公式ブログ・リリース ---
  { source: 'OpenAI', category: 'vendor', urls: ['https://openai.com/news/rss.xml'] },
  { source: 'Google AI', category: 'vendor', urls: ['https://blog.google/technology/ai/rss/'] },
  { source: 'Google Developers Blog', category: 'vendor', urls: ['https://developers.googleblog.com/feeds/posts/default'] },
  { source: 'Google Cloud Blog', category: 'vendor', urls: ['https://cloudblog.withgoogle.com/rss/'] },
  { source: 'Hugging Face Blog', category: 'vendor', urls: ['https://huggingface.co/blog/feed.xml'] },
  // Anthropic は公式 RSS 未提供のため、Claude Code のリリースノートを代替一次ソースとする
  { source: 'Claude Code (Anthropic)', category: 'vendor', urls: ['https://github.com/anthropics/claude-code/releases.atom'] },

  // --- media: 技術メディア ---
  { source: 'TechCrunch AI', category: 'media', urls: ['https://techcrunch.com/category/artificial-intelligence/feed/'] },
  { source: 'The Verge AI', category: 'media', urls: ['https://www.theverge.com/rss/ai-artificial-intelligence/index.xml'] },
  { source: 'Ars Technica', category: 'media', urls: ['https://feeds.arstechnica.com/arstechnica/technology-lab'] },
  { source: 'MIT Technology Review AI', category: 'media', urls: ['https://www.technologyreview.com/topic/artificial-intelligence/feed'] },
  { source: 'VentureBeat AI', category: 'media', urls: ['https://venturebeat.com/category/ai/feed/'] },
  { source: 'Lobsters (ai tag)', category: 'media', urls: ['https://lobste.rs/t/ai.rss'] },

  // --- japanese: 日本語ソース ---
  { source: 'Zenn (AI トピック)', category: 'japanese', urls: ['https://zenn.dev/topics/ai/feed'] },
  { source: 'Qiita (AI タグ)', category: 'japanese', urls: ['https://qiita.com/tags/ai/feed'] },
  { source: 'ITmedia AI+', category: 'japanese', urls: ['https://rss.itmedia.co.jp/rss/2.0/aiplus.xml'] },
  { source: 'はてなブックマーク (IT)', category: 'japanese', urls: ['https://b.hatena.ne.jp/hotentry/it.rss'] },
];

/** Reddit は .json エンドポイントが 403 を返すため .rss を使う。個別に 429 になっても他ソースは生かす。 */
export const REDDIT_SUBS = ['LocalLLaMA', 'MachineLearning', 'artificial'];

/** arXiv の対象カテゴリ */
export const ARXIV_CATEGORIES = ['cs.AI', 'cs.CL', 'cs.LG'];

/**
 * Hacker News Algolia 検索クエリ（話題性の高いものだけを候補にするため points 下限を設ける）。
 * search_by_date（新着順）は投稿直後で票が伸びていないことが多いため、
 * minPoints は低めに設定し hitsPerPage で母数を確保する。
 */
export const HN_QUERY = { query: 'AI', minPoints: 5, hitsPerPage: 40 };

/** GitHub Trending の代替: Search API で直近アップデートの多い AI 関連リポジトリを拾う */
export const GITHUB_TOPICS = ['ai', 'llm'];
