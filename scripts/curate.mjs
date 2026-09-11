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

import { generateText } from './lib/vertex.mjs';
import { todayJst } from './lib/date.mjs';
import { checkCitations } from './lib/citation-gate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = join(ROOT, 'data', 'raw');
const POSTS_DIR = join(ROOT, 'site', 'src', 'content', 'posts');

const MIN_THEMES = 3;
const MAX_THEMES = 5;
const MAX_CANDIDATES_FOR_STAGE_A = 60; // トークン節約のため上限を設ける
// Stage Bは「全文に脚注」という指示に対しLLMが従わないことがあり、そのまま
// validate-citations.mjsまで到達すると出典検証ゲートで記事全体の公開が止まる
// （2026-09-10 scheduled run実績: 裏取り率97%で失敗）。checkCitationsによる
// その場での検証と再生成（介護版curate-care.mjsの既存パターンを踏襲）で、
// ゲート自体は緩めずに生成側の成功率を上げる。
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

/**
 * 防御的処理: LLMがまれに実際の改行ではなく文字列としての "\n"（バックスラッシュ+n）を
 * そのまま出力することがあり、本番記事にリテラル文字として表示されるバグが実際に発生した
 * （2026-09-10、Apple関連セクションで発生・修正）。プロンプト遵守に頼らず、
 * 残っていれば実際の改行に正規化する。
 */
export function normalizeLiteralNewlines(text) {
  return text.replace(/\\n/g, '\n');
}

function formatCandidateList(items) {
  return items
    .map((i) => `${i.id} [${i.source}] ${i.title}\n   ${i.summary || '(概要なし)'}`)
    .join('\n');
}

async function runStageA(items) {
  const pool = items.slice(0, MAX_CANDIDATES_FOR_STAGE_A);
  const prompt = [
    'あなたはAI業界の動向を横断的に見る日本語テックブログの編集者です。',
    '以下は本日収集したAI関連ニュース・ハック・話題の候補一覧です（idはそのまま出典IDとして使います）。',
    '',
    `候補から重複や瑣末な話題を避けつつ ${MIN_THEMES}〜${MAX_THEMES} 個のテーマにクラスタリングしてください。`,
    '各テーマには、関連する候補の id を2〜6件、必ず下のリストに実在する id だけを使って sourceIds に入れてください。',
    '同じ id を複数テーマにまたがって使っても構いません。',
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
    'あなたはAI業界の動向を横断的に見る日本語テックブログの筆者です。',
    `見出し「${theme.title}」（${theme.angle}）について、以下の一次情報だけを根拠に本文を書いてください。`,
    '',
    '## 執筆ルール',
    '- 600〜900字。Markdown本文のみ（見出し記号は含めない）',
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

async function runStageB(theme, itemsById) {
  const themeItems = theme.sourceIds.map((id) => itemsById.get(id)).filter(Boolean);
  const validIds = new Set(theme.sourceIds);

  let extraInstructions = [];
  for (let attempt = 1; attempt <= MAX_REGENERATE_ATTEMPTS; attempt++) {
    const prompt = buildStageBPrompt(theme, themeItems, extraInstructions);
    const text = await generateText({ prompt, responseSchema: STAGE_B_SCHEMA, temperature: 0.4 });
    const result = JSON.parse(text);
    result.bodyMarkdown = normalizeLiteralNewlines(result.bodyMarkdown);

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

function slugifyTags(themes) {
  return themes.map((t) => t.title.replace(/[「」『』\s]/g, '').slice(0, 20));
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

/** Markdownテーブルのセルを壊さないよう `|` と改行をエスケープする */
function escapeTableCell(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * テーマ別ソース内訳テーブルを sections（Stage A/Bの検証済み出力）から機械的に組み立てる。
 * LLMには書かせない（＝新たな主張を含まない構造要素）ため、
 * validate-citations.mjs はテーブル行を脚注検証の対象外として扱う設計になっている。
 */
function buildOverviewTable(sections, itemsById) {
  const header = '| # | テーマ | 出典数 | 主な情報源 |\n|---|---|---|---|';
  const rows = sections.map((s, i) => {
    const sourceNames = [...new Set(s.sourceIds.map((id) => itemsById.get(id)?.source).filter(Boolean))];
    const mainSources = sourceNames.slice(0, 3).join(', ') + (sourceNames.length > 3 ? ' 他' : '');
    return `| ${i + 1} | ${escapeTableCell(s.title)} | ${s.sourceIds.length}件 | ${escapeTableCell(mainSources)} |`;
  });
  return ['## 今日のトピック', '', header, ...rows].join('\n');
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
  const themes = await runStageA(items);
  console.log(`Stage A 完了: ${themes.length}テーマ`);
  themes.forEach((t) => console.log(`  - ${t.title} (${t.sourceIds.length}件の出典)`));

  console.log('Stage B: テーマごとに本文生成中...');
  const sections = [];
  for (const theme of themes) {
    const result = await runStageB(theme, itemsById);
    sections.push({ ...theme, ...result });
    console.log(`  ✓ ${theme.title}`);
  }

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
