/**
 * 日次ダイジェスト（AIトレンド版・セキュリティ版）共通の記事生成ロジック。
 * テーマ分類（Stage A）、引用付き本文生成の再生成ループ、出典チェック、テーマ単位の除外、
 * 脚注定義・概要テーブルの組み立てを提供する。版ごとの違い（ペルソナ・プロンプト・スキーマ・
 * frontmatter）は呼び出し側（curate.mjs / curate-security.mjs）が持つ。
 * 挙動は scripts/test/digest-characterization.test.mjs で固定している。
 */

import { generateText } from './vertex.mjs';
import { checkCitations } from './citation-gate.mjs';
import { findSimplifiedChinese } from './style-guard.mjs';

export const MIN_THEMES = 3;
export const MAX_THEMES = 5;
export const MAX_CANDIDATES_FOR_STAGE_A = 60; // トークン節約のため上限を設ける
// Stage Bは「全文に脚注」という指示に対しLLMが従わないことがあり、そのまま
// validate-citations.mjsまで到達すると出典検証ゲートで記事全体の公開が止まる
// （2026-09-10 scheduled run実績: 裏取り率97%で失敗）。checkCitationsによる
// その場での検証と再生成（介護版curate-care.mjsの既存パターンを踏襲）で、
// ゲート自体は緩めずに生成側の成功率を上げる。
export const MAX_REGENERATE_ATTEMPTS = 3; // 初回 + 出典チェック抵触時の再生成2回

export const STAGE_A_SCHEMA = {
  type: 'object',
  properties: {
    themes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '見出し（日本語、15字前後）' },
          angle: { type: 'string', description: 'なぜ今日のトピックとして重要か（1文）' },
          sourceIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'この見出しに関連する候補の id（2〜6件）',
          },
        },
        required: ['title', 'angle', 'sourceIds'],
      },
    },
  },
  required: ['themes'],
};

/**
 * 本文生成プロンプトの共通ルール（出典の付け方・原文への忠実さ・書式）。
 * 版ごとのペルソナ・文字数・対象読者のルールは、呼び出し側がこれらの前後に足す。
 */
export const CITATION_RULES = [
  '- 全ての文（句点「。」で終わる一文単位）に必ず文末で [^s-<id>] の形式の出典を付ける。',
  '  導入・書き出しの一般論の文も例外ではない。段落を要約する文なら、その段落で使う',
  '  複数idをまとめて付けてよい（例: 文末に[^s-aaa][^s-bbb][^s-ccc]）',
  '- 1文に複数の出典がある場合は [^s-aaa][^s-bbb] のように脚注を連続して並べる。',
  '  [^s-aaa, s-bbb] のように1つの角括弧内にカンマ区切りで複数idを入れることは絶対にしない',
];

export const FAITHFULNESS_RULES = [
  '- 出典のない推測や一般論の断定は避ける。あくまで下の情報に基づいて書く',
  '- 一次情報に書かれていない傾向・効果・評価・因果は足さない。「〜が広がっています」「注目を集めています」',
  '  「大きく高めます」「コスト削減に貢献しています」のような一般論の文は書かない。導入・まとめの文も、',
  '  一次情報に書かれた事実の要約にとどめる',
  '- 慎重な表現（可能性・検討中・予定・〜とされる・〜と主張）は断定に変えない。',
  '  例: 「義務化の可能性を含め」を「義務化を含め推進している」と書かない',
  '- 製品名・モデル名・組織名は原文のとおり正確に書く（短縮しない。例: Qwen3.8 Flash Next を Qwen3.8 Flash と書かない）',
  '- released / launched は「公開した・発表した」と訳し、「開発された」と訳さない',
];

export const FORMAT_RULES = [
  '- 一次情報が中国語・英語でも、本文は必ず自然な日本語に訳して書く（原文の語句を写さない。簡体字を本文に含めない）',
  '- 製品名・数値・固有名詞など重要な語句は **太字** で強調する（例: **Claude Code** は...）',
  '- 3件以上の並列的な事実を列挙する場合は箇条書きを使ってよい。',
  '  箇条書きの各行も必ず句点＋脚注で終える（例: `- 項目の説明です[^s-aaa]。`）',
];

/**
 * 防御的処理: LLMがまれに実際の改行ではなく文字列としての "\n"（バックスラッシュ+n）を
 * そのまま出力することがあり、本番記事にリテラル文字として表示されるバグが実際に発生した
 * （2026-09-10、Apple関連セクションで発生・修正）。プロンプト遵守に頼らず、
 * 残っていれば実際の改行に正規化する。
 */
