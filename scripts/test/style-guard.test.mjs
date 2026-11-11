import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBannedExpressions, findChineseOnlyTerms } from '../lib/style-guard.mjs';

test('findBannedExpressions: 問題ない文章は空配列', () => {
  const text = '送迎ルートの組み立てには時間がかかります。以下の手順で効率化できます。';
  assert.deepEqual(findBannedExpressions(text), []);
});

test('findBannedExpressions: 絵文字を検出する', () => {
  const found = findBannedExpressions('送迎ルートを効率化しましょう🚗✨');
  assert.ok(found.includes('🚗'));
  assert.ok(found.includes('✨'));
});

test('findBannedExpressions: 定型の締めくくり表現を検出する', () => {
  const found = findBannedExpressions('いかがでしたか？ぜひ試してみてください。');
  assert.ok(found.includes('いかがでしたか'));
});

test('findBannedExpressions: 誇張表現を検出する', () => {
  const found = findBannedExpressions('この方法は革命的で、業務が劇的に変わります。');
  assert.ok(found.includes('革命的'));
  assert.ok(found.includes('劇的に'));
});

test('findBannedExpressions: 内容のない一般見出しを検出する', () => {
  const found = findBannedExpressions('## まとめ\n\n本文です。');
  assert.ok(found.some((f) => f.includes('まとめ')));
});

test('findBannedExpressions: 具体的な見出しは検出しない', () => {
  const found = findBannedExpressions('## 手順\n\n本文です。');
  assert.deepEqual(found, []);
});

test('findBannedExpressions: 複数の問題を同時に検出する', () => {
  const found = findBannedExpressions('革命的な方法です🎉 いかがでしたか。');
  assert.ok(found.length >= 3);
});

test('findChineseOnlyTerms: 日本語の字形に直された中国語の熟語を検出する（開箱即用）', () => {
  const found = findChineseOnlyTerms('導入後すぐに使える開箱即用の仕組みを備えている。');
  assert.deepEqual(found, ['開箱']);
});

test('findChineseOnlyTerms: 複数の熟語を重複なく検出する', () => {
  const found = findChineseOnlyTerms('開源の軟體で、開箱も開箱即用も可能。');
  assert.deepEqual(found.sort(), ['開源', '開箱', '軟體'].sort());
});

test('findChineseOnlyTerms: 通常の日本語は検出しない（空・境界）', () => {
  assert.deepEqual(findChineseOnlyTerms(''), []);
  assert.deepEqual(findChineseOnlyTerms('オープンソースのソフトウェアを開封してすぐ使える。開発・開始・開く'), []);
});
