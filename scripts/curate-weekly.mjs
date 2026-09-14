#!/usr/bin/env node
/**
 * 週刊まとめ記事生成スクリプト。
 * その週（weeklyWindow参照）に実際に公開された site/src/content/posts/<date>.md の
 * frontmatter（sourceIds・themeTitles/themes）だけを材料に、Gemini で週間の総括本文を
 * 生成し site/src/content/weekly/<weekStart>.md を書き出す。
 *
 * data/raw/<date>.json 全件（1日62〜126件）ではなく、既に日次のStage A/Bキュレーションと
 * validate-citations.mjsの出典検証を通過した sourceIds だけをプールにする設計にしている
 * （トークン上限が理由ではなく、その週に実際に記事化された事実だけを材料にする＝週次記事が
 * 日次記事より広い主張をできない構造にするため。詳細: docs/adr/adr-2026-09-14-weekly-digest.md）。
 *
 * スラッグは公開日ではなく週の開始日（weekStart）にする。公開日をスラッグにすると、
 * 月曜以降に workflow_dispatch で手動再実行した際に同じ週の記事が別URLで二重生成されて
 * しまうため（週開始日なら再実行は常に同じファイルを上書きする）。
 *
 * 使い方: GEMINI_ACCESS_TOKEN=... node scripts/curate-weekly.mjs [YYYY-MM-DD(公開日)]
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { generateText } from './lib/vertex.mjs';
import { todayJst, weeklyWindow, isSunday } from './lib/date.mjs';
import { parseFrontmatter } from './lib/frontmatter.mjs';
import { normalizeLiteralNewlines, normalizeBoldEmphasis, evaluateStageBCitations, decideStageBRetry } from './curate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = join(ROOT, 'data', 'raw');
const POSTS_DIR = join(ROOT, 'site', 'src', 'content', 'posts');
const WEEKLY_DIR = join(ROOT, 'site', 'src', 'content', 'weekly');
const IMAGES_DIR = join(ROOT, 'site', 'public', 'images');

const MIN_THEMES = 4;
const MAX_THEMES = 6;
const MAX_CANDIDATES_FOR_STAGE_A = 160; // 週7日分でも1日あたりの候補上限(curate.mjsの60)より
// 十分大きいが、日次記事が既に絞り込んだsourceIdsだけを対象にするため実際はこれよりずっと少ない
const MIN_DAYS_REQUIRED = 5; // これ未満の日次記事しか実在しなければ週次生成を中止する
const MAX_REGENERATE_ATTEMPTS = 3; // 初回 + 出典チェック抵触時の再生成2回

const STAGE_A_SCHEMA = {
  type: 'object',
  properties: {
    themes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '見出し（日本語、15字前後）' },
          angle: { type: 'string', description: 'この1週間を通してなぜ重要なテーマか（1文）' },
          sourceIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'この見出しに関連する候補の id（2〜8件）',
          },
        },
        required: ['title', 'angle', 'sourceIds'],
      },
    },
  },
  required: ['themes'],
};

const STAGE_B_SCHEMA = {
  type: 'object',
  properties: {
    bodyMarkdown: {
      type: 'string',
      description:
        'このテーマの本文（Markdown、700〜1000字）。読みやすさのため2〜4個の短い段落に分け、' +
        '段落と段落の間には実際の空行を1行はさむこと（文字列としてバックスラッシュエヌを書くのではなく、' +
        '本物の改行を2つ連続で入れる）。事実を述べる文には必ず文末に [^s-<id>] 形式の脚注を付け、' +
        '与えられたid以外は絶対に使わないこと。見出し(#)は含めず本文のみ。',
    },
  },
  required: ['bodyMarkdown'],
};

/**
 * その週の日次記事（存在するものだけ）の frontmatter から、週次記事の候補プールを組み立てる
 * 純関数。sourceIds は日次記事が実際に引用した（＝validate-citations.mjsを通過済みの）ものだけ
 * を対象にし、data/raw の全件は見ない。id は URL の sha1 なので同一URLが複数日に出ても
 * Map への代入で自然に重複排除される。
 *
 * @param {object} opts
 * @param {string[]} opts.dates weeklyWindow().dates（対象7日、古い順）
 * @param {(date: string) => Promise<string|null>} opts.readPostMarkdown 日次記事本文を返す
 *   （存在しなければnull）。フォールバック用に注入可能にし、ネットワーク/ファイルI/Oなしで単体テストできるようにする
 * @param {(date: string) => Promise<object|null>} opts.readRawArchive 日次アーカイブJSONを返す
 *   （存在しなければnull）
 * @returns {Promise<{
 *   presentDates: string[], dailyThemes: {date: string, themeTitles: string[]}[],
 *   itemsById: Map<string, object>, poolIds: string[]
 * }>}
 */
