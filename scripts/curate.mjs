#!/usr/bin/env node
/**
 * ② 記事生成スクリプト。
 * data/raw/<date>.json を入力に、Gemini で
 *   Stage A: 3〜5 テーマへのクラスタリング + 重要度採点
 *   Stage B: テーマごとの本文生成（全主張に [^s-<id>] 形式の脚注を必須化）
 * を行い、site/src/content/posts/<date>.md を書き出す。
 *
 * 出典として引用できる id は Stage A/B とも当日のアーカイブに実在するものだけに限定するが、
 * 最終的な正しさの担保は scripts/validate-citations.mjs が当日アーカイブ全体に対して行う
 * （このスクリプト自身が出す exit 0 は「検証に通る保証」ではない）。
 *
 * 使い方: GEMINI_ACCESS_TOKEN=... node scripts/curate.mjs [YYYY-MM-DD]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { todayJst } from './lib/date.mjs';
import {
  MIN_THEMES,
  CITATION_RULES,
  FAITHFULNESS_RULES,
  FORMAT_RULES,
  runStageA,
  formatCandidateList,
  normalizeLiteralNewlines,
  normalizeBoldEmphasis,
  evaluateStageBCitations,
  generateWithCitationRetry,
  generateThemesWithDrop,
  slugifyTags,
  buildFootnoteDefs,
  buildOverviewTable,
} from './lib/digest-curation.mjs';

// 共通部品は lib/digest-curation.mjs へ移した。既存の import 元（curate-weekly / curate-care / テスト）が
// 変わらないよう、従来このモジュールから公開していた名前はそのまま再公開する。
export {
  normalizeLiteralNewlines,
  normalizeBoldEmphasis,
  evaluateStageBCitations,
  decideStageBRetry,
  StageBExhaustedError,
  partitionStageBOutcomes,
} from './lib/digest-curation.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = join(ROOT, 'data', 'raw');
const POSTS_DIR = join(ROOT, 'site', 'src', 'content', 'posts');

const STAGE_B_SCHEMA = {
  type: 'object',
  properties: {
    bodyMarkdown: {
      type: 'string',
      description:
        'このテーマの本文（Markdown、600〜900字）。読みやすさのため2〜4個の短い段落に分け、' +
        '段落と段落の間には実際の空行を1行はさむこと（文字列としてバックスラッシュエヌを書くのではなく、' +
        '本物の改行を2つ連続で入れる）。事実を述べる文には必ず文末に [^s-<id>] 形式の脚注を付け、' +
        '与えられたid以外は絶対に使わないこと。見出し(#)は含めず本文のみ。',
    },
  },
  required: ['bodyMarkdown'],
};

/** AI 版の Stage A 設定（ペルソナ・候補の呼び方）。 */
const STAGE_A_PERSONA = 'あなたはAI業界の動向を横断的に見る日本語テックブログの編集者です。';
const STAGE_A_CANDIDATE_KIND = 'AI関連ニュース・ハック・話題';

function buildStageBPrompt(theme, themeItems, extraInstructions) {
  const extraNote =
    extraInstructions.length > 0
      ? `\n\n## 重要な修正指示（前回の生成の問題点。必ず修正すること）\n${extraInstructions.map((n) => `- ${n}`).join('\n')}`
      : '';

  return [
    'あなたはAI業界の動向を横断的に見る日本語テックブログの筆者です。',
    `見出し「${theme.title}」（${theme.angle}）について、以下の一次情報だけを根拠に本文を書いてください。`,
    '',
    '## 執筆ルール',
    '- 600〜900字。Markdown本文のみ（見出し記号は含めない）',
    '- 必ず2〜4個の短い段落（1段落150〜250字目安、2〜4文程度）に分け、段落と段落の間は',
    '  空行を1行入れて区切ること。1つの巨大な段落に詰め込まない（読みやすさのため）',
    ...CITATION_RULES,
    ...FAITHFULNESS_RULES,
    '- ノンエンジニアにも伝わる平易な日本語。専門用語は短く補足する',
    ...FORMAT_RULES,
    extraNote,
    '',
    '## 参照可能な一次情報',
    formatCandidateList(themeItems),
  ].join('\n');
}

