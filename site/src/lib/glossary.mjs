/**
 * セキュリティ版の用語集を、全記事の frontmatter（glossary）から集約する純関数。
 * 用語データは各記事だけが持ち、ここで集約するので、用語の保存先は二重にならない。
 * Astro のページと scripts/test の単体テストの両方から使うため .mjs で書いている。
 */

/**
 * @typedef {object} GlossaryEntry
 * @property {string} term
 * @property {string} reading
 * @property {string} definition
 * @property {string[]} sourceIds
 * @property {string} date 採用した定義を載せている記事の日付
 * @property {string} row 五十音の行（あ・か・さ…・その他）
 */

const ROWS = ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ'];
export const OTHER_ROW = 'その他';

// 小書きのかなは、対応する大きいかなの行に入れる
const SMALL_TO_BASE = { ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お', っ: 'つ', ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', ゎ: 'わ' };
const ROW_OF = {};
for (const [row, chars] of Object.entries({
  あ: 'あいうえお',
  か: 'かきくけこ',
  さ: 'さしすせそ',
  た: 'たちつてと',
  な: 'なにぬねの',
  は: 'はひふへほ',
  ま: 'まみむめも',
  や: 'やゆよ',
  ら: 'らりるれろ',
  わ: 'わをん',
})) {
  for (const c of chars) ROW_OF[c] = row;
}

const normalizeTerm = (term) => String(term).normalize('NFKC').toLowerCase();

/** 読みの先頭文字から五十音の行（あ・か・さ…）を返す。カタカナはひらがなに、濁点・半濁点は清音に寄せる。 */
export function kanaRow(reading) {
  const first = String(reading ?? '').trim()[0];
  if (!first) return OTHER_ROW;
  // カタカナ（ァ〜ヶ）をひらがなへ
  const code = first.charCodeAt(0);
  const hira = code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : first;
  // 濁点・半濁点を外す（が→か）
  const base = hira.normalize('NFD')[0];
  return ROW_OF[SMALL_TO_BASE[base] ?? base] ?? OTHER_ROW;
}

/**
 * @param {Array<{date: string, glossary?: Array<{term: string, reading: string, definition: string, sourceIds: string[]}>}>} posts
 * @returns {GlossaryEntry[]}
 *   同じ用語（大文字小文字・全半角を無視）は、最も新しい記事の定義を採用する。読み順（行→読み→用語）に並ぶ。
 */
export function buildGlossary(posts) {
  const latest = new Map();
  for (const post of posts) {
    for (const entry of post.glossary ?? []) {
      const key = normalizeTerm(entry.term);
      const current = latest.get(key);
      if (!current || post.date > current.date) latest.set(key, { ...entry, date: post.date });
    }
  }
  const order = [...ROWS, OTHER_ROW];
  return [...latest.values()]
    .map((e) => ({ ...e, row: kanaRow(e.reading) }))
    .sort(
      (a, b) =>
        order.indexOf(a.row) - order.indexOf(b.row) ||
        a.reading.localeCompare(b.reading, 'ja') ||
        a.term.localeCompare(b.term, 'ja'),
    );
}

/**
 * 行ごとにまとめる（見出し「あ行」等の表示用）。空の行は出さない。
 * @param {GlossaryEntry[]} entries
 * @returns {Array<{row: string, entries: GlossaryEntry[]}>}
 */
export function groupByRow(entries) {
  const groups = new Map();
  for (const e of entries) {
    if (!groups.has(e.row)) groups.set(e.row, []);
    groups.get(e.row).push(e);
  }
  const order = [...ROWS, OTHER_ROW];
  return order.filter((row) => groups.has(row)).map((row) => ({ row, entries: groups.get(row) }));
}
