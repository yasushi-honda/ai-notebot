/**
 * 介護版記事の「手順フロー」SVGを、手順テキスト配列から決定的に生成する。
 * Vertex AI を一切呼ばない純粋関数のため、追加コストもハルシネーションリスクもゼロ
 * （scripts/lib/svg-diagram.mjs と同じ設計方針）。
 *
 * デザインは当初「紙の実務ハンドブック」トーン（墨・藍・生成り紙色・明朝体）だったが、
 * 実際にレンダリングしたページをユーザーが見て「単調で誰も見ない見た目」と判断した
 * （2026-09-11）。AIトレンド版（scripts/lib/svg-diagram.mjs）と同じ白背景・スレート罫線の
 * モダンな見た目に統一し、差し色だけ teal にしてコンテンツ種別が見分けられるようにする。
 *
 * レイアウトは縦積み（上から下へ番号順）にする。当初は横並びだったが、記事本文の幅
 * （実測で768px前後の記事コンテナからpaddingを引いた600〜650px程度）に対して手順数が
 * 3件を超えると横幅が大きくオーバーし、CSSの max-width:100% で縮小表示された結果
 * ラベルが数ピクセルまで縮み判読不能になっていた（5ステップの実データで実際に発生し発覚。
 * codex reviewで指摘・修正）。縦積みなら幅は手順数に依存せず常に一定に保てる。
 */

import { wrapJapaneseText } from './text-wrap.mjs';

const WIDTH = 480;
const PADDING = 24;
const BADGE_SIZE = 32;
const TEXT_X_OFFSET = BADGE_SIZE + 16;
const LINE_HEIGHT = 24;
const CHARS_PER_LINE = 16;
const MAX_LINES = 3;
const ROW_GAP = 28; // ステップ間の余白（矢印を描くスペースを含む）
const ROW_VERTICAL_PADDING = 12;

const INK = '#1e293b'; // slate-800
const TEAL = '#0d9488'; // teal-600
const PAPER = '#ffffff';
const RULE = '#e2e8f0'; // slate-200

export function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(text, charsPerLine = CHARS_PER_LINE, maxLines = MAX_LINES) {
  return wrapJapaneseText(text, charsPerLine, maxLines);
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
              stroke="${TEAL}" stroke-width="2" marker-end="url(#arrowhead)" />`
          : '';
      cursorY += ROW_GAP;

      return `
    <g>
      <circle cx="${PADDING + BADGE_SIZE / 2}" cy="${badgeY + BADGE_SIZE / 2}" r="${BADGE_SIZE / 2}" fill="${TEAL}" />
      <text x="${PADDING + BADGE_SIZE / 2}" y="${rowCenterY}" text-anchor="middle" dominant-baseline="central"
        font-family="'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif" font-size="16"
        font-weight="700" fill="${PAPER}">${i + 1}</text>
      <text font-family="'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif" font-size="16"
        font-weight="600" fill="${INK}">${tspans}</text>
    </g>${arrow}`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}">
  <defs>
    <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="${TEAL}" />
    </marker>
  </defs>
  <rect width="${WIDTH}" height="${height}" fill="${PAPER}" stroke="${RULE}" />${nodes}
</svg>
`;
}
