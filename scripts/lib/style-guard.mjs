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

// 簡体字にしか存在しない字（日本語の新字体と共有する字は含めない）。出典が中国語の記事
// （例: GitHub Trending の中国語README）を、モデルが日本語に訳さず本文へ写した場合の検出用。
const SIMPLIFIED_ONLY_CHARS = new Set(
  '记协态级项应间层构础无这们为开发过还时对动问题网络总营统说现实库务经产关业从让软储优议论许证设详读调该请谁谢转输达运选边针钱链错长门难页顾须饭马鸟鱼'.split(
    '',
  ),
);

/**
 * 本文に簡体字（中国語）が混入していないか検出する純関数。
 * 脚注定義の出典タイトルは原文のまま中国語でよいため、呼び出し側は本文だけを渡すこと。
 * @param {string} text
 * @returns {string[]} 検出された簡体字（重複なし。空配列なら問題なし）
 */
export function findSimplifiedChinese(text) {
  return [...new Set([...text].filter((ch) => SIMPLIFIED_ONLY_CHARS.has(ch)))];
}