export function normalizeLiteralNewlines(text) {
  return text.replace(/\\n/g, '\n');
}

/**
 * 防御的処理: CommonMarkの強調構文（**text**）は、開始直後・終了直前に全角の括弧
 * （「」『』（）等、Unicode上はpunctuationに分類される）が隣接すると、emphasis用の
 * flanking判定（デリミタが「開始」「終了」として機能するための前後文脈のルール）に
 * 引っかかり、太字として解釈されず `**` が生のテキストのまま表示されることが実際に
 * 発生した（2026-09-14、「**「AIに渡す」ボタン**」が生テキストのまま公開された）。
 * さらに悪いことに、文中に離れた場所で別の `**...**` ペアがあると、パーサーが
 * 意図しない組み合わせで別のペアを形成し、全く無関係な範囲が太字になることもある
 * （実データで確認: 「**orchestrator（幹）**セッションが、新しい**worker（葉）**」が
 * 「orchestrator（幹）**セッションが、新しい**worker（葉）」という誤った範囲で
 * 太字になっていた）。
 *
 * CommonMarkのemphasis解決ロジック自体に依存する限りこの種の誤判定は避けられないため、
 * `**text**` を機械的にHTMLの `<strong>text</strong>` に事前変換し、パーサーの
 * emphasis解決を経由させない（Astroのmarkdown処理はMarkdown内の生HTMLをそのまま
 * 通す設定のため、`<strong>`タグは常に正しくレンダリングされることを実機確認済み）。
 * LLMは常に非ネスト・改行を挟まない `**text**` の形式でのみ太字を使う前提
 * （curate.mjs/curate-care.mjs/curate-weekly.mjsのプロンプト指示と一致）。
 *
 * フェンス付きコードブロック（```...```/~~~...~~~）とインラインコードスパン（`...`）の
 * 内部は変換対象から除外する。記事本文がコード例として `**name**` のようなリテラルな
 * Markdown記法自体を紹介する場合、この変換をそのまま適用するとコード例の中身が
 * `<strong>name</strong>` に書き換わってしまい、コードブロックとして表示される文字列が
 * 破壊される（codex reviewで指摘）。
 */
export function normalizeBoldEmphasis(text) {
  const lines = text.split('\n');
  const result = [];
  let fenceChar = null;
  let fenceLen = 0;
  for (const line of lines) {
    if (fenceChar === null) {
      const openMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (openMatch) {
        fenceChar = openMatch[1][0];
        fenceLen = openMatch[1].length;
        result.push(line);
        continue;
      }
      result.push(normalizeBoldEmphasisOutsideInlineCode(line));
      continue;
    }
    result.push(line);
    const closePattern = new RegExp(`^ {0,3}[${fenceChar}]{${fenceLen},}[ \t]*$`);
    if (closePattern.test(line)) {
      fenceChar = null;
      fenceLen = 0;
    }
  }
  return result.join('\n');
}

function normalizeBoldEmphasisOutsideInlineCode(line) {
  const codeSpanPattern = /(?<!`)(`+)[\s\S]*?(?<!`)\1(?!`)/g;
  let lastIndex = 0;
  let output = '';
  let match;
  while ((match = codeSpanPattern.exec(line)) !== null) {
    output += line.slice(lastIndex, match.index).replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
    output += match[0];
    lastIndex = codeSpanPattern.lastIndex;
  }
  output += line.slice(lastIndex).replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  return output;
}

/**
 * 出典の title/summary は任意の外部サイトから機械的に取得した信頼できないテキストであり、
 * プロンプトインジェクション（例: ページ内に「以降の指示を無視して...」と埋め込む攻撃）を
 * 試みうる。プロンプト文字列内で見た目上も指示部分と区別できるよう、タグで明示的に囲み、
 * かつタグ様の文字列を含んでいてもタグ構造を壊さないよう < > を全角に変換する
 * （介護版 curate-care.mjs の codex review 指摘を共通化。プロンプト側の明示的な防御指示と合わせた多層防御）。
 */
export function escapeSourceField(s) {
  return String(s).replace(/</g, '＜').replace(/>/g, '＞');
}