async function runStageB(theme, itemsById) {
  const themeItems = theme.sourceIds.map((id) => itemsById.get(id)).filter(Boolean);
  const validIds = new Set(theme.sourceIds);

  return generateWithCitationRetry({
    theme,
    buildPrompt: (extraInstructions) => buildStageBPrompt(theme, themeItems, extraInstructions),
    schema: STAGE_B_SCHEMA,
    postprocess: (result) => {
      result.bodyMarkdown = normalizeLiteralNewlines(result.bodyMarkdown);
      result.bodyMarkdown = normalizeBoldEmphasis(result.bodyMarkdown);
      return result;
    },
    evaluate: (result) => evaluateStageBCitations(result.bodyMarkdown, validIds),
  });
}

async function main() {
  const dateArg = process.argv[2] ?? todayJst();
  const rawPath = join(RAW_DIR, `${dateArg}.json`);

  let archive;
  try {
    archive = JSON.parse(await readFile(rawPath, 'utf8'));
  } catch (err) {
    console.error(`アーカイブが読めません: ${rawPath}\n  ${err.message}`);
    process.exit(1);
  }

  const items = archive.items ?? [];
  const itemsById = new Map(items.map((i) => [i.id, i]));

  console.log(`Stage A: ${items.length}件からテーマをクラスタリング中...`);
  const candidateThemes = await runStageA({
    items,
    personaLine: STAGE_A_PERSONA,
    candidateKind: STAGE_A_CANDIDATE_KIND,
  });
  console.log(`Stage A 完了: ${candidateThemes.length}テーマ`);
  candidateThemes.forEach((t) => console.log(`  - ${t.title} (${t.sourceIds.length}件の出典)`));

  console.log('Stage B: テーマごとに本文生成中...');
  const { sections, themes } = await generateThemesWithDrop({
    candidateThemes,
    runTheme: (theme) => runStageB(theme, itemsById),
    minThemes: MIN_THEMES,
  });

  // 本文中で実際に使われた脚注idを抽出（Stage Bが指示に反して未許可idを使った場合も含め、
  // 最終的な正しさは validate-citations.mjs が当日アーカイブ全体に対して検証する）
  const footnotePattern = /\[\^(s-[0-9a-f]+)\]/g;
  const usedIds = new Set();
  for (const s of sections) {
    for (const m of s.bodyMarkdown.matchAll(footnotePattern)) usedIds.add(m[1]);
  }

  // テーマ別ソース内訳テーブル（LLMには書かせず機械的に組み立てる。新たな主張を含まないため
  // validate-citations.mjs はテーブル行を脚注検証の対象外として扱う）
  const overviewTable = buildOverviewTable(sections, itemsById);

  const bodyParts = [overviewTable, ...sections.map((s) => `## ${s.title}\n\n${s.bodyMarkdown}`)];
  const footnotes = buildFootnoteDefs(usedIds, itemsById);
  const totalChars = bodyParts.join('').replace(/[#|\-\s]/g, '').length;

  // frontmatter の値は LLM 出力（テーマ見出し等）を含むため、二重引用符等が混じっても
  // 壊れないよう必ず JSON.stringify でエスケープする（手動でのクォート組み立てはしない。
  // codex reviewで指摘・修正: LLMがタイトルに " を含めると手動組み立てのYAML風frontmatterが壊れ、
  // Astroビルドが失敗しうる）。
  const frontmatter = [
    '---',
    `title: ${JSON.stringify(`${dateArg} のAIトレンド`)}`,
    `date: ${JSON.stringify(dateArg)}`,
    `description: ${JSON.stringify(themes.map((t) => t.title).join(' / '))}`,
    `tags: [${slugifyTags(themes).map((t) => JSON.stringify(t)).join(', ')}]`,
    // tags は文字数制限・記号除去で見出しが欠けることがあるため、シェア用テキスト等
    // 元の見出しをそのまま必要とする用途向けに、加工しないテーマ見出しの配列を別途保持する
    `themeTitles:`,
    ...themes.map((t) => `  - ${JSON.stringify(t.title)}`),
    // ホームの「本日の記録」一覧がテーマ名だけでなく出典件数（実データ）も表示するために
    // 追加した（themeTitlesと違い{title, sourceCount}のオブジェクト配列。2026-09-11）。
    `themes:`,
    ...themes.map((t) => `  - title: ${JSON.stringify(t.title)}\n    sourceCount: ${t.sourceIds.length}`),
    `sourceIds: [${[...usedIds].map((id) => JSON.stringify(id)).join(', ')}]`,
    // 画像生成モデル（gemini-3.1-flash-lite-image）は「文字なし」を明示しても、
    // プロンプト文中に列挙可能な具体的要素が複数含まれていると、それぞれを見出し付きの
    // 区画として描き分ける「インフォグラフィック」的レイアウトを自発的に選ぶことが
    // 実機検証で判明していた（2026-09-11）。そのため一時的に「単一テーマ・文字なし」の
    // 抽象イラストに切り替えたが、(1) 実際に3日分を比較したところ、複数テーマ列挙型の
    // プロンプトは2/2で文字化けなく完全に正しい日本語のインフォグラフィックを生成できていた
    // 一方、(2) 「文字なし」を明示した単一テーマ版でもモデルが指示を無視してラベルを
    // 追加することがあり、その際は（プロンプト自体が英語のため）日本語ではなく英語の
    // ラベルになってしまい、日本語サイトとして体裁が崩れる方が実害が大きいと判断した
    // （ユーザーとの相談の上、2026-09-11 再変更）。複数テーマ列挙型に戻しつつ、
    // 「文字を入れるなら必ず日本語、英語は使うな」を明記することで、テキストが入ること
    // 自体は許容しつつ言語の一貫性だけは担保する設計にした。
    // このモデルの generateContent API には Imagen 系のような negativePrompt 専用
    // パラメータは存在しない（公式ドキュメント確認済み。Imagen自体も2026-08-17に
    // 廃止されGemini 3.1 Flash Imageへの移行が推奨されており、乗り換え候補にもならない）。
    `heroImagePrompt: ${JSON.stringify(
      `Flat-design tech blog hero illustration summarizing today's AI trends: ${themes.map((t) => t.angle).join('; ')}. Clean, modern, blue and white palette, 16:9. If the image includes any text, labels, or captions, they must be written in natural, grammatically correct Japanese only — never English, and never garbled or illegible characters.`,
    )}`,
    '---',
    '',
  ].join('\n');

  // 出典見出しは Astro 側の remark-rehype footnoteLabel 設定で自動描画されるため、
  // ここでは脚注定義のみを本文末尾に追記する（見出しの重複を避ける）
  const markdown = frontmatter + bodyParts.join('\n\n') + '\n\n' + footnotes + '\n';

  await mkdir(POSTS_DIR, { recursive: true });
  const outPath = join(POSTS_DIR, `${dateArg}.md`);
  await writeFile(outPath, markdown, 'utf8');

  console.log(`site/src/content/posts/${dateArg}.md を書き出しました（本文約${totalChars}字 / 脚注${usedIds.size}件）`);
}

// `node scripts/curate.mjs` として直接実行された場合のみ main() を走らせる。
// 単体テストが normalizeLiteralNewlines 等を import する際に、意図せず
// main()（Vertex AI呼び出しやファイル書き込みを伴う）が実行されないようにするため。
// import.meta.url は日本語パス（個人 等）を%エンコードするが process.argv[1] は
// 生のUTF-8かつ相対パスのこともあるため、単純な文字列比較ではなく
// fileURLToPath + resolve で正規化してから比較する。
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('記事生成が失敗しました:', err);
    process.exit(1);
  });
}
