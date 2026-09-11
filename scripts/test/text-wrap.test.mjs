import { test } from 'node:test';
import assert from 'node:assert/strict';

import { wrapJapaneseText } from '../lib/text-wrap.mjs';

test('wrapJapaneseText: カタカナ連続（外来語）の途中では改行しない', () => {
  // 「音声認識ツール」が「音声認識ツ」/「ール」のように割れないことを確認する
  // （実際の本番SVGで発生し、ユーザーから指摘された回帰: 2026-09-11）
  const text = 'スマートフォンや汎用の音声認識ツールを利用して、会議の要点やメモを音声入力でテキスト化する';
  const lines = wrapJapaneseText(text, 16, 3);
  const joined = lines.join('');
  assert.ok(!joined.includes('ツ\nール') && lines.every((l) => !l.endsWith('ツ')));
  assert.ok(lines.every((l) => !/^ール/.test(l)));
});

test('wrapJapaneseText: 行頭に句読点・閉じ括弧が来ない（禁則処理）', () => {
  const text = 'これはテスト用の文章です。次の行に句点が来ないことを確認します。';
  const lines = wrapJapaneseText(text, 10, 5);
  for (const line of lines.slice(1)) {
    assert.notEqual(line[0], '。');
    assert.notEqual(line[0], '、');
  }
});

test('wrapJapaneseText: maxLines を超える場合は末尾を … にする', () => {
  const text = 'あ'.repeat(50);
  const lines = wrapJapaneseText(text, 10, 3);
  assert.equal(lines.length, 3);
  assert.ok(lines[2].endsWith('…'));
});

test('wrapJapaneseText: charsPerLineの半分以下しか残らない場合はカタカナ途中でも戻さない', () => {
  // 戻しすぎて極端に短い行ができることを避ける安全弁の確認
  const text = 'ア'.repeat(20);
  const lines = wrapJapaneseText(text, 8, 5);
  assert.ok(lines.every((l) => l.replace('…', '').length > 0));
});

test('wrapJapaneseText: 短い文はそのまま1行になる', () => {
  const lines = wrapJapaneseText('短い文', 16, 3);
  assert.deepEqual(lines, ['短い文']);
});
