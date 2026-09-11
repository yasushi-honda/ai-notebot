import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeXml, buildStepsSvg } from '../lib/care-svg.mjs';

test('escapeXml: & < > " \' をエスケープする', () => {
  assert.equal(escapeXml('A & B < C > D " E \' F'), 'A &amp; B &lt; C &gt; D &quot; E &apos; F');
});

test('buildStepsSvg: 有効なSVGを返す（ルート要素・viewBox）', () => {
  const svg = buildStepsSvg(['利用者の住所を一覧にする', '地図サービスに貼り付ける', '出力順を確認する']);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /<\/svg>\s*$/);
});

test('buildStepsSvg: ステップ数に応じて矢印の数が変わる（n-1本）', () => {
  const svg = buildStepsSvg(['step1', 'step2', 'step3', 'step4']);
  const arrowCount = (svg.match(/marker-end="url\(#arrowhead\)"/g) || []).length;
  assert.equal(arrowCount, 3);
});

test('buildStepsSvg: ステップのテキストに特殊文字が含まれてもXMLとして壊れない', () => {
  const svg = buildStepsSvg(['<script>alert(1)</script>', 'A & B']);
  assert.ok(!svg.includes('<script>alert(1)</script>'));
  assert.match(svg, /&amp; B|&amp;B/);
});

test('buildStepsSvg: 空配列はエラーを投げる', () => {
  assert.throws(() => buildStepsSvg([]));
});

test('buildStepsSvg: 長いステップ文言は3行に折り返され末尾が省略される', () => {
  const svg = buildStepsSvg(['あ'.repeat(100)]);
  assert.match(svg, /…/);
});
