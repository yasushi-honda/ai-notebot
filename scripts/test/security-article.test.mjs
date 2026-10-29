import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateActions,
  validateTerms,
  assembleThemeMarkdown,
  assembleGlossarySection,
  collectDailyTerms,
  actionLine,
  MAX_ACTIONS_PER_THEME,
  MAX_TERMS_PER_THEME,
  MAX_TERMS_PER_DAY,
} from '../lib/security-article.mjs';
import { checkCitations } from '../lib/citation-gate.mjs';
import { findUncitedListItems } from '../lib/digest-curation.mjs';

const valid = new Set(['s-aaaaaaaaaa', 's-bbbbbbbbbb']);
const items = new Map([
  ['s-aaaaaaaaaa', { title: 'Brotli の境界外書き込みの脆弱性', summary: 'Brotli を使うサーバーは更新が必要。' }],
  ['s-bbbbbbbbbb', { title: '別の記事', summary: 'ランサムウェアの被害が増えている。' }],
]);
const action = (over = {}) => ({ who: 'Brotli を使うサーバーの管理者', what: '修正済みのバージョンへ更新してください', condition: '', sourceIds: ['s-aaaaaaaaaa'], ...over });
const term = (over = {}) => ({ term: 'Brotli', reading: 'ぶろとり', definition: 'データを圧縮する方式', sourceIds: ['s-aaaaaaaaaa'], ...over });

test('validateActions: 正常な対策は通り、末尾の句点は落として正規化される', () => {
  const { accepted, rejected } = validateActions([action({ what: '更新してください。' })], valid);
  assert.equal(rejected.length, 0);
  assert.equal(accepted[0].what, '更新してください');
});

test('validateActions: 空・長すぎ・禁止文字・存在しない id・id なしは理由つきで除外される', () => {
  const cases = [
    [action({ who: '' }), /who が空/],
    [action({ what: 'あ'.repeat(91) }), /what が長すぎ/],
    [action({ who: 'あ'.repeat(61) }), /who が長すぎ/],
    [action({ what: '[^s-aaaaaaaaaa] を見る' }), /使えない文字/],
    [action({ condition: '改行\nあり' }), /使えない文字/],
    [action({ what: '<script>を実行' }), /使えない文字/],
    [action({ sourceIds: ['s-ffffffffff'] }), /与えられていない id/],
    [action({ sourceIds: [] }), /sourceIds が空/],
    [action({ who: '株式会社Eストアー' }), /提供元・運営会社側/],
    [action({ who: '運営会社' }), /提供元・運営会社側/],
    [action({ what: '悪用された脆弱性の修正および攻撃経路の遮断' }), /行動の形/],
    [action({ what: '更新してください。その後に確認する' }), /文の区切り/],
    [action({ what: 'Update now. Then reboot してください' }), /文の区切り/],
    [action({ what: '更新してください\\' }), /使えない文字/],
  ];
  for (const [input, pattern] of cases) {
    const { accepted, rejected } = validateActions([input], valid);
    assert.equal(accepted.length, 0, JSON.stringify(input));
    assert.match(rejected[0].reason, pattern);
  }
});

test('validateActions: 「〜を行う」で終わる行動も通る', () => {
  assert.equal(validateActions([action({ what: '認証の追加強化を行う' })], valid).accepted.length, 1);
});

test('validateActions: 読者側にもなりうる「運営者」「開発者」は提供元扱いにしない', () => {
  for (const who of ['PHP を使うウェブサイトの運営者', 'アプリの開発者']) {
    assert.equal(validateActions([action({ who })], valid).accepted.length, 1, who);
  }
});

test('validateTerms: 定義の途中に句点があると除外される（出典ゲートが文を分割して記事全体が失敗するのを防ぐ）', () => {
  const out = validateTerms([term({ definition: 'システムの弱点のこと。悪用されると情報が漏れる' })], valid, items);
  assert.equal(out.accepted.length, 0);
  assert.match(out.rejected[0].reason, /文の区切り/);
});

test('validateActions: 上限件数で切り、配列でない入力は空として扱う', () => {
  const many = Array.from({ length: MAX_ACTIONS_PER_THEME + 2 }, () => action());
  assert.equal(validateActions(many, valid).accepted.length, MAX_ACTIONS_PER_THEME);
  assert.deepEqual(validateActions(undefined, valid), { accepted: [], rejected: [] });
  assert.deepEqual(validateActions('x', valid), { accepted: [], rejected: [] });
});

test('validateTerms: 出典に実在する用語は通る（大文字小文字・全半角を無視して照合）', () => {
  const { accepted } = validateTerms([term({ term: 'ＢＲＯＴＬＩ' })], valid, items);
  assert.equal(accepted.length, 1);
});

