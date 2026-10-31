import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECURITY_TERMS, findGlossaryTerms } from '../lib/security-glossary.mjs';
import { validateTerms } from '../lib/security-article.mjs';

const valid = new Set(['s-aaaaaaaaaa', 's-bbbbbbbbbb']);

test('辞書の全エントリが、用語行として書式検証（長さ・禁止文字・読み）を通る', () => {
  const seen = new Set();
  for (const e of SECURITY_TERMS) {
    assert.ok(!seen.has(e.term), `重複: ${e.term}`);
    seen.add(e.term);
    // validateTerms は出典照合も行うため、出典に term を入れた状態で書式だけを確かめる
    const items = new Map([['s-aaaaaaaaaa', { title: e.term, summary: '' }]]);
    const r = validateTerms([{ ...e, sourceIds: ['s-aaaaaaaaaa'] }], valid, items);
    assert.equal(r.rejected.length, 0, `${e.term}: ${r.rejected[0]?.reason}`);
  }
});

test('本文に出てくる語を、その行の脚注つきで拾う（日本語・英語の別表記とも）', () => {
  const body = ['攻撃者はランサムウェアで業務を止めた[^s-aaaaaaaaaa]。', '', 'Zero-Day の脆弱性が悪用された[^s-bbbbbbbbbb]。'].join('\n');
  const byTerm = Object.fromEntries(findGlossaryTerms(body, valid).map((t) => [t.term, t.sourceIds]));
  assert.deepEqual(byTerm['ランサムウェア'], ['s-aaaaaaaaaa']);
  assert.deepEqual(byTerm['ゼロデイ'], ['s-bbbbbbbbbb']);
  assert.deepEqual(byTerm['脆弱性'], ['s-bbbbbbbbbb']);
});

test('境界: 英字の短い別表記は単語の途中に一致しない（adapt / source）', () => {
  assert.deepEqual(findGlossaryTerms('We adapt the source code[^s-aaaaaaaaaa]。', valid), []);
});

test('異常系: 脚注のない行・対象外の id・空の本文は拾わない', () => {
  assert.deepEqual(findGlossaryTerms('ランサムウェアの被害。', valid), []);
  assert.deepEqual(findGlossaryTerms('ランサムウェア被害[^s-zzzzzzzzzz]。', valid), []);
  assert.deepEqual(findGlossaryTerms('', valid), []);
  assert.deepEqual(findGlossaryTerms(undefined, valid), []);
});

test('AI の「トークン」など、セキュリティ以外の意味がありうる語は辞書に入れない', () => {
  assert.deepEqual(findGlossaryTerms('1Mトークンの入力[^s-aaaaaaaaaa]。', valid), []);
});
