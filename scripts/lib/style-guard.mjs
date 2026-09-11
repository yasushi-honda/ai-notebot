/**
 * 介護版記事本文から「AIっぽい」定型表現・絵文字を機械検出する純関数。
 * 「AIっぽくならないように」というデザイン要件を、プロンプト遵守任せにせず
 * 機械的に検証する（curate-care.mjs が検出時に再生成する）。
 */

// 絵文字全般（Emoji_Presentation な主要ブロックを広めにカバー）
const EMOJI_PATTERN =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

// 定型・誇張表現（AI生成文章に頻出し、実務ハンドブックの文体としては不自然なもの）
const BANNED_PHRASES = [
  'いかがでしたか',
  'まとめると',
  'ポイントは3つ',
  'ポイントは三つ',
  '革命的',
  '劇的に',
  'と言えるでしょう',
  'と言えます',
  '〜してみましょう',
  'してみましょう',
  '是非お試しください',
  'ぜひお試しください',
];

// 内容のない一般語だけの見出し（具体性がなく「AIが適当に置いた節見出し」感が強いもの）
const GENERIC_HEADING_PATTERN = /^#{1,3}\s*(概要|メリット|まとめ|はじめに|おわりに)\s*$/m;

/**
 * @param {string} text
 * @returns {string[]} 検出された表現の一覧（空配列なら問題なし）
 */
export function findBannedExpressions(text) {
  const found = [];

  const emojiMatches = text.match(new RegExp(EMOJI_PATTERN, 'gu'));
  if (emojiMatches) found.push(...new Set(emojiMatches));

  for (const phrase of BANNED_PHRASES) {
    if (text.includes(phrase)) found.push(phrase);
  }

  const headingMatches = text.match(new RegExp(GENERIC_HEADING_PATTERN, 'gm'));
  if (headingMatches) found.push(...headingMatches.map((h) => h.trim()));

  return found;
}
