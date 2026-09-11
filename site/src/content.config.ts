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

/**
 * 介護業界向け「今日のAI活用ハック」日次記事コレクション。frontmatter は
 * scripts/curate-care.mjs が機械生成する。メタ情報は全てenumのみ（自由記述を許さず、
 * ハルシネーションの余地をなくす設計。scripts/curate-care.mjs の TARGET_SERVICES/
 * WORK_AREAS/DIFFICULTIES と同期させること）。
 */
const care = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/care' }),
  schema: z.object({
    title: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    summary: z.string().min(1),
    targetServices: z
      .array(z.enum(['訪問介護', '通所介護', '施設', '居宅介護支援', '小規模多機能', '短期入所', '全サービス共通']))
      .min(1),
    workArea: z.enum(['事務・記録', '請求・給付管理', 'シフト・労務', '送迎', 'ケアプラン', '情報共有', '家族対応', '教育・研修']),
    difficulty: z.enum(['すぐできる', '準備が必要', '要検討']),
    /** 本文の脚注が引用する出典 id（data/raw-care/<date>.json の id と対応） */
    sourceIds: z.array(z.string()).default([]),
    /** Google検索の検索候補チップ（利用規約上、グラウンディング結果を公開する際は
     *  改変せず表示する義務がある。空文字はチップなし＝検索候補が付かなかった生成） */
    searchEntryPointHtml: z.string().default(''),
  }),
});

export const collections = { posts, care };
