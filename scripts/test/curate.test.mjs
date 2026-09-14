import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLiteralNewlines, normalizeBoldEmphasis, evaluateStageBCitations, decideStageBRetry } from '../curate.mjs';

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

// normalizeBoldEmphasis: 2026-09-14実データで発覚したバグの再発防止テスト。
// 「**」の直後・直前に全角の開き括弧・閉じ括弧（「」『』（）等）が隣接すると、
// CommonMarkのemphasis flanking判定に引っかかり太字として解釈されない
// （**「AIに渡す」ボタン**が生テキストのまま公開された）。さらに悪いことに、
// 文中の離れた場所にある別の**...**ペアと意図しない組み合わせになることもある
// （**orchestrator（幹）**セッションが、新しい**worker（葉）**が
// 「orchestrator（幹）**セッションが、新しい**worker（葉）」という誤った範囲で
// 太字になった）。HTMLの<strong>タグへ事前変換することでパーサーのemphasis解決を
// 経由させず、この種の誤判定を構造的に防ぐ。
test('normalizeBoldEmphasis: 通常の太字をHTMLのstrongタグに変換する', () => {
  const input = '**Claude Code**は便利です。';
  assert.equal(normalizeBoldEmphasis(input), '<strong>Claude Code</strong>は便利です。');
});

test('normalizeBoldEmphasis: 太字記号の直後に全角開き括弧があっても正しく変換する（実際に生テキストのまま公開されたバグの再現）', () => {
  const input = '末尾に**「AIに渡す」ボタン**が設置されました。';
  assert.equal(normalizeBoldEmphasis(input), '末尾に<strong>「AIに渡す」ボタン</strong>が設置されました。');
});

test('normalizeBoldEmphasis: 太字記号の直前に全角閉じ括弧があっても正しく変換する', () => {
  const input = '**自己改善型の人工超知能（ASI）**の開発競争';
  assert.equal(normalizeBoldEmphasis(input), '<strong>自己改善型の人工超知能（ASI）</strong>の開発競争');
});

test('normalizeBoldEmphasis: 同一文中に複数の太字があっても意図しない範囲で結合しない（実際に誤った範囲で太字化されたバグの再現）', () => {
  const input = '起点となる**orchestrator（幹）**セッションが、新しい**worker（葉）**セッションを起動する。';
  assert.equal(
    normalizeBoldEmphasis(input),
    '起点となる<strong>orchestrator（幹）</strong>セッションが、新しい<strong>worker（葉）</strong>セッションを起動する。',
  );
});

test('normalizeBoldEmphasis: 太字が無い文章はそのまま返す', () => {
  const input = '通常の一文です[^s-aaa]。';
  assert.equal(normalizeBoldEmphasis(input), input);
});

test('normalizeBoldEmphasis: 改行をまたぐ**は変換しない（意図しない広範囲一致を避ける安全側の挙動）', () => {
  const input = '**開始\n**終了ではない';
  assert.equal(normalizeBoldEmphasis(input), input);
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
