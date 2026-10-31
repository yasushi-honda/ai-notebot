import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGlossary, groupByRow, kanaRow, OTHER_ROW, normalizeQuery, searchKey, matchesQuery, rowCounts } from '../../site/src/lib/glossary.mjs';

const e = (term, reading, definition = `${term}の定義`) => ({ term, reading, definition, sourceIds: ['s-aaaaaaaaaa'] });

test('kanaRow: ひらがな・カタカナ・濁音・半濁音・小書きを五十音の行にまとめる', () => {
  assert.equal(kanaRow('ぶろとり'), 'は'); // ぶ → ふ → は行
  assert.equal(kanaRow('ブロトリ'), 'は');
  assert.equal(kanaRow('ぱすわーど'), 'は');
  assert.equal(kanaRow('ぜいじゃくせい'), 'さ');
  assert.equal(kanaRow('ッ'), 'た'); // 小書きの っ → つ → た行
  assert.equal(kanaRow('ぁ'), 'あ');
  assert.equal(kanaRow('をん'), 'わ');
  assert.equal(kanaRow('ー'), OTHER_ROW);
  assert.equal(kanaRow(''), OTHER_ROW);
  assert.equal(kanaRow(undefined), OTHER_ROW);
});

test('buildGlossary: 同じ用語は最も新しい記事の定義を採用し、全角・大文字小文字の違いは同一視する', () => {
  const out = buildGlossary([
    { date: '2026-10-28', glossary: [e('Brotli', 'ぶろとり', '古い定義')] },
    { date: '2026-10-29', glossary: [e('ＢＲＯＴＬＩ', 'ぶろとり', '新しい定義')] },
    { date: '2026-10-27', glossary: [e('brotli', 'ぶろとり', 'さらに古い定義')] },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].definition, '新しい定義');
  assert.equal(out[0].date, '2026-10-29');
});

test('buildGlossary: glossary の無い記事（旧記事・用語0件）があっても落ちない。行→読み順に並ぶ', () => {
  const out = buildGlossary([
    { date: '2026-10-29' },
    { date: '2026-10-28', glossary: [] },
    { date: '2026-10-27', glossary: [e('ランサムウェア', 'らんさむうぇあ'), e('脆弱性', 'ぜいじゃくせい'), e('MFA', 'えむえふえー')] },
  ]);
  assert.deepEqual(out.map((x) => x.term), ['MFA', '脆弱性', 'ランサムウェア']);
  assert.deepEqual(buildGlossary([]), []);
});

test('groupByRow: 行ごとにまとめ、用語のある行だけを五十音順で返す', () => {
  const groups = groupByRow(buildGlossary([{ date: '2026-10-29', glossary: [e('脆弱性', 'ぜいじゃくせい'), e('MFA', 'えむえふえー'), e('記号', '＊')] }]));
  assert.deepEqual(groups.map((g) => g.row), ['あ', 'さ', OTHER_ROW]);
  assert.equal(groups[1].entries[0].term, '脆弱性');
});

test('normalizeQuery: 全角半角・大文字小文字・カタカナ/ひらがな・余分な空白を吸収する', () => {
  assert.equal(normalizeQuery('  ＤＤｏＳ　攻撃 '), 'ddos 攻撃');
  assert.equal(normalizeQuery('ランサムウェア'), 'らんさむうぇあ');
  assert.equal(normalizeQuery(undefined), '');
});

test('matchesQuery: 用語・読み・定義のどれでも当たり、空白区切りはAND、空の検索語は全件一致', () => {
  const key = searchKey({ term: 'ランサムウェア', reading: 'らんさむうぇあ', definition: 'データを暗号化して金銭を要求する' });
  assert.ok(matchesQuery(key, 'ランサム')); // カタカナの用語
  assert.ok(matchesQuery(key, 'らんさむ')); // 読み
  assert.ok(matchesQuery(key, '暗号化'));   // 定義
  assert.ok(matchesQuery(key, 'ランサム 金銭')); // AND
  assert.ok(!matchesQuery(key, 'ランサム フィッシング'));
  assert.ok(matchesQuery(key, ''));
  assert.ok(matchesQuery(key, '   '));
  assert.ok(!matchesQuery(key, 'zzz'));
});

test('matchesQuery: 英字の用語は大文字小文字・全角を問わず当たる', () => {
  const key = searchKey({ term: 'DDoS攻撃', reading: 'でぃーでぃーおーえすこうげき', definition: '大量の通信を送りつける' });
  assert.ok(matchesQuery(key, 'ddos'));
  assert.ok(matchesQuery(key, 'ＤＤＯＳ'));
});

test('rowCounts: 語の無い行も0件で含み、五十音順（その他が最後）', () => {
  const entries = buildGlossary([{ date: '2026-10-01', glossary: [e('A', 'あ'), e('B', 'あい'), e('C', 'か')] }]);
  const counts = rowCounts(entries);
  assert.deepEqual(counts.map((c) => c.row), ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ', OTHER_ROW]);
  assert.equal(counts[0].count, 2);
  assert.equal(counts[1].count, 1);
  assert.equal(counts[2].count, 0);
  assert.equal(counts.reduce((n, c) => n + c.count, 0), entries.length);
});
