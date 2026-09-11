import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySourceTier } from '../lib/source-tier.mjs';

test('classifySourceTier: go.jp ドメインは official', () => {
  assert.equal(classifySourceTier('https://www.mhlw.go.jp/stf/example.html'), 'official');
});

test('classifySourceTier: lg.jp ドメイン（自治体）は official', () => {
  assert.equal(classifySourceTier('https://www.city.example.lg.jp/kaigo/'), 'official');
});

test('classifySourceTier: 許可リストのベンダードキュメントドメインは official', () => {
  assert.equal(classifySourceTier('https://support.google.com/docs/answer/123'), 'official');
});

test('classifySourceTier: 一般的なニュースサイトは web', () => {
  assert.equal(classifySourceTier('https://example-news.com/article/1'), 'web');
});

test('classifySourceTier: 不正なURLは web（エラーにしない）', () => {
  assert.equal(classifySourceTier('not-a-valid-url'), 'web');
});

test('classifySourceTier: go.jp を含むが末尾一致しないドメインは official と誤判定しない', () => {
  assert.equal(classifySourceTier('https://go.jp.evil-example.com/phishing'), 'web');
});
