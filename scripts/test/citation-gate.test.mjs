import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripCodeSpans } from '../lib/citation-gate.mjs';

// remark-gfmはコードスパン内で脚注参照構文を解釈せずリテラル表示するため、
// 見た目だけの「引用」を本物の引用として誤カウントしないための前処理（codex reviewで指摘・修正）
test('stripCodeSpans: インラインコードスパン（`...`）を除去する', () => {
  const input = '本文です`[^s-aaaaaaaaaa]`。';
  assert.equal(stripCodeSpans(input), '本文です。');
});

test('stripCodeSpans: フェンス付きコードブロック（```...```）を除去する', () => {
  const input = '本文です。\n```\n[^s-aaaaaaaaaa]\n```\n続きの本文です。';
  const result = stripCodeSpans(input);
  assert.ok(!result.includes('[^s-aaaaaaaaaa]'));
});

test('stripCodeSpans: コードスパンでない通常の脚注は除去しない', () => {
  const input = '本文です[^s-aaaaaaaaaa]。';
  assert.equal(stripCodeSpans(input), input);
});

test('stripCodeSpans: 複数のコードスパンをそれぞれ除去する', () => {
  const input = '`一つ目`のテキストと`二つ目`のテキスト';
  assert.equal(stripCodeSpans(input), 'のテキストとのテキスト');
});

// 2連続以上のバッククォート（``...``）はCommonMark上も正当なコードスパン構文だが、
// 単一バッククォート固定の正規表現では検出できず、見た目だけの脚注を取りこぼしていた
// （codex reviewで指摘・修正）
test('stripCodeSpans: 2連続バッククォート（``...``）で囲まれたコードスパンも除去する', () => {
  const input = '本文です``[^s-aaaaaaaaaa]``。';
  assert.equal(stripCodeSpans(input), '本文です。');
});

test('stripCodeSpans: HTMLコメント（<!--...-->）を除去する', () => {
  const input = '本文です<!-- [^s-aaaaaaaaaa] -->。';
  assert.equal(stripCodeSpans(input), '本文です。');
});

// ~~~ はCommonMark上バッククォートと並ぶ正当なフェンス区切り文字だが、当初はバッククォート
// フェンスしか除去できておらず見た目だけの脚注を取りこぼしていた（codex reviewで指摘・修正）
test('stripCodeSpans: チルダのフェンス付きコードブロック（~~~...~~~）を除去する', () => {
  const input = '本文です。\n~~~\n偽の本文[^s-aaaaaaaaaa]。\n~~~\n続きの本文です。';
  const result = stripCodeSpans(input);
  assert.ok(!result.includes('[^s-aaaaaaaaaa]'));
});

// 内部に開始より短い連続のバッククォートを含むコードスパン（例: ``a`b``）はCommonMark上
// 正当な構文だが、「内部にバッククォートを含めば除去しない」という誤った安全側判定により
// まさにこのケースの見た目だけの脚注を取りこぼしていた（codex reviewで指摘・修正）
test('stripCodeSpans: 内部に単独バッククォートを含む2連続コードスパンも除去する', () => {
  const input = '``[^s-aaaaaaaaaa] ` literal``本文です。';
  const result = stripCodeSpans(input);
  assert.ok(!result.includes('[^s-aaaaaaaaaa]'));
});

test('stripCodeSpans: 4連続バッククォートの中の短い連続はコードスパン境界にならない', () => {
  const input = 'a````[^s-aaaaaaaaaa]````b';
  const result = stripCodeSpans(input);
  assert.ok(!result.includes('[^s-aaaaaaaaaa]'));
});
