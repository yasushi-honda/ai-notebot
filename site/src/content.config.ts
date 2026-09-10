import { defineCollection } from 'astro:content';
import { z } from 'astro:schema';
import { glob } from 'astro/loaders';

/**
 * 日次記事コレクション。frontmatter は scripts/curate.mjs が機械生成する。
 * ファイル名（拡張子除く）が日付（YYYY-MM-DD）そのものになる。
 */
const posts = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    description: z.string().min(1),
    tags: z.array(z.string()).default([]),
    /** 加工前のテーマ見出し（tagsは文字数制限等で欠けることがあるため、
     *  シェアテキスト等で元の見出しが必要な用途向けに別途保持） */
    themeTitles: z.array(z.string()).default([]),
    /** 本文の脚注が引用する出典 id（data/raw/<date>.json の id と対応） */
    sourceIds: z.array(z.string()).default([]),
    heroImagePrompt: z.string().optional(),
  }),
});

export const collections = { posts };
