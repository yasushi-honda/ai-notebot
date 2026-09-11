import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLiteralNewlines, evaluateStageBCitations, decideStageBRetry } from '../curate.mjs';

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

// evaluateStageBCitations: 2026-09-10 scheduled run実績（裏取り率97%で公開ブロック）の
// 再発防止として追加した、Stage B生成結果の再生成トリガー用チェック。
// validate-citations.mjsが最終ゲートで弾く条件と同じ観点を生成直後に検出できることを確認する。
test('evaluateStageBCitations: 全文に脚注があれば問題なし', () => {
  const body = '導入の一文です[^s-aaa]。詳細の一文です[^s-bbb]。';
  assert.deepEqual(evaluateStageBCitations(body, new Set(['s-aaa', 's-bbb'])), []);
});

test('evaluateStageBCitations: 脚注のない文（導入文の書き忘れ等）を検出する', () => {
  const body = '具体的には以下のようなリポジトリが関心を集めています。詳細の一文です[^s-aaa]。';
  const problems = evaluateStageBCitations(body, new Set(['s-aaa']));
  assert.ok(problems.some((p) => p.includes('脚注のない文')));
});

test('evaluateStageBCitations: そのテーマに与えられていないidを引用していれば検出する', () => {
  const body = '一文です[^s-deadbeef01]。';
  const problems = evaluateStageBCitations(body, new Set(['s-aaa']));
  assert.ok(problems.some((p) => p.includes('与えられていないid')));
});

test('evaluateStageBCitations: 不正な脚注表記（カンマ区切りの複数id詰め込み）を検出する', () => {
  const body = '一文です[^s-aaa, s-bbb]。';
  const problems = evaluateStageBCitations(body, new Set(['s-aaa', 's-bbb']));
  assert.ok(problems.some((p) => p.includes('不正な脚注表記')));
});

test('evaluateStageBCitations: 脚注が1件もなければ検出する', () => {
  const body = '脚注の無い一文です。';
  const problems = evaluateStageBCitations(body, new Set(['s-aaa']));
  assert.ok(problems.some((p) => p.includes('脚注が1件もありません')));
});

// codex reviewで指摘・修正の回帰テスト: 本文断片にMarkdownの水平線（---）が含まれると、
// checkCitationsがbodyOnly未指定だとfrontmatter区切りと誤認識し、それより前の無出典文を
// 見逃してしまう（citation-gate.test.mjs参照）。evaluateStageBCitationsは内部でbodyOnly:trueを
// 渡すことで、この見逃しを防いでいることを確認する。
test('evaluateStageBCitations: 本文中にMarkdown水平線（---）があっても前半の無出典文を見逃さない', () => {
  const body = '最初の無出典文です。\n\n---\n\n後半の一文です[^s-aaa]。';
  const problems = evaluateStageBCitations(body, new Set(['s-aaa']));
  assert.ok(problems.some((p) => p.includes('脚注のない文')));
});

// decideStageBRetry: runStageBの再生成ループ本体はgenerateText（Vertex AI実API呼び出し）を
// 含みネットワーク依存で単体テストできないため、意思決定部分（accept/retry/exhausted）だけを
// 切り出してテストする（pr-review-toolkitのテストカバレッジレビューで指摘: 最大試行回数への
// 到達判定・extraInstructionsの累積というこのPRの核心部分が無テストだった）。
test('decideStageBRetry: 問題が無ければacceptする', () => {
  const decision = decideStageBRetry({ attempt: 1, maxAttempts: 3, problems: [], extraInstructions: [] });
  assert.deepEqual(decision, { action: 'accept' });
});

test('decideStageBRetry: 問題があり最大試行回数未満ならretryし、extraInstructionsを累積する', () => {
  const decision = decideStageBRetry({
    attempt: 1,
    maxAttempts: 3,
    problems: ['問題A'],
    extraInstructions: ['既存の指示'],
  });
  assert.equal(decision.action, 'retry');
  assert.deepEqual(decision.extraInstructions, ['既存の指示', '問題A']);
});

test('decideStageBRetry: extraInstructionsの累積は重複を排除する', () => {
  const decision = decideStageBRetry({
    attempt: 1,
    maxAttempts: 3,
    problems: ['同じ問題', '新しい問題'],
    extraInstructions: ['同じ問題'],
  });
  assert.deepEqual(decision.extraInstructions, ['同じ問題', '新しい問題']);
});

test('decideStageBRetry: 問題があり最大試行回数に達していればexhaustedになる（境界値: ちょうど到達）', () => {
  const decision = decideStageBRetry({ attempt: 3, maxAttempts: 3, problems: ['問題A'], extraInstructions: [] });
  assert.deepEqual(decision, { action: 'exhausted' });
});

test('decideStageBRetry: 問題が無ければ最大試行回数に達していてもacceptが優先される', () => {
  const decision = decideStageBRetry({ attempt: 3, maxAttempts: 3, problems: [], extraInstructions: [] });
  assert.deepEqual(decision, { action: 'accept' });
});