export async function collectWeeklyPool({ dates, readPostMarkdown, readRawArchive }) {
  const presentDates = [];
  const dailyThemes = [];
  const itemsById = new Map();
  const wantedIds = new Set();

  for (const date of dates) {
    const markdown = await readPostMarkdown(date);
    if (!markdown) continue;

    // 意図的に themeTitles（文字列配列）だけを読み、themes（{title, sourceCount}のオブジェクト
    // 配列）は読まない。scripts/lib/frontmatter.mjs の軽量パーサはブロックリストの各要素が
    // 単純な文字列である前提のため、themes のようなネストしたオブジェクトを渡すと
    // 1要素目のプロパティ行しか拾えず壊れた値になる（実測確認済み。Astro自身のYAMLパーサは
    // 別実装のためcontent collection側の表示には影響しない）。
    const { frontmatter } = parseFrontmatter(markdown);
    const sourceIds = Array.isArray(frontmatter.sourceIds) ? frontmatter.sourceIds : [];
    // themeTitles導入前の日次記事（2026-09-09等）はこのフィールドを持たず空配列になる。
    // その場合は tags（当時の唯一のテーマ表現）にフォールバックする
    // （posts/[date]/index.astro の shareText と同じ既存フォールバックパターンを踏襲。
    // codex reviewで指摘・修正: フォールバックが無いと「今週のトピック」テーブルで
    // その日だけ実際は出典があるのに(記録なし)と表示されてしまう）。
    const rawThemeTitles = Array.isArray(frontmatter.themeTitles) ? frontmatter.themeTitles : [];
    const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];
    const themeTitles = rawThemeTitles.length > 0 ? rawThemeTitles : tags;
    if (sourceIds.length === 0) continue;

    presentDates.push(date);
    dailyThemes.push({ date, themeTitles });
    for (const id of sourceIds) wantedIds.add(id);

    const archive = await readRawArchive(date);
    for (const item of archive?.items ?? []) {
      if (wantedIds.has(item.id) && !itemsById.has(item.id)) {
        itemsById.set(item.id, item);
      }
    }
  }

  // 安全側の上限でカットする（超過時は新しい日の出典を優先するため、ここまでの追加順＝
  // 日付昇順を維持したまま末尾からではなく先頭から間引くと古い日が消えてしまうため、
  // 逆順にしてから上限分だけ取り、再度日付順に戻す）
  const poolIds = [...itemsById.keys()].reverse().slice(0, MAX_CANDIDATES_FOR_STAGE_A).reverse();

  // 日次記事のsourceIdsに載っているのに、その日のdata/raw/<date>.jsonが読めなかった等の理由で
  // itemsByIdに解決できなかったid（=候補プールがサイレントに縮小している兆候）。
  // ハルシネーション防止の観点では安全側（存在しないidをLLMに渡さないだけ）だが、
  // 「週次まとめが実際より薄い材料で書かれている」ことが不可視にならないよう呼び出し元に返す
  // （pr-review-toolkitのsilent-failureレビューで指摘・修正）。
  const unresolvedIds = [...wantedIds].filter((id) => !itemsById.has(id));

  return { presentDates, dailyThemes, itemsById, poolIds, unresolvedIds };
}