test('validateTerms: 本文を渡したときは、本文に出てこない用語を除外する', () => {
  const body = 'Brotli の脆弱性について説明します。';
  assert.equal(validateTerms([term()], valid, items, body).accepted.length, 1);
  const out = validateTerms([term({ term: '脆弱性' }), term({ term: 'ランサムウェア', sourceIds: ['s-bbbbbbbbbb'] })], valid, items, body);
  assert.deepEqual(out.accepted.map((x) => x.term), ['脆弱性']);
  assert.match(out.rejected[0].reason, /記事の本文に出てきません/);
  assert.equal(validateTerms([term()], valid, items).accepted.length, 1); // 本文を渡さなければ従来どおり
});

test('validateTerms: 出典に無い用語・読みの形式違反・存在しない id は除外される', () => {
  const cases = [
    [term({ term: 'ゼロデイ' }), /出典の本文に見当たりません/],
    [term({ reading: 'Brotli' }), /ひらがな以外/],
    [term({ reading: 'ブロトリ' }), /ひらがな以外/],
    [term({ reading: '' }), /reading が空/],
    [term({ sourceIds: ['s-ffffffffff'] }), /与えられていない id/],
    [term({ definition: 'あ'.repeat(121) }), /definition が長すぎ/],
    [term({ sourceIds: ['s-bbbbbbbbbb'] }), /出典の本文に見当たりません/], // 別の出典にしか無い語は、引用した出典に無ければ不可
  ];
  for (const [input, pattern] of cases) {
    const { accepted, rejected } = validateTerms([input], valid, items);
    assert.equal(accepted.length, 0, JSON.stringify(input));
    assert.match(rejected[0].reason, pattern);
  }
  assert.equal(validateTerms(Array(MAX_TERMS_PER_THEME + 2).fill(term()), valid, items).accepted.length, MAX_TERMS_PER_THEME);
});

test('actionLine: 脚注は句点の手前に置く（出典ゲートは句点までを1文とみなす）', () => {
  assert.equal(
    actionLine({ who: '管理者', what: '更新する', condition: '旧版を使っている場合', sourceIds: ['s-aaaaaaaaaa', 's-bbbbbbbbbb'] }),
    '- 旧版を使っている場合、管理者は、更新する[^s-aaaaaaaaaa][^s-bbbbbbbbbb]。',
  );
});

