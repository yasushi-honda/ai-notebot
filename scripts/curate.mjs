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
import { dirname, join } from 'node:path';

import { generateText } from './lib/vertex.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = join(ROOT, 'data', 'raw');
const POSTS_DIR = join(ROOT, 'site', 'src', 'content', 'posts');

const MIN_THEMES = 3;
const MAX_THEMES = 5;
const MAX_CANDIDATES_FOR_STAGE_A = 60; // トークン節約のため上限を設ける

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
        'このテーマの本文（Markdown、600〜900字）。事実を述べる文には必ず文末に [^s-<id>] 形式の脚注を付け、' +
        '与えられたid以外は絶対に使わないこと。見出し(#)は含めず本文のみ。',
    },
    imagePromptEn: {
      type: 'string',
      description: 'このテーマの内容を象徴する画像の生成プロンプト（英語、1〜2文、具体的な構図・スタイル指定を含む）',
    },
  },
  required: ['bodyMarkdown', 'imagePromptEn'],
};

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

async function runStageB(theme, itemsById) {
  const themeItems = theme.sourceIds.map((id) => itemsById.get(id)).filter(Boolean);
  const prompt = [
    'あなたはAI業界の動向を横断的に見る日本語テックブログの筆者です。',
    `見出し「${theme.title}」（${theme.angle}）について、以下の一次情報だけを根拠に本文を書いてください。`,
    '',
    '## 執筆ルール',
    '- 600〜900字。Markdown本文のみ（見出し記号は含めない）',
    '- 事実に基づく文には必ず文末に [^s-<id>] の形式で出典を付ける（下のリストのidのみ使用可）',
    '- 出典のない推測や一般論の断定は避ける。あくまで下の情報に基づいて書く',
    '- ノンエンジニアにも伝わる平易な日本語。専門用語は短く補足する',
    '',
    '## 参照可能な一次情報',
    formatCandidateList(themeItems),
  ].join('\n');

  const text = await generateText({ prompt, responseSchema: STAGE_B_SCHEMA, temperature: 0.4 });
  return JSON.parse(text);
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

async function main() {
  const dateArg = process.argv[2] ?? new Date().toISOString().slice(0, 10);
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

  const bodyParts = sections.map((s) => `## ${s.title}\n\n${s.bodyMarkdown}`);
  const footnotes = buildFootnoteDefs(usedIds, itemsById);
  const totalChars = bodyParts.join('').replace(/[#\s]/g, '').length;

  const frontmatter = [
    '---',
    `title: "${dateArg} のAIトレンド"`,
    `date: "${dateArg}"`,
    `description: "${themes.map((t) => t.title).join(' / ')}"`,
    `tags: [${slugifyTags(themes).map((t) => `"${t}"`).join(', ')}]`,
    `sourceIds: [${[...usedIds].map((id) => `"${id}"`).join(', ')}]`,
    `heroImagePrompt: ${JSON.stringify(
      `Flat-design tech blog hero illustration summarizing today's AI trends: ${themes.map((t) => t.angle).join('; ')}. Clean, modern, blue and white palette, 16:9.`,
    )}`,
    `sectionImagePrompts:`,
    ...sections.slice(0, 2).map((s) => `  - ${JSON.stringify(s.imagePromptEn)}`),
    '---',
    '',
  ].join('\n');

  const markdown = frontmatter + bodyParts.join('\n\n') + '\n\n## この記事の出典\n\n' + footnotes + '\n';

  await mkdir(POSTS_DIR, { recursive: true });
  const outPath = join(POSTS_DIR, `${dateArg}.md`);
  await writeFile(outPath, markdown, 'utf8');

  console.log(`site/src/content/posts/${dateArg}.md を書き出しました（本文約${totalChars}字 / 脚注${usedIds.size}件）`);
}

main().catch((err) => {
  console.error('記事生成が失敗しました:', err);
  process.exit(1);
});
