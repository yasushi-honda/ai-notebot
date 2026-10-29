/**
 * セキュリティ版記事の「すぐできる対策」「今日の用語」の検証と Markdown 組み立て（純関数）。
 * LLM が返した actions / terms を個別に検証し、通ったものだけを機械的に Markdown へ組み立てる。
 * 組み立て後の文は出典ゲート（validate-citations）が全文検査する。ここでの検証は
 * 「書式が壊れていない・引用が当該テーマの出典に限られる・用語が出典に実在する」までを担い、
 * 意味の忠実性（定義が出典の内容と合うか）は保証しない。
 */

export const MAX_ACTIONS_PER_THEME = 3;
export const MAX_TERMS_PER_THEME = 2;
export const MAX_TERMS_PER_DAY = 6;

const FIELD_LIMITS = { who: 60, what: 90, condition: 80, term: 30, reading: 40, definition: 120 };
// Markdown・HTML・脚注の構造を壊しうる文字は、LLM 由来のフィールドに入れさせない
const FORBIDDEN_CHARS = /[\[\]<>|`*\\\r\n]/;
// 句点・感嘆符・疑問符（英文の「. 」も）を含むと、出典ゲートが文を途中で分割し、脚注のない断片が生まれて記事全体が失敗する
const SENTENCE_BREAK = /[。！？]|[.!?](?:\s|$)/;
// 用語集は読みで五十音順に並べる。表記を揃えるためひらがなだけを許可する（カタカナの読みは除外）
const READING_PATTERN = /^[ぁ-んー・ ]+$/;
// 「すぐできる対策」は読者が取れる行動だけ。運営会社・提供元自身の対応（修正版の公開、再発防止策など）は対策ではない
// 「サイトの運営者」「アプリの開発者」のように読者側にもなりうる語は含めず、会社・提供元を示す語に絞る
const PROVIDER_SIDE_WHO = /(株式会社|有限会社|運営会社|運営元|提供元|提供会社|開発元|ベンダー|同社|当社|各社)/;
const ACTION_ENDING = /(してください|ください|しましょう|しておく|しておきましょう|する|行う|ます)$/;

/** 前後の空白と末尾の句点を落とす（文の組み立て時に自前で句点を付けるため） */
function clean(value) {
  return String(value ?? '')
    .trim()
    .replace(/[。.．]+$/, '')
    .trim();
}

function checkField(name, value, { required }) {
  if (value === '') return required ? `${name} が空です` : null;
  if (value.length > FIELD_LIMITS[name]) return `${name} が長すぎます（${value.length}字 > ${FIELD_LIMITS[name]}字）`;
  if (FORBIDDEN_CHARS.test(value)) return `${name} に使えない文字が含まれています`;
  if (SENTENCE_BREAK.test(value)) return `${name} に文の区切り（句点等）が含まれています`;
  return null;
}

function checkSourceIds(sourceIds, validIds) {
  if (!Array.isArray(sourceIds) || sourceIds.length === 0) return 'sourceIds が空です';
  const bad = sourceIds.filter((id) => !validIds.has(id));
  if (bad.length > 0) return `このテーマに与えられていない id を引用しています: ${bad.join(', ')}`;
  return null;
}

/**
 * actions を個別に検証し、通ったものを正規化して返す。通らないものは理由つきで rejected に入れる
 * （対策は任意の内容なので、不正な項目は再生成ではなく除外する）。
 * @param {Array} actions LLM の出力 [{who, what, condition?, sourceIds}]
 * @param {Set<string>} validIds このテーマに与えられた出典 id
 */
export function validateActions(actions, validIds) {
  const accepted = [];
  const rejected = [];
  for (const raw of Array.isArray(actions) ? actions : []) {
    const action = {
      who: clean(raw?.who),
      what: clean(raw?.what),
      condition: clean(raw?.condition),
      sourceIds: [...new Set(raw?.sourceIds ?? [])],
    };
    const reason =
      checkField('who', action.who, { required: true }) ??
      checkField('what', action.what, { required: true }) ??
      checkField('condition', action.condition, { required: false }) ??
      (PROVIDER_SIDE_WHO.test(action.who) ? 'who が提供元・運営会社側です（読者が取れる行動だけを載せる）' : null) ??
      (ACTION_ENDING.test(action.what) ? null : 'what が行動の形（〜してください・〜する）ではありません') ??
      checkSourceIds(action.sourceIds, validIds);
    if (reason) rejected.push({ item: raw, reason });
    else accepted.push(action);
  }
  return { accepted: accepted.slice(0, MAX_ACTIONS_PER_THEME), rejected };
}

function normalizeForMatch(s) {
  return String(s).normalize('NFKC').toLowerCase();
}

/**
 * terms を個別に検証する。通る条件:
 *  - 書式（長さ・禁止文字・読みがひらがな/カタカナのみ）
 *  - 引用 id がこのテーマの出典に限られる
 *  - 用語そのものが、引用した出典の title / summary に実在する（出典に無い語を LLM が持ち込むのを防ぐ）
 * @param {Array} terms LLM の出力 [{term, reading, definition, sourceIds}]
 * @param {Set<string>} validIds
 * @param {Map<string, {title: string, summary: string}>} itemsById
 * @param {string} [bodyText] 指定すると、用語がその本文（当該テーマの記事）にも出てくることを要求する
 *   （記事に出てこない語を用語集に載せても、読者の役に立たないため）
 */
export function validateTerms(terms, validIds, itemsById, bodyText) {
  const accepted = [];
  const rejected = [];
  for (const raw of Array.isArray(terms) ? terms : []) {
    const term = {
      term: clean(raw?.term),
      reading: clean(raw?.reading),
      definition: clean(raw?.definition),
      sourceIds: [...new Set(raw?.sourceIds ?? [])],
    };
    let reason =
      checkField('term', term.term, { required: true }) ??
      checkField('reading', term.reading, { required: true }) ??
      checkField('definition', term.definition, { required: true }) ??
      checkSourceIds(term.sourceIds, validIds);
    if (!reason && !READING_PATTERN.test(term.reading)) reason = 'reading がひらがな以外を含みます';
    if (!reason) {
      const needle = normalizeForMatch(term.term);
      const found = term.sourceIds.some((id) => {
        const item = itemsById.get(id);
        return item && normalizeForMatch(`${item.title}\n${item.summary ?? ''}`).includes(needle);
      });
      if (!found) reason = '用語が引用した出典の本文に見当たりません';
      else if (bodyText !== undefined && !normalizeForMatch(bodyText).includes(needle)) reason = '用語が記事の本文に出てきません';
    }
    if (reason) rejected.push({ item: raw, reason });
    else accepted.push(term);
  }
  return { accepted: accepted.slice(0, MAX_TERMS_PER_THEME), rejected };
}

const footnotes = (sourceIds) => sourceIds.map((id) => `[^${id}]`).join('');

/** 句点の手前に脚注を置く（出典ゲートは「。」までを1文とみなすため、脚注は句点より前） */
export function actionLine(action) {
  const lead = action.condition ? `${action.condition}、` : '';
  return `- ${lead}${action.who}は、${action.what}${footnotes(action.sourceIds)}。`;
}

export function termLine(term) {
  return `- <strong>${term.term}</strong>（${term.reading}）：${term.definition}${footnotes(term.sourceIds)}。`;
}

/**
 * 1テーマ分の本文を組み立てる。見出し「すぐできる対策」は見出し行（ゲートの検証対象外）で、
 * 空行で本文と分ける（見出しの直後に本文が続くと、見出し以外の行が段落として扱われるため）。
 */
export function assembleThemeMarkdown(bodyMarkdown, actions) {
  if (actions.length === 0) return bodyMarkdown.trim();
  return [bodyMarkdown.trim(), '### すぐできる対策', actions.map(actionLine).join('\n')].join('\n\n');
}

/**
 * 全テーマの terms を、同じ用語（大文字小文字・全半角を無視）は最初のものだけ残して1日の上限まで集める。
 * @param {Array<Array>} termsPerTheme
 */
export function collectDailyTerms(termsPerTheme) {
  const seen = new Set();
  const out = [];
  for (const terms of termsPerTheme) {
    for (const t of terms) {
      const key = normalizeForMatch(t.term);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out.slice(0, MAX_TERMS_PER_DAY);
}

/** 「今日の用語」節。用語が無ければ null（空の見出しを出さない）。 */
export function assembleGlossarySection(terms) {
  if (terms.length === 0) return null;
  return ['## 今日の用語', '', ...terms.map(termLine)].join('\n');
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_ID_PATTERN = /^s-[0-9a-f]+$/;
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;
const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * 書き出す frontmatter が、サイト側の content.config.ts（security コレクション）のスキーマを満たすかを
 * 生成直後に検査する。違反したまま書き出すと、その後のサイト全体のビルドが落ちて本体の公開まで止まるため
 * （介護版 curate-care.mjs の生成後スキーマ再検査と同じ考え方）。content.config.ts と同期させること。
 * @returns {string[]} 問題点（空なら適合）
 */
export function validateSecurityFrontmatter(fm) {
  const problems = [];
  if (!isNonEmptyString(fm.title)) problems.push('title が空です');
  if (!DATE_PATTERN.test(fm.date ?? '')) problems.push('date が YYYY-MM-DD ではありません');
  if (!isNonEmptyString(fm.description)) problems.push('description が空です');
  for (const key of ['tags', 'themeTitles', 'sourceIds']) {
    if (!isStringArray(fm[key])) problems.push(`${key} が文字列の配列ではありません`);
  }
  if (isStringArray(fm.sourceIds) && !fm.sourceIds.every((id) => SOURCE_ID_PATTERN.test(id))) {
    problems.push('sourceIds に不正な id が含まれています');
  }
  if (
    !Array.isArray(fm.themes) ||
    !fm.themes.every((t) => isNonEmptyString(t?.title) && Number.isInteger(t?.sourceCount) && t.sourceCount >= 0)
  ) {
    problems.push('themes が {title, sourceCount} の配列ではありません');
  }
  if (
    !Array.isArray(fm.glossary) ||
    !fm.glossary.every(
      (g) =>
        isNonEmptyString(g?.term) &&
        isNonEmptyString(g?.reading) &&
        isNonEmptyString(g?.definition) &&
        isStringArray(g?.sourceIds) &&
        g.sourceIds.length > 0 &&
        g.sourceIds.every((id) => SOURCE_ID_PATTERN.test(id)),
    )
  ) {
    problems.push('glossary が {term, reading, definition, sourceIds} の配列ではありません');
  }
  return problems;
}

/**
 * LLM が書いた本文に含めてはいけないマークアップを検出する。本文は外部フィード・外部ページの文章に
 * 影響を受けるため（プロンプトインジェクション）、悪意のある記述が生 HTML・リンク・画像としてサイトに
 * 出ないよう、生成直後に弾く（検出したら再生成。使い切ればそのテーマは除外）。
 * 許可するのは、太字の変換で機械的に作る <strong> だけ。本文に URL は不要なので URL も拒否する。
 * @param {string} markdown
 * @returns {string[]} 問題点（空なら安全）
 */
export function findUnsafeMarkup(markdown) {
  const problems = [];
  if (/<(?!\/?strong>)/i.test(markdown)) problems.push('<strong> 以外の HTML タグ（または < 記号）が含まれています');
  if (/!\[/.test(markdown)) problems.push('画像の記法が含まれています');
  if (/\]\(/.test(markdown)) problems.push('リンクの記法 [文](URL) が含まれています');
  if (/^\s*\[[^\]^\n]+\]:\s*\S/m.test(markdown)) problems.push('リンク参照の定義行が含まれています');
  if (/(https?:\/\/|www\.)/i.test(markdown)) problems.push('本文に URL が含まれています（出典は脚注で示すため不要）');
  return problems;
}

/** テーマ見出し（Stage A の LLM 出力）を、見出し行・表のセル・HTML を壊さない形にする。 */
export function sanitizeThemeTitle(title) {
  return String(title)
    .replace(/[<>]/g, (c) => (c === '<' ? '＜' : '＞'))
    .replace(/[|\r\n]+/g, ' ')
    .replace(/^#+\s*/, '')
    .trim();
}
