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
    /** ホームの「本日の記録」一覧に表示するテーマ別出典件数。本フィールド追加前の記事には
     *  存在しないため default([]) になり、その場合は themeTitles（件数なし）にフォールバックする */
    themes: z.array(z.object({ title: z.string(), sourceCount: z.number() })).default([]),
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

/**
 * 週刊AIトレンドまとめコレクション。frontmatter は scripts/curate-weekly.mjs が機械生成する。
 * ファイル名（拡張子除く）は「週の開始日」（weekStart。通常は前の日曜、cronは日曜のみ発火
 * するため）。公開日ではない（公開日をスラッグにすると手動再実行のたびに同じ週の記事が
 * 別URLで重複生成されるため）。scripts/lib/date.mjsのweeklyWindow()自体は曜日非依存の
 * ため、workflow_dispatchでの手動実行に日曜以外の日付を渡すとweekStartも日曜以外になり
 * うる（curate-weekly.mjsが警告を出す。詳細: docs/adr/adr-2026-09-14-weekly-digest.md）。
 */
const weekly = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/weekly' }),
  schema: z.object({
    title: z.string().min(1),
    /** 一覧の日付ソート・ルーティングは全てこのフィールドを使う（postsの`date`に相当）。
     *  posts/careと違い`date`という名前にしなかったのは、週次記事には「対象週の開始日」
     *  「対象週の終了日」「実際の公開日」の3つの日付概念があり、単なる`date`では
     *  どれを指すか曖昧になるため（pr-review-toolkitの型設計レビューで指摘・修正:
     *  当初`date`フィールドも重複して持たせていたが、どのページからも参照されない
     *  死んだフィールドだったため削除した）。 */
    weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    weekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** 実際に生成が実行された日（週の一部が欠けていても記録として残す） */
    publishedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    description: z.string().min(1),
    themeTitles: z.array(z.string()).default([]),
    themes: z.array(z.object({ title: z.string(), sourceCount: z.number() })).default([]),
    /** 本文の脚注が引用する出典 id（該当週の data/raw/<date>.json の id と対応） */
    sourceIds: z.array(z.string()).default([]),
    /** 実在した日次記事の日付（5〜7件）。validate-citations.mjs --type=weekly が
     *  weeklyWindow() の再計算結果との整合性を検査する対象 */
    sourceDates: z.array(z.string()).default([]),
    /** OGP/Twitter Card用に使い回す日次記事の hero.jpg の日付（新規画像生成はしない） */
    ogImageDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
});

export const collections = { posts, care, weekly };