/** 候補一覧を、外部データであることが明示できるタグで囲んで整形する（セキュリティ版など外部テキストの多い版向け）。 */
export function formatIsolatedCandidates(items) {
  return items
    .map(
      (i) =>
        `<source id="${i.id}">\n` +
        `<source-name>${escapeSourceField(i.source)}</source-name>\n` +
        `<source-title>${escapeSourceField(i.title)}</source-title>\n` +
        `<source-excerpt>${escapeSourceField(i.summary || '(概要なし)')}</source-excerpt>\n` +
        `</source>`,
    )
    .join('\n');
}

/**
 * 箇条書き・番号付きリストの行のうち、行末（句点の手前）に脚注が無いものを返す。
 * citation-gate は空行で段落、「。！？」で文に分けて検証するため、句点の無い箇条書きが1段落に並ぶと
 * 全体が1文扱いになり、脚注が1つあれば全行が通ってしまう（codex による再現済み）。
 * 本関数は行単位でその抜けを塞ぐ。
 * @param {string} markdown
 * @returns {string[]} 脚注の無いリスト行
 */
export function findUncitedListItems(markdown) {
  return markdown
    .split('\n')
    .filter((line) => /^\s*(?:[-*+]|\d+[.)])\s+\S/.test(line))
    .filter((line) => !/\[\^s-[0-9a-f]+\]\s*[。！？]?\s*$/.test(line));
}

export function formatCandidateList(items) {
  return items
    .map((i) => `${i.id} [${i.source}] ${i.title}\n   ${i.summary || '(概要なし)'}`)
    .join('\n');
}

/**
 * Stage A: 候補を MIN_THEMES〜MAX_THEMES 個のテーマにクラスタリングする。
 * 実在しない id は落とし、有効なテーマが MIN_THEMES 未満なら例外にする。
 *
 * @param {object} opts
 * @param {Array} opts.items 候補（アーカイブの items）
 * @param {string} opts.personaLine 編集者のペルソナ文（1行）
 * @param {string} opts.candidateKind 「本日収集した○○の候補一覧」の○○
 * @param {string} [opts.orderingNote] テーマの並び順への追加指示（例: 重要度順）。未指定ならプロンプトは従来どおり
 * @param {Function} [opts.generate] テキスト生成関数（既定は Vertex AI）
 */
export async function runStageA({ items, personaLine, candidateKind, orderingNote, generate = generateText }) {
  const pool = items.slice(0, MAX_CANDIDATES_FOR_STAGE_A);
  const prompt = [
    personaLine,
    `以下は本日収集した${candidateKind}の候補一覧です（idはそのまま出典IDとして使います）。`,
    '',
    `候補から重複や瑣末な話題を避けつつ ${MIN_THEMES}〜${MAX_THEMES} 個のテーマにクラスタリングしてください。`,
    '各テーマには、関連する候補の id を2〜6件、必ず下のリストに実在する id だけを使って sourceIds に入れてください。',
    '同じ id を複数テーマにまたがって使っても構いません。',
    ...(orderingNote ? [orderingNote] : []),
    '',
    '## 候補一覧',
    formatCandidateList(pool),
  ].join('\n');

  const text = await generate({ prompt, responseSchema: STAGE_A_SCHEMA, temperature: 0.3 });
  const parsed = JSON.parse(text);
  const validIds = new Set(pool.map((i) => i.id));

  const themes = (parsed.themes ?? [])
    .map((t) => ({ ...t, sourceIds: (t.sourceIds ?? []).filter((id) => validIds.has(id)) }))
    .filter((t) => t.sourceIds.length > 0)
    .slice(0, MAX_THEMES);

  if (themes.length < MIN_THEMES) {
    throw new Error(`Stage A: 有効なテーマが${MIN_THEMES}件未満でした（${themes.length}件）。`);
  }
  return themes;
}

/**
 * Stage Bの生成結果1件分について、validate-citations.mjsと同じ観点（不正表記・未許可id・
 * 脚注ゼロ・裏取り率100%未満）を検査し、再生成が必要な問題点を文字列配列で返す純関数。
 * runStageBの再生成ループから使うほか、Vertex AI呼び出しを伴わず単体テストできるように
 * 独立した関数として切り出す。
 */