/** Markdownテーブルのセルを壊さないよう `|` と改行をエスケープする（curate.mjsと同じ規則） */
function escapeTableCell(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * 「今週のトピック」テーブルを機械生成する純関数。LLMには書かせない（＝新たな主張を含まない
 * 構造要素）ため、validate-citations.mjsはテーブル行を脚注検証の対象外として扱う
 * （curate.mjsのbuildOverviewTableと同じ設計）。日付セルは日次記事へのリンクにする。
 *
 * @param {{date: string, themeTitles: string[]}[]} dailyThemes 日付昇順
 * @returns {string}
 */
export function buildWeeklyOverviewTable(dailyThemes) {
  const header = '| 日付 | その日の主なテーマ |\n|---|---|';
  const rows = dailyThemes.map((d) => {
    const titles = d.themeTitles.length > 0 ? d.themeTitles.join(' / ') : '(記録なし)';
    return `| [${d.date}](../../posts/${d.date}/) | ${escapeTableCell(titles)} |`;
  });
  return ['## 今週のトピック', '', header, ...rows].join('\n');
}

/**
 * 週次まとめの生成を中止すべきかを判定する純関数（decideStageBRetryと同様、main()の
 * process.exit(1)と混在させず境界値を単体テストできるように切り出す。pr-review-toolkitの
 * テストカバレッジレビューで指摘: MIN_DAYS_REQUIREDの境界（安全側フェイルセーフの中核）が
 * main()に埋め込まれたままテスト不可能だった）。
 *
 * @param {{presentDates: string[], poolIds: string[]}} opts
 * @returns {{abort: boolean, reason?: string}}
 */
export function shouldAbortWeeklyGeneration({ presentDates, poolIds }) {
  if (presentDates.length < MIN_DAYS_REQUIRED) {
    return {
      abort: true,
      reason: `実在する日次記事が${MIN_DAYS_REQUIRED}日未満です（${presentDates.length}日）。週次まとめの生成を中止します。`,
    };
  }
  if (poolIds.length === 0) {
    return { abort: true, reason: '候補となる出典が1件もありません。週次まとめの生成を中止します。' };
  }
  return { abort: false };
}

/**
 * OGP/Twitter Card用の画像として、その週の日次記事のうち実際にhero.jpgが生成されている
 * （SVGプレースホルダにフォールバックしていない）最新の日を選ぶ純関数。新規画像生成は行わない
 * （docs/adr/adr-2026-09-14-weekly-digest.md）。
 *
 * @param {string[]} presentDates 日付昇順
 * @param {(date: string) => Promise<boolean>} heroJpgExists 注入可能なファイル存在チェック
 * @returns {Promise<string|null>}
 */
export async function pickOgImageDate(presentDates, heroJpgExists) {
  for (const date of [...presentDates].reverse()) {
    if (await heroJpgExists(date)) return date;
  }
  return null;
}

// curate.mjsのformatCandidateListとの違い: 週次は複数日にまたがるため、LLMが「週を通しての
// 流れ」を時系列として認識できるよう各候補に収集日（publishedAtの日付部分）を明示する。
function formatCandidateList(items) {
  return items
    .map((i) => `${i.id} [${i.publishedAt.slice(0, 10)} / ${i.source}] ${i.title}\n   ${i.summary || '(概要なし)'}`)
    .join('\n');
}

async function runStageA({ poolIds, itemsById, dailyThemes }) {
  const pool = poolIds.map((id) => itemsById.get(id)).filter(Boolean);
  const dailyThemesText = dailyThemes
    .map((d) => `${d.date}: ${d.themeTitles.join(' / ') || '(記録なし)'}`)
    .join('\n');

  const prompt = [
    'あなたはAI業界の動向を横断的に見る日本語テックブログの編集者です。',
    'これから1週間分の振り返り記事を書きます。以下は今週すでに日次記事で取り上げた見出しの推移と、',
    'その週に引用された出典候補一覧です（idはそのまま出典IDとして使います）。',
    '',
    '## 今週の日次記事の見出し推移（日付順）',
    dailyThemesText,
    '',
    `候補から重複や瑣末な話題を避けつつ、単なる日々の見出しの繰り返しではなく「週を通しての流れ」`,
    `「繰り返し現れた論点」「今週特に注目すべき変化」を軸に ${MIN_THEMES}〜${MAX_THEMES} 個のテーマに`,
    'クラスタリングしてください。各テーマには、関連する候補の id を2〜8件、必ず下のリストに実在する',
    'id だけを使って sourceIds に入れてください。同じ id を複数テーマにまたがって使っても構いません。',
    '',
    '## 候補一覧',
    formatCandidateList(pool),
  ].join('\n');

  const text = await generateText({ prompt, responseSchema: STAGE_A_SCHEMA, temperature: 0.3 });
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

function buildStageBPrompt(theme, themeItems, extraInstructions) {
  const extraNote =
    extraInstructions.length > 0
      ? `\n\n## 重要な修正指示（前回の生成の問題点。必ず修正すること）\n${extraInstructions.map((n) => `- ${n}`).join('\n')}`
      : '';

  return [
    'あなたはAI業界の動向を横断的に見る日本語テックブログの筆者です。今回は1週間分の振り返り記事です。',
    `見出し「${theme.title}」（${theme.angle}）について、以下の一次情報だけを根拠に本文を書いてください。`,
    '単発の日のニュース紹介ではなく、1週間を通じた流れ・変化・繰り返し現れた論点として書くこと。',
    '',
    '## 執筆ルール',
    '- 700〜1000字。Markdown本文のみ（見出し記号は含めない）',
    '- 必ず2〜4個の短い段落（1段落150〜250字目安、2〜4文程度）に分け、段落と段落の間は',
    '  空行を1行入れて区切ること。1つの巨大な段落に詰め込まない（読みやすさのため）',
    '- 全ての文（句点「。」で終わる一文単位）に必ず文末で [^s-<id>] の形式の出典を付ける。',
    '  導入・書き出しの一般論の文も例外ではない。段落を要約する文なら、その段落で使う',
    '  複数idをまとめて付けてよい（例: 文末に[^s-aaa][^s-bbb][^s-ccc]）',
    '- 1文に複数の出典がある場合は [^s-aaa][^s-bbb] のように脚注を連続して並べる。',
    '  [^s-aaa, s-bbb] のように1つの角括弧内にカンマ区切りで複数idを入れることは絶対にしない',
    '- 出典のない推測や一般論の断定は避ける。あくまで下の情報に基づいて書く',
    '- ノンエンジニアにも伝わる平易な日本語。専門用語は短く補足する',
    '- 製品名・数値・固有名詞など重要な語句は **太字** で強調する（例: **Claude Code** は...）',
    '- 3件以上の並列的な事実を列挙する場合は箇条書きを使ってよい。',
    '  箇条書きの各行も必ず句点＋脚注で終える（例: `- 項目の説明です[^s-aaa]。`）',
    extraNote,
    '',
    '## 参照可能な一次情報',
    formatCandidateList(themeItems),
  ].join('\n');
}

async function runStageB(theme, itemsById) {
  const themeItems = theme.sourceIds.map((id) => itemsById.get(id)).filter(Boolean);
  const validIds = new Set(theme.sourceIds);

  let extraInstructions = [];
  for (let attempt = 1; attempt <= MAX_REGENERATE_ATTEMPTS; attempt++) {
    const prompt = buildStageBPrompt(theme, themeItems, extraInstructions);
    const text = await generateText({ prompt, responseSchema: STAGE_B_SCHEMA, temperature: 0.4 });
    const result = JSON.parse(text);
    result.bodyMarkdown = normalizeLiteralNewlines(result.bodyMarkdown);
    result.bodyMarkdown = normalizeBoldEmphasis(result.bodyMarkdown);

    const problems = evaluateStageBCitations(result.bodyMarkdown, validIds);
    const decision = decideStageBRetry({ attempt, maxAttempts: MAX_REGENERATE_ATTEMPTS, problems, extraInstructions });

    if (decision.action === 'accept') return result;

    console.warn(`  ✗ 出典チェックNG（試行${attempt}/${MAX_REGENERATE_ATTEMPTS}）: ${problems.join(' / ')}`);
    if (decision.action === 'exhausted') {
      throw new Error(`Stage B: 「${theme.title}」で出典チェックを満たす本文を生成できませんでした。`);
    }
    extraInstructions = decision.extraInstructions;
  }
}

function buildFootnoteDefs(usedIds, itemsById) {
  return [...usedIds]
    .sort()
    .map((id) => {
      const item = itemsById.get(id);
      if (!item) return null;
      return `[^${id}]: [${item.title}](${item.url}) — ${item.source}（${item.publishedAt.slice(0, 10)}）`;
    })
    .filter(Boolean)
    .join('\n');
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const publishDate = process.argv[2] ?? todayJst();
  const { weekStart, weekEnd, dates } = weeklyWindow(publishDate);

  console.log(`対象期間: ${weekStart} 〜 ${weekEnd}（公開日: ${publishDate}）`);
  if (!isSunday(publishDate)) {
    console.warn(
      `⚠ 公開日（${publishDate}）が日曜日ではありません。週開始日（${weekStart}）も日曜日以外になります。` +
        `週次まとめは「日曜始まり」を前提に設計されているため（weekly.ymlのcronは日曜のみ発火）、` +
        `手動実行以外でこの警告が出る場合は日付指定を見直してください。`,
    );
  }

  const { presentDates, dailyThemes, itemsById, poolIds, unresolvedIds } = await collectWeeklyPool({
    dates,
    // ファイルが無い（ENOENT、その日の記事/アーカイブが単に存在しない＝想定内）はnullを返して
    // 静かにスキップするが、それ以外（権限エラー・JSON構文エラー等）は本来起きてはいけない
    // 異常なので、握りつぶさずログに残す（pr-review-toolkitのsilent-failureレビューで指摘・修正）。
    readPostMarkdown: async (date) => {
      try {
        return await readFile(join(POSTS_DIR, `${date}.md`), 'utf8');
      } catch (err) {
        if (err.code !== 'ENOENT') console.error(`日次記事の読み込みで想定外のエラー（${date}）: ${err.message}`);
        return null;
      }
    },
    readRawArchive: async (date) => {
      try {
        return JSON.parse(await readFile(join(RAW_DIR, `${date}.json`), 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') console.error(`日次アーカイブの読み込みで想定外のエラー（${date}）: ${err.message}`);
        return null;
      }
    },
  });

  console.log(`実在する日次記事: ${presentDates.length}/7日（${presentDates.join(', ')}）`);
  if (unresolvedIds.length > 0) {
    console.warn(
      `⚠ 日次記事が引用しているid ${unresolvedIds.length}件が、対応するdata/raw/<date>.jsonから解決できませんでした` +
        `（アーカイブファイルの欠損・破損の可能性）。候補プールから除外して続行します: ${unresolvedIds.join(', ')}`,
    );
  }
  const abortDecision = shouldAbortWeeklyGeneration({ presentDates, poolIds });
  if (abortDecision.abort) {
    console.error(abortDecision.reason);
    process.exit(1);
  }

  console.log(`Stage A: ${poolIds.length}件からテーマをクラスタリング中...`);
  const themes = await runStageA({ poolIds, itemsById, dailyThemes });
  console.log(`Stage A 完了: ${themes.length}テーマ`);
  themes.forEach((t) => console.log(`  - ${t.title} (${t.sourceIds.length}件の出典)`));

  console.log('Stage B: テーマごとに本文生成中...');
  const sections = [];
  for (const theme of themes) {
    const result = await runStageB(theme, itemsById);
    sections.push({ ...theme, ...result });
    console.log(`  ✓ ${theme.title}`);
  }

  const footnotePattern = /\[\^(s-[0-9a-f]+)\]/g;
  const usedIds = new Set();
  for (const s of sections) {
    for (const m of s.bodyMarkdown.matchAll(footnotePattern)) usedIds.add(m[1]);
  }

  const overviewTable = buildWeeklyOverviewTable(dailyThemes);
  const bodyParts = [overviewTable, ...sections.map((s) => `## ${s.title}\n\n${s.bodyMarkdown}`)];
  const footnotes = buildFootnoteDefs(usedIds, itemsById);
  const totalChars = bodyParts.join('').replace(/[#|\-\s]/g, '').length;

  const ogImageDate = await pickOgImageDate(presentDates, (date) =>
    fileExists(join(IMAGES_DIR, date, 'hero.jpg')),
  );

  // frontmatter の値は LLM 出力を含むため、curate.mjs と同様に必ず JSON.stringify でエスケープする
  const frontmatter = [
    '---',
    `title: ${JSON.stringify(`${weekStart}〜${weekEnd} のAIトレンド週刊まとめ`)}`,
    `weekStart: ${JSON.stringify(weekStart)}`,
    `weekEnd: ${JSON.stringify(weekEnd)}`,
    `publishedOn: ${JSON.stringify(publishDate)}`,
    `description: ${JSON.stringify(themes.map((t) => t.title).join(' / '))}`,
    `themeTitles:`,
    ...themes.map((t) => `  - ${JSON.stringify(t.title)}`),
    `themes:`,
    ...themes.map((t) => `  - title: ${JSON.stringify(t.title)}\n    sourceCount: ${t.sourceIds.length}`),
    `sourceIds: [${[...usedIds].map((id) => JSON.stringify(id)).join(', ')}]`,
    `sourceDates: [${presentDates.map((d) => JSON.stringify(d)).join(', ')}]`,
    ogImageDate ? `ogImageDate: ${JSON.stringify(ogImageDate)}` : null,
    '---',
    '',
  ]
    .filter((line) => line !== null)
    .join('\n');

  const markdown = frontmatter + bodyParts.join('\n\n') + '\n\n' + footnotes + '\n';

  await mkdir(WEEKLY_DIR, { recursive: true });
  const outPath = join(WEEKLY_DIR, `${weekStart}.md`);
  await writeFile(outPath, markdown, 'utf8');

  console.log(
    `site/src/content/weekly/${weekStart}.md を書き出しました（本文約${totalChars}字 / 脚注${usedIds.size}件 / 対象${presentDates.length}日）`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('週次まとめ生成が失敗しました:', err);
    process.exit(1);
  });
}
