import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGlossary, groupByRow, kanaRow, OTHER_ROW } from '../../site/src/lib/glossary.mjs';

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
