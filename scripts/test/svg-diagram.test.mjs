import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOverviewSvg, escapeXml } from '../lib/svg-diagram.mjs';

test('escapeXml: & < > " \' をエスケープする', () => {
  assert.equal(escapeXml('A & B <C> "D" \'E\''), 'A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;');
});

test('buildOverviewSvg: 有効なSVGを返す（ルート要素・viewBox）', () => {
  const svg = buildOverviewSvg([{ title: 'テーマ1' }, { title: 'テーマ2' }, { title: 'テーマ3' }]);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1200 260"/);
  assert.match(svg, /<\/svg>\s*$/);
});

test('buildOverviewSvg: テーマ数（3〜5）に応じてカード数が変わる', () => {
  for (const n of [3, 4, 5]) {
    const themes = Array.from({ length: n }, (_, i) => ({ title: `テーマ${i + 1}` }));
    const svg = buildOverviewSvg(themes);
    const badgeCount = (svg.match(/<circle /g) ?? []).length;
    assert.equal(badgeCount, n);
  }
});

test('buildOverviewSvg: テーマ見出しに特殊文字が含まれてもXMLとして壊れない（エスケープ済み）', () => {
  const svg = buildOverviewSvg([{ title: 'A&B<script>' }, { title: 'テーマ2' }, { title: 'テーマ3' }]);
  // 折り返しで複数tspanに分かれても、生の "&" "<" ">" が単独で残っていないこと
  // （エスケープ済みの &amp; &lt; &gt; は除外してチェックする）
  const withoutEntities = svg.replace(/&(amp|lt|gt|quot|apos);/g, '');
  assert.ok(!withoutEntities.includes('&'), '未エスケープの & が残っている');
  assert.ok(!/<script/.test(svg.replace(/&lt;script/g, '')), '未エスケープの <script が残っている');
  assert.match(svg, /&amp;/);
  assert.match(svg, /&lt;/);
  assert.match(svg, /&gt;/);
});

test('buildOverviewSvg: 空配列はエラーを投げる', () => {
  assert.throws(() => buildOverviewSvg([]));
});

test('buildOverviewSvg: 長いテーマ見出しは3行に折り返され末尾が省略される', () => {
  const longTitle = 'あ'.repeat(50);
  const svg = buildOverviewSvg([{ title: longTitle }, { title: 'テーマ2' }, { title: 'テーマ3' }]);
  // 最初のカードのtspan数が3であること（MAX_LINES=3）
  const firstTextBlock = svg.split('<text')[2]; // 0:なし, 1:badge番号, 2:テーマ1見出し
  const tspanCount = (firstTextBlock.match(/<tspan/g) ?? []).length;
  assert.equal(tspanCount, 3);
  assert.match(firstTextBlock, /…/);
});
