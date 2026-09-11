import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBannedExpressions } from '../lib/style-guard.mjs';

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
