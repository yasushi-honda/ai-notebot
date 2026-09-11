/**
 * 介護版記事の「手順フロー」SVGを、手順テキスト配列から決定的に生成する。
 * Vertex AI を一切呼ばない純粋関数のため、追加コストもハルシネーションリスクもゼロ
 * （scripts/lib/svg-diagram.mjs と同じ設計方針）。
 *
 * デザインは記事本体の「紙の実務ハンドブック」トーンに合わせ、彩度の高いカラーパレットではなく
 * 墨・藍・生成り紙色の3色でまとめる（AIトレンド版の svg-diagram.mjs とは意図的に別トーン）。
 *
 * レイアウトは縦積み（上から下へ番号順）にする。当初は横並びだったが、記事本文の幅
 * （実測で768px前後の記事コンテナからpaddingを引いた600〜650px程度）に対して手順数が
 * 3件を超えると横幅が大きくオーバーし、CSSの max-width:100% で縮小表示された結果
 * ラベルが数ピクセルまで縮み判読不能になっていた（5ステップの実データで実際に発生し発覚。
 * codex reviewで指摘・修正）。縦積みなら幅は手順数に依存せず常に一定に保てる。
 */

const WIDTH = 480;
const PADDING = 24;
const BADGE_SIZE = 32;
const TEXT_X_OFFSET = BADGE_SIZE + 16;
const LINE_HEIGHT = 24;
const CHARS_PER_LINE = 16;
const MAX_LINES = 3;
const ROW_GAP = 28; // ステップ間の余白（矢印を描くスペースを含む）
const ROW_VERTICAL_PADDING = 12;

const INK = '#2b2620';
const NAVY = '#2c4a63';
const PAPER = '#faf8f5';
const RULE = '#d8cdbb';

export function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

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
 * @param {string[]} steps 手順の短い要約（各要素が1ステップ、2〜6件想定）
 * @returns {string} SVG文字列
 */
export function buildStepsSvg(steps) {
  if (!steps || steps.length === 0) throw new Error('buildStepsSvg: steps が空です');

  const n = steps.length;

  const rows = steps.map((step) => {
    const lines = wrapText(step);
    const textHeight = lines.length * LINE_HEIGHT;
    const rowHeight = Math.max(BADGE_SIZE, textHeight) + ROW_VERTICAL_PADDING * 2;
    return { lines, rowHeight };
  });

  const height = PADDING * 2 + rows.reduce((sum, r) => sum + r.rowHeight, 0) + ROW_GAP * (n - 1);

  let cursorY = PADDING;
  const nodes = rows
    .map((row, i) => {
      const rowTop = cursorY;
      const rowCenterY = rowTop + row.rowHeight / 2;
      const badgeY = rowCenterY - BADGE_SIZE / 2;
      const textX = PADDING + TEXT_X_OFFSET;
      const textStartY = rowCenterY - ((row.lines.length - 1) * LINE_HEIGHT) / 2;

      const tspans = row.lines
        .map((line, li) => `<tspan x="${textX}" y="${textStartY + li * LINE_HEIGHT}">${escapeXml(line)}</tspan>`)
        .join('');

      cursorY += row.rowHeight;
      const arrow =
        i < n - 1
          ? `<path d="M ${PADDING + BADGE_SIZE / 2} ${cursorY + 4} L ${PADDING + BADGE_SIZE / 2} ${cursorY + ROW_GAP - 6}"
              stroke="${NAVY}" stroke-width="2" marker-end="url(#arrowhead)" />`
          : '';
      cursorY += ROW_GAP;

      return `
    <g>
      <rect x="${PADDING}" y="${badgeY}" width="${BADGE_SIZE}" height="${BADGE_SIZE}" fill="${NAVY}" />
      <text x="${PADDING + BADGE_SIZE / 2}" y="${rowCenterY}" text-anchor="middle" dominant-baseline="central"
        font-family="serif" font-size="16" font-weight="700" fill="${PAPER}">${i + 1}</text>
      <text font-family="'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif" font-size="16" font-weight="600"
        fill="${INK}">${tspans}</text>
    </g>${arrow}`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}">
  <defs>
    <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="${NAVY}" />
    </marker>
  </defs>
  <rect width="${WIDTH}" height="${height}" fill="${PAPER}" stroke="${RULE}" />${nodes}
</svg>
`;
}
