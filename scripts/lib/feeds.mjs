/**
 * RSS/Atom ソース定義テーブル。ソースの追加・削除はこのファイルの編集のみで完結する。
 * 全 URL は 2026-09-10 時点で実疎通確認済み（HTTP 200）。
 *
 * 除外した候補と理由:
 * - Anthropic 公式ブログ RSS: 提供なし（/rss.xml, /news/rss.xml とも 404）
 *   → 代替として GitHub の Claude Code リリース Atom を採用
 * - Meta AI blog RSS (ai.meta.com/blog/rss/): 404（代わりに engineering.fb.com/feed/ を採用）
 * - Mistral AI news feed (mistral.ai/news/feed.xml): 404
 * - VentureBeat AI (venturebeat.com/category/ai/feed/): 2026-09-13時点でVercelのbot対策
 *   （Security Checkpoint）により恒久的に429、フィード自体が実質利用不能と判断し除外
 * - Google Developers Blog (developers.googleblog.com/feeds/posts/default): 2026-09-13時点で
 *   フィード側の仕様変更によりitemにpubDateが含まれなくなった。取得時刻をフォールバックする
 *   案も検討したが、フィードのバックログにある古い記事まで「本日の新着」として鮮度フィルタを
 *   通過してしまう懸念（codex reviewで指摘）があるため、正確性を優先し除外
 * - NVIDIA Developer Blog (developer.nvidia.com/blog/feed/): 2026-10-20 に curl では200・100件取得できたが、
 *   その後の再確認で名前解決に失敗し fetchFeed 経由の取得を検証できなかったため見送り（再検討可）
 * - 2026-10-20 の追加検討で除外: The Batch(404) / Ahead of AI(接続不可) / Microsoft Research(403) /
 *   Qwen Blog・Chip Huyen(更新停止) / heise(AI専用でなくドイツ語混入リスク)
 */

/** @type {Array<{source: string, category: 'vendor'|'media'|'japanese', urls: string[]}>} */
export const RSS_FEEDS = [
  // --- vendor: 公式ブログ・リリース ---
  { source: 'OpenAI', category: 'vendor', urls: ['https://openai.com/news/rss.xml'] },
  { source: 'Google AI', category: 'vendor', urls: ['https://blog.google/technology/ai/rss/'] },
  { source: 'Google Cloud Blog', category: 'vendor', urls: ['https://cloudblog.withgoogle.com/rss/'] },
  { source: 'Hugging Face Blog', category: 'vendor', urls: ['https://huggingface.co/blog/feed.xml'] },
  // Anthropic は公式 RSS 未提供のため、Claude Code のリリースノートを代替一次ソースとする
  { source: 'Claude Code (Anthropic)', category: 'vendor', urls: ['https://github.com/anthropics/claude-code/releases.atom'] },
  { source: 'Meta Engineering', category: 'vendor', urls: ['https://engineering.fb.com/feed/'] },
  { source: 'AWS Machine Learning Blog', category: 'vendor', urls: ['https://aws.amazon.com/blogs/machine-learning/feed/'] },

  // --- media: 技術メディア ---
  { source: 'TechCrunch AI', category: 'media', urls: ['https://techcrunch.com/category/artificial-intelligence/feed/'] },
  { source: 'The Verge AI', category: 'media', urls: ['https://www.theverge.com/rss/ai-artificial-intelligence/index.xml'] },
  { source: 'Ars Technica', category: 'media', urls: ['https://feeds.arstechnica.com/arstechnica/technology-lab'] },
  { source: 'MIT Technology Review AI', category: 'media', urls: ['https://www.technologyreview.com/topic/artificial-intelligence/feed'] },
  { source: 'Lobsters (ai tag)', category: 'media', urls: ['https://lobste.rs/t/ai.rss'] },
  // 独立系ブログ・ニュースレター（実際に試した知見や分析。2026-10-20 実疎通確認・直近1週間内に更新あり）
  { source: 'Simon Willison', category: 'media', urls: ['https://simonwillison.net/atom/everything/'] },
  { source: 'Latent Space', category: 'media', urls: ['https://www.latent.space/feed'] },
  { source: 'Interconnects', category: 'media', urls: ['https://www.interconnects.ai/feed'] },
  { source: 'Import AI', category: 'media', urls: ['https://importai.substack.com/feed'] },

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
