import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLiteralNewlines } from '../curate.mjs';

test('normalizeLiteralNewlines: リテラルな \\n を実際の改行に変換する', () => {
  const input = '1段落目です。\\n\\n2段落目です。';
  const output = normalizeLiteralNewlines(input);
  assert.equal(output, '1段落目です。\n\n2段落目です。');
  assert.ok(!output.includes('\\n'), 'リテラルな\\nが残っている');
});

test('normalizeLiteralNewlines: 実際の改行はそのまま維持する（二重変換しない）', () => {
  const input = '1段落目です。\n\n2段落目です。';
  assert.equal(normalizeLiteralNewlines(input), input);
});

test('normalizeLiteralNewlines: リテラルな\\nが無い通常の文章はそのまま返す', () => {
  const input = '通常の一文です[^s-aaa]。';
  assert.equal(normalizeLiteralNewlines(input), input);
});