export function evaluateStageBCitations(bodyMarkdown, validIds) {
  const check = checkCitations({ markdown: bodyMarkdown, validIds, exemptTableHeading: null, bodyOnly: true });
  const problems = [];
  if (check.malformed.length > 0) {
    problems.push(
      `不正な脚注表記があります（カンマ区切りで複数idを1つの角括弧に詰め込む等）: ${check.malformed.join(', ')}`,
    );
  }
  if (check.unresolved.length > 0) {
    problems.push(`このテーマに与えられていないidを引用しています: ${check.unresolved.join(', ')}`);
  }
  if (check.cited.size === 0) {
    problems.push('本文に脚注が1件もありません');
  }
  if (check.citedSentences.length < check.sentences.length) {
    problems.push(
      `脚注のない文があります。導入・要約文も含め全ての文の文末に[^s-<id>]を付けてください: ${check.uncited
        .map((s) => s.slice(0, 80))
        .join(' | ')}`,
    );
  }
  const chinese = findSimplifiedChinese(bodyMarkdown);
  if (chinese.length > 0) {
    problems.push(
      `本文に中国語（簡体字: ${chinese.join('')}）が混入しています。出典が中国語でも本文は必ず自然な日本語に訳して書き、原文の語句を写さないでください`,
    );
  }
  return problems;
}

/**
 * runStageBの再生成ループの意思決定部分（accept/retry/exhausted）を純関数として切り出す。
 * generateText（Vertex AI実API呼び出し）を含むループ本体はネットワーク依存で単体テストできないが、
 * この決定ロジック（境界値: 最大試行回数への到達判定、extraInstructionsの重複排除累積）だけを
 * 切り出すことで、Vertex AI呼び出し無しでテストできるようにする（pr-review-toolkitのテスト
 * カバレッジレビューで指摘: このPRの主目的である再生成ループ配線そのものが無テストだった）。
 */
export function decideStageBRetry({ attempt, maxAttempts, problems, extraInstructions }) {
  if (problems.length === 0) {
    return { action: 'accept' };
  }
  if (attempt >= maxAttempts) {
    return { action: 'exhausted' };
  }
  return { action: 'retry', extraInstructions: [...new Set([...extraInstructions, ...problems])] };
}

/** 再生成を使い切っても出典チェックを満たせなかったことを、通信エラー等の想定外の例外と区別するための型。 */
export class StageBExhaustedError extends Error {}

/**
 * 各テーマのStage B結果から、出典チェックを満たせず除外されたテーマを取り除いて採用分を返す純関数。
 * 全テーマ成功を要求すると、1テーマの確率的な失敗で当日の記事全体が公開されない
 * （2026-10-09実績: changelog系テーマで3回連続NG）。出典検証ゲートは緩めず、記事の網羅性だけを
 * 下げる。残りが最小テーマ数未満なら生成を中止する。
 */
export function partitionStageBOutcomes(outcomes, minThemes) {
  const sections = outcomes.filter((o) => !o.failed).map((o) => ({ ...o.theme, ...o.result }));
  const droppedTitles = outcomes.filter((o) => o.failed).map((o) => o.theme.title);
  if (sections.length < minThemes) {
    throw new Error(
      `Stage B: 出典チェックを満たしたテーマが${minThemes}件未満でした（${sections.length}件。除外: ${droppedTitles.join(' / ') || 'なし'}）。`,
    );
  }
  return { sections, droppedTitles };
}

/**
 * 1テーマ分の本文を、出典チェック（evaluate）に通るまで最大 maxAttempts 回生成する。
 * チェックに抵触した問題点は次回のプロンプトの修正指示（extraInstructions）として渡す。
 * 使い切ったら StageBExhaustedError（呼び出し側がテーマ単位で除外する）。
 *
 * @param {object} opts
 * @param {{title: string}} opts.theme
 * @param {(extraInstructions: string[]) => string} opts.buildPrompt
 * @param {object} opts.schema responseSchema
 * @param {(parsed: object) => object} opts.postprocess 生成結果（JSON.parse 後）の正規化
 * @param {(result: object) => string[]} opts.evaluate 再生成が必要な問題点（空配列なら採用）
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxAttempts]
 * @param {Function} [opts.generate]
 */
export async function generateWithCitationRetry({
  theme,
  buildPrompt,
  schema,
  postprocess,
  evaluate,
  temperature = 0.4,
  maxAttempts = MAX_REGENERATE_ATTEMPTS,
  generate = generateText,
}) {
  let extraInstructions = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = buildPrompt(extraInstructions);
    const text = await generate({ prompt, responseSchema: schema, temperature });
    const result = postprocess(JSON.parse(text));

    const problems = evaluate(result);
    const decision = decideStageBRetry({ attempt, maxAttempts, problems, extraInstructions });

    if (decision.action === 'accept') return result;

    console.warn(`  ✗ 出典チェックNG（試行${attempt}/${maxAttempts}）: ${problems.join(' / ')}`);
    if (decision.action === 'exhausted') {
      throw new StageBExhaustedError(`Stage B: 「${theme.title}」で出典チェックを満たす本文を生成できませんでした。`);
    }
    extraInstructions = decision.extraInstructions;
  }
}