test('assembleThemeMarkdown: 対策があれば見出し付きで空行を挟んで続け、無ければ本文のみ。出典ゲートを通る', () => {
  const body = '本文です[^s-aaaaaaaaaa]。\n\nもう一段落です[^s-aaaaaaaaaa]。';
  assert.equal(assembleThemeMarkdown(body, []), body);
  const md = assembleThemeMarkdown(body, [action(), action({ what: '設定を見直してください', sourceIds: ['s-bbbbbbbbbb'] })]);
  assert.match(md, /\n\n### すぐできる対策\n\n- /);
  const check = checkCitations({ markdown: md, validIds: valid, bodyOnly: true });
  assert.equal(check.ok, true, JSON.stringify(check.uncited));
  assert.deepEqual(findUncitedListItems(md), []);
});

test('findUncitedListItems: 脚注のない箇条書き行を検出する（ゲートが1文扱いして見逃す形）', () => {
  // citation-gate は句点の無い箇条書きを1つの文として扱い、1行にでも脚注があれば通してしまう（codex が再現）
  const loophole = '- 対策A[^s-aaaaaaaaaa]\n- 対策B';
  assert.equal(checkCitations({ markdown: loophole, validIds: valid, bodyOnly: true }).ok, true);
  assert.deepEqual(findUncitedListItems(loophole), ['- 対策B']);
  assert.deepEqual(findUncitedListItems('1. 手順C\n2) 手順D[^s-aaaaaaaaaa]。\n通常の文です。'), ['1. 手順C']);
  assert.deepEqual(findUncitedListItems('- 対策A[^s-aaaaaaaaaa]。\n- 対策B[^s-bbbbbbbbbb]'), []);
});

test('collectDailyTerms / assembleGlossarySection: 重複を除いて上限まで集め、0件なら節を出さない', () => {
  const t = (name) => term({ term: name });
  const out = collectDailyTerms([[t('Brotli'), t('ＢＲＯＴＬＩ')], [t('brotli'), t('A'), t('B')], [t('C'), t('D'), t('E'), t('F'), t('G')]]);
  assert.equal(out.length, MAX_TERMS_PER_DAY);
  assert.equal(out.filter((x) => x.term.toLowerCase() === 'brotli').length, 1);
  assert.equal(assembleGlossarySection([]), null);
  const section = assembleGlossarySection([term()]);
  assert.match(section, /^## 今日の用語\n\n- <strong>Brotli<\/strong>（ぶろとり）：データを圧縮する方式\[\^s-aaaaaaaaaa\]。$/);
  assert.equal(checkCitations({ markdown: section, validIds: valid, bodyOnly: true }).ok, true);
});

import { findUnsafeMarkup, sanitizeThemeTitle } from '../lib/security-article.mjs';
import { buildFootnoteDefs, sanitizeFootnoteTitle, sanitizeFootnoteUrl } from '../lib/digest-curation.mjs';

test('findUnsafeMarkup: <strong> 以外の HTML・画像・リンク・参照定義・URL を検出し、通常の本文と <strong> は通す', () => {
  const safe = '<strong>Cisco</strong> の脆弱性です[^s-aaaaaaaaaa]。\n\n- 更新してください[^s-aaaaaaaaaa]。';
  assert.deepEqual(findUnsafeMarkup(safe), []);
  const cases = [
    ['<img src=x onerror=alert(1)>', /HTML タグ/],
    ['<script>alert(1)</script>', /HTML タグ/],
    ['<a href="https://evil.test">x</a>', /HTML タグ/],
    ['3 < 5 です', /HTML タグ/],
    ['![](https://evil.test/x.png)', /画像/],
    ['[ここ](javascript:alert(1))', /リンクの記法/],
    ['[ref]: https://evil.test', /リンク参照/],
    ['詳しくは https://evil.test を見てください', /URL/],
    ['www.evil.test', /URL/],
    // codex の再現: ラベルに ^ を含む参照リンク定義、引用・リスト内の定義、参照リンクの使用
    ['[注意][a^b][^s-aaaaaaaaaa]。\n\n[a^b]: javascript:alert(1) "[^s-aaaaaaaaaa]"', /リンク参照の定義/],
    ['> [a]: javascript:alert(1)', /リンク参照の定義/],
    ['- [a]: javascript:alert(1)', /リンク参照の定義/],
    ['[ここ][a]', /参照リンクの記法/],
  ];
  for (const [input, pattern] of cases) {
    const problems = findUnsafeMarkup(input);
    assert.ok(problems.some((p) => pattern.test(p)), `${input} → ${problems.join(' / ')}`);
  }
  // 脚注参照 [^s-xxx] はリンク・参照定義として誤検出しない
  assert.deepEqual(findUnsafeMarkup('本文です[^s-aaaaaaaaaa][^s-bbbbbbbbbb]。'), []);
});

test('sanitizeThemeTitle: Markdown のリンク・画像・強調・コードと URL も無害化する（見出しは本文の検査の外で組み立てられる）', () => {
  const evil = sanitizeThemeTitle('[注意](javascript:alert(1)) ![x](https://evil.test/a.png) `code` **強調** https://evil.test/x');
  assert.ok(!/[\[\]()`*<>]/.test(evil), evil);
  assert.ok(!/https?:|evil\.test/.test(evil), evil);
  assert.equal(sanitizeThemeTitle('PHP（8.4）の脆弱性'), 'PHP（8.4）の脆弱性');
});

test('sanitizeThemeTitle: HTML・表の区切り・改行・見出し記号を無害化する', () => {
  assert.equal(sanitizeThemeTitle('<img src=x onerror=1>脆弱性'), '＜img src=x onerror=1＞脆弱性');
  assert.equal(sanitizeThemeTitle('A|B\nC'), 'A B C');
  assert.equal(sanitizeThemeTitle('## 見出し'), '見出し');
});

test('buildFootnoteDefs: 出典タイトルの HTML・リンク記法と、URL の括弧・空白は無害化される（RSS の CDATA で生の <script> が残る）', () => {
  assert.equal(sanitizeFootnoteTitle('A <script>alert(1)</script> [x](javascript:1)'), 'A ＜script＞alert(1)＜/script＞ ［x］(javascript:1)');
  assert.equal(sanitizeFootnoteUrl('https://e.test/a) [x](javascript:alert(1)'), 'https://e.test/a%29%20[x]%28javascript:alert%281%29');
  const defs = buildFootnoteDefs(new Set(['s-aaaaaaaaaa']), new Map([['s-aaaaaaaaaa', {
    title: '<img src=x onerror=alert(1)>', url: 'https://e.test/a) [x](javascript:alert(1)', source: 'S', publishedAt: '2026-10-29T00:00:00Z',
  }]]));
  assert.ok(!/<img|onerror=alert\(1\)>/.test(defs), defs);
  assert.ok(!defs.includes('](javascript:'), defs);
  assert.match(defs, /^\[\^s-aaaaaaaaaa\]: \[＜img src=x onerror=alert\(1\)＞\]\(https:\/\/e\.test\/a%29%20/);
});

import { validateHeadline, assembleHighlightsSection, MAX_HIGHLIGHT_ACTIONS } from '../lib/security-article.mjs';

const headline = (over = {}) => ({ text: 'Brotli の脆弱性が見つかり、更新が必要', sourceIds: ['s-aaaaaaaaaa'], ...over });

test('validateHeadline: 正常な見出し1文は通り、末尾の句点は落とす', () => {
  const r = validateHeadline('Brotli の脆弱性が見つかりました。', ['s-aaaaaaaaaa'], valid);
  assert.equal(r.rejected, null);
  assert.deepEqual(r.accepted, { text: 'Brotli の脆弱性が見つかりました', sourceIds: ['s-aaaaaaaaaa'] });
});

test('validateHeadline: 空・長すぎ・禁止文字・文の区切り・URL・HTML・存在しない id・id なしは理由つきで除外される', () => {
  const cases = [
    ['', ['s-aaaaaaaaaa'], /headline が空/],
    ['あ'.repeat(61), ['s-aaaaaaaaaa'], /headline が長すぎ/],
    ['脚注 [^s-aaaaaaaaaa] を含む', ['s-aaaaaaaaaa'], /使えない文字/],
    ['一文目です。二文目です', ['s-aaaaaaaaaa'], /文の区切り/],
    ['詳細は https://evil.test へ', ['s-aaaaaaaaaa'], /URL/],
    ['<b>強調</b>の見出し', ['s-aaaaaaaaaa'], /使えない文字/],
    ['見出しです', ['s-ffffffffff'], /与えられていない id/],
    ['見出しです', [], /sourceIds が空/],
    [undefined, ['s-aaaaaaaaaa'], /headline が空/],
  ];
  for (const [text, ids, pattern] of cases) {
    const r = validateHeadline(text, ids, valid);
    assert.equal(r.accepted, null, String(text));
    assert.match(r.rejected, pattern);
  }
});

const entry = (title, over = {}) => ({ title, headline: headline(), actions: [], ...over });

test('assembleHighlightsSection: テーマ見出し1文を並べ、検証済みの対策があれば「今日まずやること」を足す。全行が出典ゲートを通る', () => {
  const md = assembleHighlightsSection([
    entry('テーマ甲', { actions: [action(), action({ what: '設定を見直してください' })] }),
    entry('テーマ乙', { headline: headline({ text: '別の出来事', sourceIds: ['s-bbbbbbbbbb'] }), actions: [action({ sourceIds: ['s-bbbbbbbbbb'] })] }),
  ]);
  assert.match(md, /^## 今日のポイント\n\n- <strong>テーマ甲<\/strong>：Brotli の脆弱性が見つかり、更新が必要\[\^s-aaaaaaaaaa\]。\n- <strong>テーマ乙<\/strong>：別の出来事\[\^s-bbbbbbbbbb\]。\n\n### 今日まずやること\n\n- /);
  // 各テーマの先頭1件だけを集める（テーマ甲の2件目は載らない）
  assert.equal((md.match(/\n- (?!<strong>)/g) ?? []).length, 2);
  assert.ok(!md.includes('設定を見直してください'));
  const check = checkCitations({ markdown: md, validIds: valid, bodyOnly: true });
  assert.equal(check.ok, true, JSON.stringify(check.uncited));
  assert.deepEqual(findUncitedListItems(md), []);
});

test('assembleHighlightsSection: 対策が0件なら「今日まずやること」を出さず、見出し1文が1件も無ければパネル自体を出さない', () => {
  const noActions = assembleHighlightsSection([entry('テーマ甲')]);
  assert.ok(noActions.startsWith('## 今日のポイント'));
  assert.ok(!noActions.includes('今日まずやること'));
  assert.equal(assembleHighlightsSection([entry('テーマ甲', { headline: null })]), null);
  assert.equal(assembleHighlightsSection([]), null);
});

test('assembleHighlightsSection: 見出し1文のないテーマはポイントに載せないが、そのテーマの対策は「今日まずやること」に載る', () => {
  const md = assembleHighlightsSection([entry('テーマ甲', { headline: null, actions: [action()] }), entry('テーマ乙')]);
  assert.ok(!md.includes('テーマ甲'));
  assert.match(md, /<strong>テーマ乙<\/strong>/);
  assert.match(md, /### 今日まずやること\n\n- /);
});

test('assembleHighlightsSection: 「今日まずやること」は上限件数まで', () => {
  const many = Array.from({ length: MAX_HIGHLIGHT_ACTIONS + 3 }, (_, i) => entry(`テーマ${i}`, { actions: [action({ what: `対策${i}を行う` })] }));
  const md = assembleHighlightsSection(many);
  assert.equal((md.split('### 今日まずやること')[1].match(/\n- /g) ?? []).length, MAX_HIGHLIGHT_ACTIONS);
});
