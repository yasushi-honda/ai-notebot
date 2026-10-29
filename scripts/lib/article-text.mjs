/**
 * セキュリティ系サイト（JPCERT/CC・IPA・JVN 等）の記事ページから、本文に近いテキストを抜き出す。
 * source-resolver.mjs の extractArticleText は <p> だけを集めるため、本文を <br> 区切りの素のテキストや
 * <li>・表で組むサイトでは、ナビゲーションやフッターの文言を拾ってしまう（JPCERT の注意喚起で確認）。
 *
 * 1. <article> / <main> があればその中身全体を本文とする（<br>・ブロック境界は空白に）
 * 2. 無ければ p/li/dt/dd/td/th/見出し/pre を文書順に集め、リンクだけの項目（メニュー）を落とす
 * 3. 長い場合は、冒頭に加えて「対策」節を優先して残す（対策を書く節は文書の後半にあることが多いため）
 */

const BLOCK_TAGS = 'p|li|dt|dd|td|th|h[1-6]|pre';
const MIN_NON_LINK_CHARS = 12;
const MIN_MAIN_CHARS = 200;
const HEAD_CHARS = 700;
const REMEDIATION_PATTERN =
  /(?:^|\s)(?:[IVX]+\.\s*|\d+[.．]\s*)?(?:対策|対処|対応策|回避策|緩和策|推奨事項|推奨される|ワークアラウンド|Mitigations?|Recommendations?|Workarounds?|Remediation|Solutions?)/;

function decodeBasicEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function toPlainText(fragment) {
  // rss.mjs の stripTags は要約用に400字で切るため使わない
  const noTags = fragment
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|li|h[1-6]|div|tr|td|th|dt|dd|pre)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeBasicEntities(noTags).replace(/\s+/g, ' ').trim();
}

function removeNoise(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|nav|header|footer|aside|form|noscript|select|button)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ');
}

function collectBlocks(cleaned) {
  const seen = new Set();
  const parts = [];
  const blockPattern = () => new RegExp(`<(${BLOCK_TAGS})\\b[^>]*>([\\s\\S]*?)</\\1>`, 'gi');

  function visit(fragment) {
    for (const m of fragment.matchAll(blockPattern())) {
      const tag = m[1].toLowerCase();
      const inner = m[2];
      // 入れ子（li の中の p 等）は子ブロックを再帰して拾う（外側を捨てると中身まで失う）
      if (new RegExp(`<(${BLOCK_TAGS})\\b`, 'i').test(inner)) {
        visit(inner);
        continue;
      }
      const nonLink = toPlainText(inner.replace(/<a\b[\s\S]*?<\/a>/gi, ' '));
      // メニュー・パンくず等のリンクだけの項目は落とす。ただし見出しは短くても残す
      // （「対策」「Mitigations」のような短い見出しが、対策節の選択（pickExcerpt）の手がかりになる）
      const isHeading = /^h[1-6]$/.test(tag);
      if (nonLink.length < (isHeading ? 2 : MIN_NON_LINK_CHARS)) continue;
      const text = toPlainText(inner);
      if (seen.has(text)) continue;
      seen.add(text);
      parts.push(text);
    }
  }
  visit(cleaned);
  return parts.join(' ');
}

/**
 * 長い本文から、冒頭＋対策節を maxLength 以内で選ぶ。対策節が見つからなければ冒頭のみ。
 * @param {string} text 空白を畳んだ本文
 * @param {number} maxLength
 */
export function pickExcerpt(text, maxLength) {
  if (text.length <= maxLength) return text;
  const head = text.slice(0, HEAD_CHARS);
  const rest = text.slice(HEAD_CHARS);
  const m = rest.match(REMEDIATION_PATTERN);
  if (!m) return text.slice(0, maxLength);
  const start = HEAD_CHARS + m.index + (m[0].startsWith(' ') ? 1 : 0);
  const room = maxLength - HEAD_CHARS - 3;
  return `${head} … ${text.slice(start, start + room)}`;
}

/**
 * @param {string} html
 * @param {number} [maxLength]
 * @returns {string} 空白を畳んだ本文テキスト。取れなければ空文字
 */
export function extractMainText(html, maxLength = 1500) {
  const cleaned = removeNoise(html);
  const container = cleaned.match(/<(article|main)\b[\s\S]*?<\/\1>/i)?.[0];
  let text = container ? toPlainText(container) : '';
  if (text.length < MIN_MAIN_CHARS) text = collectBlocks(cleaned);
  return pickExcerpt(text, maxLength);
}