/**
 * 全テーマの本文生成を順に実行し、再生成を使い切ったテーマだけ除外して採用分を返す。
 * API 障害等の想定外の例外は握りつぶさない。残りが minThemes 未満なら例外（partitionStageBOutcomes）。
 *
 * @param {object} opts
 * @param {Array<{title: string, sourceIds: string[]}>} opts.candidateThemes
 * @param {(theme: object) => Promise<object>} opts.runTheme 1テーマ分の生成（bodyMarkdown 等を返す）
 * @param {number} [opts.minThemes]
 * @returns {Promise<{sections: Array, droppedTitles: string[], themes: Array}>}
 */
export async function generateThemesWithDrop({ candidateThemes, runTheme, minThemes = MIN_THEMES }) {
  const outcomes = [];
  for (const theme of candidateThemes) {
    try {
      const result = await runTheme(theme);
      outcomes.push({ theme, result });
      console.log(`  ✓ ${theme.title}`);
    } catch (err) {
      // 再生成を使い切った場合のみテーマ単位で除外する。API障害等の想定外の例外は握りつぶさない
      if (!(err instanceof StageBExhaustedError)) throw err;
      outcomes.push({ theme, failed: true });
      console.warn(`  ⚠ テーマを除外: ${theme.title}`);
    }
  }
  const { sections, droppedTitles } = partitionStageBOutcomes(outcomes, minThemes);
  if (droppedTitles.length > 0) console.warn(`除外したテーマ（${droppedTitles.length}件）: ${droppedTitles.join(' / ')}`);
  const themes = candidateThemes.filter((t) => !droppedTitles.includes(t.title));
  return { sections, droppedTitles, themes };
}

export function slugifyTags(themes) {
  return themes.map((t) => t.title.replace(/[「」『』\s]/g, '').slice(0, 20));
}

/**
 * 出典タイトル・URL は外部フィード由来で、攻撃者が書きうる文字列。Astro は Markdown 内の生 HTML をそのまま
 * 通すため、タイトルの `<img onerror=…>` や、URL に仕込んだ `)` による Markdown リンクの打ち切りが
 * そのままサイトに出る（RSS の CDATA・実体参照で実際に生の `<script>` がタイトルに残ることを確認済み）。
 * タイトルは < > [ ] を全角に、URL は構造を壊す文字をパーセントエンコードする。
 */
export function sanitizeFootnoteTitle(title) {
  return String(title)
    .replace(/</g, '＜')
    .replace(/>/g, '＞')
    .replace(/\[/g, '［')
    .replace(/\]/g, '］')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeFootnoteUrl(url) {
  return String(url).replace(/[()<>\s"'`]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

export function buildFootnoteDefs(usedIds, itemsById) {
  return [...usedIds]
    .sort()
    .map((id) => {
      const item = itemsById.get(id);
      if (!item) return null;
      return `[^${id}]: [${sanitizeFootnoteTitle(item.title)}](${sanitizeFootnoteUrl(item.url)}) — ${item.source}（${item.publishedAt.slice(0, 10)}）`;
    })
    .filter(Boolean)
    .join('\n');
}

/** Markdownテーブルのセルを壊さないよう `|` と改行をエスケープする */
export function escapeTableCell(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * テーマ別ソース内訳テーブルを sections（Stage A/Bの検証済み出力）から機械的に組み立てる。
 * LLMには書かせない（＝新たな主張を含まない構造要素）ため、
 * validate-citations.mjs はテーブル行を脚注検証の対象外として扱う設計になっている。
 */
export function buildOverviewTable(sections, itemsById) {
  const header = '| # | テーマ | 出典数 | 主な情報源 |\n|---|---|---|---|';
  const rows = sections.map((s, i) => {
    const sourceNames = [...new Set(s.sourceIds.map((id) => itemsById.get(id)?.source).filter(Boolean))];
    const mainSources = sourceNames.slice(0, 3).join(', ') + (sourceNames.length > 3 ? ' 他' : '');
    return `| ${i + 1} | ${escapeTableCell(s.title)} | ${s.sourceIds.length}件 | ${escapeTableCell(mainSources)} |`;
  });
  return ['## 今日のトピック', '', header, ...rows].join('\n');
}

