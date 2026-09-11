/**
 * 出典URLのドメインを「official（公的機関・ベンダー公式ドキュメント）」か
 * 「web（その他の一般ウェブページ）」かに分類する純関数。
 * 介護版記事（collect-care.mjs）の受け入れ基準（公式ドメイン1件以上）判定に使う。
 */

// 官公庁・自治体ドメインのサフィックス（完全一致ではなくサブドメイン許容のため末尾一致で判定）
const OFFICIAL_SUFFIXES = ['.go.jp', '.lg.jp', '.gov'];

// 上記サフィックスに当てはまらないが、公式のベンダードキュメント・制度解説として
// 信頼できると明示的に許可したドメイン一覧（ホワイトリスト方式。安易に広げない）。
const OFFICIAL_ALLOWLIST = new Set([
  'support.google.com',
  'workspace.google.com',
  'learn.microsoft.com',
  'support.microsoft.com',
  'www.kaigokensaku.mhlw.go.jp',
  'www.wam.go.jp',
]);

/**
 * @param {string} url
 * @returns {'official' | 'web'}
 */
export function classifySourceTier(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return 'web';
  }

  if (OFFICIAL_ALLOWLIST.has(hostname)) return 'official';
  if (OFFICIAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return 'official';
  return 'web';
}
