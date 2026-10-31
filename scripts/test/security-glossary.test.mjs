import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECURITY_TERMS, findGlossaryTerms, MAX_SOURCES_PER_TERM } from '../lib/security-glossary.mjs';
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

test('非同義の語は拾わない（DoS≠DDoS、サプライチェーンの可視化≠サプライチェーン攻撃）', () => {
  assert.deepEqual(findGlossaryTerms('単一の要求でDoS攻撃が可能[^s-aaaaaaaaaa]。', valid), []);
  assert.deepEqual(findGlossaryTerms('サプライチェーンの可視化を改善[^s-aaaaaaaaaa]。', valid), []);
});

const termsOf = (body) => findGlossaryTerms(body, valid).map((t) => t.term);

test('脚注は語が出てくる文のものだけを使う（同じ行の別の文の脚注は使わない）', () => {
  const body = 'ランサムウェアで業務が止まった[^s-aaaaaaaaaa]。二段階認証を導入した[^s-bbbbbbbbbb]。';
  const byTerm = Object.fromEntries(findGlossaryTerms(body, valid).map((t) => [t.term, t.sourceIds]));
  assert.deepEqual(byTerm['ランサムウェア'], ['s-aaaaaaaaaa']);
  assert.deepEqual(byTerm['二段階認証'], ['s-bbbbbbbbbb']);
});

test('同じ語が複数の文にあれば id を集め、重複は除き、有効でない id は落とし、上限で切る', () => {
  const ids = new Set(['s-aaaaaaaaaa', 's-bbbbbbbbbb', 's-cccccccccc']);
  const body = 'マルウェアを確認[^s-aaaaaaaaaa][^s-aaaaaaaaaa]。\nマルウェアが拡散[^s-bbbbbbbbbb][^s-zzzzzzzzzz]。マルウェアの亜種[^s-cccccccccc]。';
  const [hit] = findGlossaryTerms(body, ids);
  assert.equal(MAX_SOURCES_PER_TERM, 2);
  assert.deepEqual(hit.sourceIds, ['s-aaaaaaaaaa', 's-bbbbbbbbbb']);
});

test('脚注 id の文字列そのものには反応しない（CVE 相当の並びを含む id）', () => {
  assert.deepEqual(termsOf('更新が公開された[^s-cve0000000]。'), []);
});

test('表記ゆれ: 全角・大文字小文字・ハイフン・CVE 番号', () => {
  assert.ok(termsOf('ＤＤｏＳ攻撃が発生[^s-aaaaaaaaaa]。').includes('DDoS攻撃'));
  assert.ok(termsOf('zero-day が悪用[^s-aaaaaaaaaa]。').includes('ゼロデイ'));
  assert.ok(termsOf('CVE-2026-1234 が公開[^s-aaaaaaaaaa]。').includes('CVE'));
});

test('APT は大文字だけに反応する（apt install や adapt は拾わない）', () => {
  assert.ok(termsOf('APT による攻撃[^s-aaaaaaaaaa]。').includes('APT'));
  assert.deepEqual(termsOf('apt install でパッケージを入れた[^s-aaaaaaaaaa]。'), []);
});

test('曖昧・非同義の別表記は拾わない（任意コード実行、脱獄、jailbreak）', () => {
  assert.ok(!termsOf('任意のコード実行が可能[^s-aaaaaaaaaa]。').includes('リモートコード実行'));
  assert.deepEqual(termsOf('iPhone を脱獄するツール[^s-aaaaaaaaaa]。'), []);
  assert.ok(!termsOf('二段階認証を導入[^s-aaaaaaaaaa]。').includes('二要素認証'));
});

test('他の用語の一部になっている語は長い方だけ（ボイスフィッシングならフィッシングは出さない）', () => {
  const got = termsOf('ボイスフィッシングの被害[^s-aaaaaaaaaa]。');
  assert.ok(got.includes('ボイスフィッシング'));
  assert.ok(!got.includes('フィッシング'));
  assert.ok(!termsOf('クレデンシャルスタッフィングを確認[^s-aaaaaaaaaa]。').includes('認証情報'));
});

test('読み: プロンプトインジェクション', () => {
  assert.equal(SECURITY_TERMS.find((e) => e.term === 'プロンプトインジェクション').reading, 'ぷろんぷといんじぇくしょん');
});
