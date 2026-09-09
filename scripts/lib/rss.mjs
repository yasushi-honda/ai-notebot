/**
 * RSS 2.0 / Atom の最小パーサ。
 * kaifukuhonpo-syllabus/scripts/fetch-news.mjs の parseFeed/decodeEntities/stripTags を移植。
 * 外部依存なし（Node 標準機能のみ）。
 */

const MAX_DESC_CHARS = 400; // LLM に渡す概要の上限（トークン節約）

/** XML エンティティをデコードする。&amp; の置換は最後（先にやると &amp;lt; が二重デコードされる）。 */
export function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .trim();
}

/** block 内から最初にマッチしたタグの中身を返す。 */
export function pick(block, ...tags) {
  for (const tag of tags) {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    if (m) return decodeEntities(m[1]);
  }
  return '';
}

/** HTML タグを落として素のテキストにする（要約の入力用）。 */
export function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DESC_CHARS);
}

/**
 * RSS 2.0 の <item> と Atom の <entry> を最小限にパースする。
 * title・有効な http(s) URL・有効な日付のいずれかが欠けているエントリは除外する
 * （isPermaLink=false な guid など、壊れたリンクを候補に混入させないため）。
 */
export function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  for (const block of blocks) {
    const title = pick(block, 'title');
    let url = pick(block, 'link', 'guid');
    // Atom: <link href="..."/>
    const atomLink = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
    if (atomLink && !/^https?:\/\//.test(url)) url = decodeEntities(atomLink[1]);
    const dateStr = pick(block, 'pubDate', 'published', 'updated', 'dc:date');
    const date = dateStr ? new Date(dateStr) : null;
    const description = stripTags(pick(block, 'description', 'summary', 'content'));
    if (!title || !/^https?:\/\//.test(url) || !date || Number.isNaN(date.getTime())) continue;
    items.push({ title, url, date, description });
  }
  return items;
}

/**
 * 単一フィード定義（複数 URL のフォールバック対応）から取得を試みる。
 * @param {{source: string, urls: string[]}} feed
 * @returns {Promise<Array<{title:string,url:string,date:Date,description:string,source:string}>>}
 */
export async function fetchFeed(feed) {
  for (const url of feed.urls) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'ai-notebot/0.1 (+https://github.com/yasushi-honda/ai-notebot)' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = parseFeed(xml);
      if (items.length > 0) {
        return items.map((i) => ({ ...i, source: feed.source }));
      }
    } catch {
      // このURLは失敗。次のフォールバックURLを試す
      continue;
    }
  }
  return [];
}
