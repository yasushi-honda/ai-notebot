#!/usr/bin/env node
/**
 * ③ 画像生成スクリプト。
 * site/src/content/posts/<date>.md の frontmatter（heroImagePrompt）を
 * gemini-3.1-flash-lite-image（Nano Banana 2 Lite）に投げ、
 * hero(16:9) 1枚を site/public/images/<date>/ に生成する。
 * あわせて「今日のトピック一覧」SVG図解（Vertex AI不使用・決定的生成）も生成する。
 *
 * 画像生成の失敗は記事本文の公開を止めない設計: 失敗した画像は SVG プレースホルダに
 * フォールバックする（詳細: docs/adr/）。
 *
 * 使い方: GEMINI_ACCESS_TOKEN=... node scripts/images.mjs [YYYY-MM-DD]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseFrontmatter } from './lib/frontmatter.mjs';
import { generateImage } from './lib/vertex.mjs';
import { todayJst } from './lib/date.mjs';
import { buildOverviewSvg } from './lib/svg-diagram.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = join(ROOT, 'site', 'src', 'content', 'posts');
const IMAGES_DIR = join(ROOT, 'site', 'public', 'images');

const MAX_BYTES = 400 * 1024; // AC-3: 各画像400KB以下

function placeholderSvg(label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <rect width="1200" height="675" fill="#eef2ff"/>
  <text x="600" y="337" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#6366f1">${label}</text>
</svg>`;
}

async function generateOne(prompt, aspectRatio, outPathNoExt, label) {
  try {
    const { bytes } = await generateImage({ prompt, aspectRatio });
    if (bytes.length > MAX_BYTES) {
      console.warn(`⚠ ${label}: ${bytes.length}バイトでサイズ上限(${MAX_BYTES})を超過。プレースホルダに切替`);
      throw new Error('oversize');
    }
    // site側のテンプレートは <name>.jpg → (404時) <name>.svg のみを参照するため、
    // 実際に返ってきたmimeTypeに関わらず常に .jpg で保存する（.png保存だと site が
    // 参照しないURLになり永久に壊れた画像になる。codex reviewで指摘・修正。
    // 実測ではVertex AIは一貫してimage/jpegを返している）
    const outPath = `${outPathNoExt}.jpg`;
    await writeFile(outPath, bytes);
    console.log(`✓ ${label}: ${outPath} (${bytes.length.toLocaleString()} bytes)`);
    return outPath;
  } catch (err) {
    console.warn(`✗ ${label}: 画像生成失敗（${err.message}）。SVGプレースホルダを使用`);
    const outPath = `${outPathNoExt}.svg`;
    await writeFile(outPath, placeholderSvg(label));
    return outPath;
  }
}

async function main() {
  const dateArg = process.argv[2] ?? todayJst();
  const postPath = join(POSTS_DIR, `${dateArg}.md`);

  let markdown;
  try {
    markdown = await readFile(postPath, 'utf8');
  } catch (err) {
    console.error(`記事ファイルが読めません: ${postPath}\n  ${err.message}`);
    process.exit(1);
  }

  const { frontmatter, body } = parseFrontmatter(markdown);
  const heroPrompt = frontmatter.heroImagePrompt;

  if (!heroPrompt) {
    console.error('frontmatter に heroImagePrompt がありません。');
    process.exit(1);
  }

  const outDir = join(IMAGES_DIR, dateArg);
  await mkdir(outDir, { recursive: true });

  const results = [];
  results.push(await generateOne(heroPrompt, '16:9', join(outDir, 'hero'), 'hero'));

  // 「今日のトピック一覧」SVG図解。本文の ## 見出し（curate.mjs のテーブル見出し
  // 「今日のトピック」を除く）から決定的に生成する。Vertex AI を呼ばないため
  // 失敗しようがなく、追加コストもハルシネーションリスクもゼロ。
  const themeTitles = [...body.matchAll(/^## (.+)$/gm)]
    .map((m) => m[1].trim())
    .filter((title) => title !== '今日のトピック');
  if (themeTitles.length > 0) {
    const svg = buildOverviewSvg(themeTitles.map((title) => ({ title })));
    const overviewPath = join(outDir, 'overview.svg');
    await writeFile(overviewPath, svg, 'utf8');
    console.log(`✓ overview: ${overviewPath}（${themeTitles.length}テーマ）`);
    results.push(overviewPath);
  } else {
    console.warn('✗ overview: 本文から ## 見出しが見つかりませんでした。図解生成をスキップします。');
  }

  console.log(`画像生成完了: ${results.length}件 → ${outDir}`);
}

main().catch((err) => {
  console.error('画像生成処理が失敗しました:', err);
  process.exit(1);
});
