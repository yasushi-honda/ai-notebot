import { test } from 'node:test';
import assert from 'node:assert/strict';
import rehypeSecuritySections, { wrapSections, isSecurityArticle } from '../../site/src/lib/rehype-security-sections.mjs';

const text = (value) => ({ type: 'text', value });
const el = (tagName, children = [], properties = {}) => ({ type: 'element', tagName, properties, children });
const h2 = (label) => el('h2', [text(label)]);
const p = (s) => el('p', [text(s)]);
const nl = () => text('\n');

function sampleTree() {
  return {
    type: 'root',
    children: [
      h2('今日のポイント'), nl(), el('ul', [el('li', [text('要点')])]), nl(),
      h2('今日のトピック'), nl(), el('table'), nl(),
      h2('テーマ甲'), nl(), p('本文1'), nl(), el('h3', [text('すぐできる対策')]), nl(), el('ul'), nl(),
      h2('テーマ乙'), nl(), p('本文2'), nl(),
      h2('今日の用語'), nl(), el('ul'), nl(),
      el('section', [h2('この記事の出典'), el('ol')], { dataFootnotes: true, className: ['footnotes'] }),
    ],
  };
}

const sections = (tree) => tree.children.filter((n) => n.type === 'element' && n.tagName === 'section');
const classes = (node) => node.properties.className;

test('wrapSections: h2 ごとに包み、ポイント・テーマ・用語で種類のクラスを付ける', () => {
  const tree = sampleTree();
  wrapSections(tree);
  const wrapped = sections(tree).filter((s) => classes(s).includes('sec'));
  assert.deepEqual(wrapped.map(classes), [
    ['sec', 'sec-point'],
    ['sec', 'sec-theme'],
    ['sec', 'sec-theme'],
    ['sec', 'sec-glossary'],
  ]);
  // 各セクションの先頭は h2、中身（h3・p・ul）は次の h2 の手前まで
  assert.deepEqual(wrapped[1].children.filter((n) => n.type === 'element').map((n) => n.tagName), ['h2', 'p', 'h3', 'ul']);
  assert.deepEqual(wrapped[2].children.filter((n) => n.type === 'element').map((n) => n.tagName), ['h2', 'p']);
});

test('wrapSections: 直後が表の h2（今日のトピック）は包まず、表もそのまま通す。順序は保たれる', () => {
  const tree = sampleTree();
  wrapSections(tree);
  const tags = tree.children.filter((n) => n.type === 'element').map((n) => `${n.tagName}${n.tagName === 'section' ? `.${classes(n).slice(-1)}` : ''}`);
  assert.deepEqual(tags, ['section.sec-point', 'h2', 'table', 'section.sec-theme', 'section.sec-theme', 'section.sec-glossary', 'section.footnotes']);
});

test('wrapSections: 脚注セクションは包まず、最後のカードに取り込まない', () => {
  const tree = sampleTree();
  wrapSections(tree);
  const last = tree.children.filter((n) => n.type === 'element').at(-1);
  assert.equal(last.tagName, 'section');
  assert.ok('dataFootnotes' in last.properties);
  assert.deepEqual(classes(last), ['footnotes']);
  const glossary = sections(tree).find((s) => classes(s).includes('sec-glossary'));
  assert.ok(!JSON.stringify(glossary).includes('この記事の出典'));
});

test('wrapSections: ポイントや用語が無い記事でも壊れない（テーマだけ）', () => {
  const tree = { type: 'root', children: [h2('今日のトピック'), el('table'), h2('テーマ甲'), p('本文')] };
  wrapSections(tree);
  assert.deepEqual(tree.children.filter((n) => n.type === 'element').map((n) => n.tagName), ['h2', 'table', 'section']);
});

test('isSecurityArticle: security の記事だけが対象（パス、または frontmatter の glossary）', () => {
  assert.equal(isSecurityArticle({ path: '/repo/site/src/content/security/2026-10-29.md' }), true);
  assert.equal(isSecurityArticle({ path: 'C:\\repo\\site\\src\\content\\security\\2026-10-29.md' }), true);
  assert.equal(isSecurityArticle({ path: '/repo/x.md', data: { astro: { frontmatter: { glossary: [] } } } }), true);
  assert.equal(isSecurityArticle({ path: '/repo/site/src/content/posts/2026-10-29.md' }), false);
  assert.equal(isSecurityArticle({ path: '/repo/site/src/content/care/2026-10-29.md' }), false);
  assert.equal(isSecurityArticle({}), false);
  assert.equal(isSecurityArticle(undefined), false);
});

test('rehypeSecuritySections: security 以外の記事は木を一切変更しない', () => {
  const tree = sampleTree();
  const before = JSON.stringify(tree);
  rehypeSecuritySections()(tree, { path: '/repo/site/src/content/posts/2026-10-29.md' });
  assert.equal(JSON.stringify(tree), before);
  rehypeSecuritySections()(tree, { path: '/repo/site/src/content/security/2026-10-29.md' });
  assert.notEqual(JSON.stringify(tree), before);
});
