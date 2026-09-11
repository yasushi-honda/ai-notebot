/**
 * SVG内テキストの日本語向け折り返し。
 *
 * 元の実装（care-svg.mjs / svg-diagram.mjs にそれぞれ重複していた）は文字数で機械的に
 * 切るだけで、「音声認識ツ」「ールを利用して」のように外来語（カタカナ連続）の途中で
 * 割れてしまい読みにくいとユーザーから指摘された（2026-09-11、実際のレンダリング結果の
 * スクリーンショットで発覚）。形態素解析器を追加すれば厳密な分かち書きができるが、
 * 依存パッケージを増やさない方針（CLAUDE.md）のため、次の2つのヒューリスティックのみで
 * 改善する:
 * 1. 行の切れ目がカタカナ連続（＝外来語である可能性が高い）の途中に来る場合は、
 *    その連続の先頭まで戻す（戻しすぎて行が極端に短くならない範囲でのみ適用）
 * 2. 最低限の禁則処理（行頭に閉じ括弧・句読点、行末に開き括弧を残さない）
 */

const KATAKANA_RE = /^[゠-ヿー]$/;
const NO_LINE_START = new Set(['、', '。', '，', '．', '）', '」', '』', '】', '〉', '》', '〕', '・', 'ー']);
const NO_LINE_END = new Set(['（', '「', '『', '【', '〈', '《', '〔']);

function isKatakana(ch) {
  return ch !== undefined && KATAKANA_RE.test(ch);
}

/**
 * @param {string} text
 * @param {number} charsPerLine 1行あたりの目安文字数（CJKはほぼ等幅とみなす）
 * @param {number} maxLines 最大行数（超過分は末尾を … にする）
 * @returns {string[]}
 */
export function wrapJapaneseText(text, charsPerLine, maxLines) {
  const lines = [];
  let pos = 0;

  while (pos < text.length && lines.length < maxLines) {
    let end = Math.min(pos + charsPerLine, text.length);

    // 外来語（カタカナ連続）の途中で割れる場合は、その連続の先頭まで戻す。
    // 戻しすぎると行が極端に短くなるため、最低でも charsPerLine の半分は残す。
    if (end < text.length && isKatakana(text[end - 1]) && isKatakana(text[end])) {
      let wordStart = end;
      while (wordStart > pos && isKatakana(text[wordStart - 1])) wordStart--;
      if (wordStart > pos + Math.floor(charsPerLine / 2)) {
        end = wordStart;
      }
    }

    // 禁則処理: 行頭に句読点・閉じ括弧類が来る場合は前の行に含める
    while (end < text.length && NO_LINE_START.has(text[end])) end++;
    // 禁則処理: 行末に開き括弧類が来る場合は次の行に送る
    while (end > pos + 1 && NO_LINE_END.has(text[end - 1])) end--;

    lines.push(text.slice(pos, end));
    pos = end;
    if (lines.length >= maxLines) break;
  }

  if (pos < text.length && lines.length > 0) {
    lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1) + '…';
  }
  return lines;
}
