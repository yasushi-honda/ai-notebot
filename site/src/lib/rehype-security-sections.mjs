/**
 * セキュリティ版の記事だけ、h2 ごとに本文を <section class="sec sec-…"> で包む rehype プラグイン。
 * 「今日のポイント」はダークパネル、各テーマは番号付きカード、「今日の用語」は小カードに見せるため、
 * 見出しと本文を1つの要素にまとめる必要がある（CSS だけでは h2 から次の h2 までを包めない）。
 *
 * 本文の Markdown に HTML のラッパーは書かない: 出典ゲート（citation-gate）は HTML のブロック行を
 * 「脚注のない文」として落とすため。ラッパーは描画時にここで付ける。
 *
 * - 対象: security コレクションの記事のみ（パスに /content/security/ を含む、または frontmatter に glossary がある）。
 *   それ以外の Markdown は一切変更しない（このプラグインは全 Markdown に登録される）
 * - 「今日のトピック」のように直後が表の h2 は、サマリーの前置きラベルなので包まない（既存の h2:has(+ table) と同じ扱い）
 * - 脚注セクション（data-footnotes）とその後ろは包まない
 */

const SECTION_KINDS = { 今日のポイント: 'sec-point', 今日の用語: 'sec-glossary' };

function textOf(node) {
  if (node.type === 'text') return node.value;
  return (node.children ?? []).map(textOf).join('');
}

const isElement = (node, tagName) => node.type === 'element' && node.tagName === tagName;
const isFootnotes = (node) => isElement(node, 'section') && node.properties && 'dataFootnotes' in node.properties;

/** 空白だけのテキストを飛ばして、次の要素ノードを返す */
function nextElement(children, index) {
  for (let i = index + 1; i < children.length; i++) {
    if (children[i].type === 'element') return children[i];
    if (children[i].type === 'text' && children[i].value.trim() !== '') return null;
  }
  return null;
}

export function isSecurityArticle(file) {
  const path = String(file?.path ?? '').replace(/\\/g, '/');
  return path.includes('/content/security/') || file?.data?.astro?.frontmatter?.glossary !== undefined;
}

export function wrapSections(tree) {
  const out = [];
  let current = null;
  let inFootnotes = false;

  tree.children.forEach((node, index, all) => {
    if (inFootnotes || isFootnotes(node)) {
      inFootnotes = true;
      current = null;
      out.push(node);
      return;
    }
    if (isElement(node, 'h2')) {
      if (isElement(nextElement(all, index) ?? {}, 'table')) {
        current = null; // 「今日のトピック」等。包まず、直後の表もそのまま通す
        out.push(node);
        return;
      }
      const kind = SECTION_KINDS[textOf(node).trim()] ?? 'sec-theme';
      current = { type: 'element', tagName: 'section', properties: { className: ['sec', kind] }, children: [node] };
      out.push(current);
      return;
    }
    (current ? current.children : out).push(node);
  });

  tree.children = out;
}

export default function rehypeSecuritySections() {
  return (tree, file) => {
    if (isSecurityArticle(file)) wrapSections(tree);
  };
}
