import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMainText, pickExcerpt } from '../lib/article-text.mjs';

const filler = (n, ch = 'あ') => ch.repeat(n);

test('extractMainText: <article> があればその中身を本文とし、ナビ・フッター・スクリプトは含めない（JPCERT 型: <br> 区切りの素のテキスト）', () => {
  const html = `<html><head><title>T</title></head><body>
    <header>ヘッダー</header><nav><ul><li><a href="/">メニュー</a></li></ul></nav>
    <article><div class="at">JPCERT-AT-0001<br />概要<br />${filler(250)}<br /><h4>III. 対策</h4>更新してください</div></article>
    <footer>このページは役に立ちましたか？</footer><script>var x=1;</script></body></html>`;
  const text = extractMainText(html, 1500);
  assert.match(text, /JPCERT-AT-0001 概要/);
  assert.match(text, /更新してください/);
  assert.ok(!/ヘッダー|メニュー|役に立ちましたか|var x/.test(text), text);
});

test('extractMainText: article/main が無いページは p/li/表から集め、リンクだけの項目（メニュー）は落とす', () => {
  const html = `<body><ul><li><a href="/a">トップページ</a></li></ul>
    <p>${filler(60)}という事象が確認されています。</p>
    <ul><li>更新プログラムを適用してください（詳細は提供元の情報を参照）</li></ul></body>`;
  const text = extractMainText(html, 1500);
  assert.ok(!text.includes('トップページ'));
  assert.match(text, /という事象が確認されています/);
  assert.match(text, /更新プログラムを適用してください/);
});

test('extractMainText: 入れ子のブロック（li の中の p、td の中の p）の中身を失わない', () => {
  const html = `<body><ul><li><p>${filler(20)}を更新してください。</p></li></ul>
    <table><tr><td><p>${filler(20)}の影響を受けます。</p></td></tr></table></body>`;
  const text = extractMainText(html, 1500);
  assert.match(text, /を更新してください/);
  assert.match(text, /の影響を受けます/);
});

test('extractMainText: 短い見出し（対策）が残り、長い本文でも対策節が抜粋に入る', () => {
  const html = `<body><h2>概要</h2><p>${filler(900)}の事象です。</p><h2>対策</h2><p>修正版へ更新してください。</p></body>`;
  const text = extractMainText(html, 1000);
  assert.ok(text.length <= 1000);
  assert.match(text, /対策 修正版へ更新してください/);
});

test('pickExcerpt: 短ければそのまま、長くて対策節が無ければ冒頭のみ、あれば冒頭＋対策節', () => {
  assert.equal(pickExcerpt('短い', 100), '短い');
  assert.equal(pickExcerpt(filler(2000), 1000).length, 1000);
  const withRemediation = `${filler(1200)} III. 対策 更新してください`;
  const out = pickExcerpt(withRemediation, 1000);
  assert.ok(out.length <= 1000);
  assert.ok(out.startsWith(filler(700)));
  assert.match(out, /III\. 対策 更新してください/);
});
