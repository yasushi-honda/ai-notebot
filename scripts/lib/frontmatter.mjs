/**
 * curate.mjs が生成する frontmatter 専用の軽量パーサ。
 * 汎用 YAML ではなく、curate.mjs の出力形式（1行の JSON 文字列 / JSON 配列 / インデント付きリスト）
 * のみをサポートする。依存パッケージを増やさないための最小実装。
 * Astro 側のビルドは別途 Astro 自身の frontmatter パーサ（content collections）を使うため無関係。
 */

/**
 * @param {string} markdown
 * @returns {{frontmatter: Record<string, unknown>, body: string}}
 */
export function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: markdown };

  const [, fmBlock, body] = match;
  const lines = fmBlock.split('\n');
  const frontmatter = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) {
      i++;
      continue;
    }
    const [, key, rest] = kv;
    if (rest.trim() === '') {
      // ブロックリスト形式（次行以降の "  - "..." "）
      const list = [];
      let j = i + 1;
      while (j < lines.length && /^\s+-\s+/.test(lines[j])) {
        const itemStr = lines[j].replace(/^\s+-\s+/, '');
        try {
          list.push(JSON.parse(itemStr));
        } catch {
          list.push(itemStr);
        }
        j++;
      }
      frontmatter[key] = list;
      i = j;
      continue;
    }
    try {
      frontmatter[key] = JSON.parse(rest);
    } catch {
      frontmatter[key] = rest;
    }
    i++;
  }
  return { frontmatter, body };
}
