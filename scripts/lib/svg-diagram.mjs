/**
 * 「今日のトピック一覧」カード型SVGを、テーマ配列から決定的に生成する。
 * Vertex AI を一切呼ばない純粋関数のため、追加コストもハルシネーションリスクもゼロ。
 * （Stage A で確定済みのテーマタイトルをそのまま図解にするだけ）
 */

const WIDTH = 1200;
const HEIGHT = 260;
const PADDING = 24;
const CARD_GAP = 20;
const CHARS_PER_LINE = 9; // CJKはほぼ等幅とみなし、文字数で折り返す
const MAX_LINES = 3;

// 落ち着いたカテゴリカルパレット（indigo基調のサイト配色と調和する5色）
const PALETTE = [
  { bg: '#eef2ff', border: '#c7d2fe', accent: '#4f46e5', badge: '#4f46e5' }, // indigo
  { bg: '#f0f9ff', border: '#bae6fd', accent: '#0284c7', badge: '#0284c7' }, // sky
  { bg: '#ecfdf5', border: '#a7f3d0', accent: '#059669', badge: '#059669' }, // emerald
  { bg: '#fffbeb', border: '#fde68a', accent: '#d97706', badge: '#d97706' }, // amber
  { bg: '#fff1f2', border: '#fecdd3', accent: '#e11d48', badge: '#e11d48' }, // rose
];

/** SVG/XML特殊文字をエスケープする（LLM生成テキストに &<>"' が含まれても壊れないように） */
export function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 文字列を固定文字数で折り返し、最大 MAX_LINES 行に切り詰める（超過分は末尾を … にする） */
function wrapText(text, charsPerLine = CHARS_PER_LINE, maxLines = MAX_LINES) {
  const lines = [];
  for (let i = 0; i < text.length && lines.length < maxLines; i += charsPerLine) {
    lines.push(text.slice(i, i + charsPerLine));
  }
  const consumed = lines.join('').length;
  if (consumed < text.length && lines.length > 0) {
    lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1) + '…';
  }
  return lines;
}

/**
 * @param {Array<{title: string}>} themes 3〜5件のテーマ配列
 * @returns {string} SVG文字列（そのままファイルに書き出せる）
 */
export function buildOverviewSvg(themes) {
  const n = themes.length;
  if (n === 0) throw new Error('buildOverviewSvg: themes が空です');

  const cardWidth = (WIDTH - PADDING * 2 - CARD_GAP * (n - 1)) / n;
  const cardHeight = HEIGHT - PADDING * 2;
  const cardY = PADDING;

  const cards = themes
    .map((theme, i) => {
      const palette = PALETTE[i % PALETTE.length];
      const cardX = PADDING + i * (cardWidth + CARD_GAP);
      const lines = wrapText(theme.title);
      const badgeCx = cardX + 34;
      const badgeCy = cardY + 34;
      const textStartY = badgeCy + 56;

      const tspans = lines
        .map((line, li) => `<tspan x="${cardX + cardWidth / 2}" dy="${li === 0 ? 0 : '1.5em'}">${escapeXml(line)}</tspan>`)
        .join('');

      return `
    <g>
      <rect x="${cardX}" y="${cardY}" width="${cardWidth}" height="${cardHeight}" rx="16"
        fill="${palette.bg}" stroke="${palette.border}" stroke-width="2" />
      <circle cx="${badgeCx}" cy="${badgeCy}" r="18" fill="${palette.badge}" />
      <text x="${badgeCx}" y="${badgeCy}" text-anchor="middle" dominant-baseline="central"
        font-family="sans-serif" font-size="18" font-weight="700" fill="#ffffff">${i + 1}</text>
      <text x="${cardX + cardWidth / 2}" y="${textStartY}" text-anchor="middle"
        font-family="'Hiragino Sans','Noto Sans JP',sans-serif" font-size="20" font-weight="700"
        fill="#0f172a">${tspans}</text>
      <rect x="${cardX + 20}" y="${cardY + cardHeight - 14}" width="${cardWidth - 40}" height="4" rx="2"
        fill="${palette.accent}" />
    </g>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#fafaf9" />${cards}
</svg>
`;
}
