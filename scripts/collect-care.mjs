#!/usr/bin/env node
/**
 * 介護版①: 収集スクリプト。
 * Vertex AI の Google 検索グラウンディング（scripts/lib/vertex.mjs の generateGroundedText）を使い、
 * 「介護現場の業務をAIで効率化する、公式情報で裏付けの取れる具体的な方法」を1つ調査させる。
 *
 * グラウンディングのレスポンスは実URLではなくリダイレクトURLしか含まないため（約30日で失効。
 * 公式ドキュメントで確認済み）、各ソースを実際にfetchして実URL・到達性を検証してから
 * data/raw-care/<date>.json に保存する。到達できないソースは破棄する。
 *
 * 受け入れ基準（満たさなければ exit 1。呼び出し元の build-care.mjs はこれを「今日は介護記事を
 * 出さない」判断に使う。ハルシネーション遮断のためのゲートを緩めるのではなく、
 * 材料が薄い日は公開しない設計）:
 *   - 到達性検証済みソースが3件以上
 *   - うち1件以上が official ドメイン（*.go.jp 等。scripts/lib/source-tier.mjs）
 *
 * 使い方: GEMINI_ACCESS_TOKEN=... node scripts/collect-care.mjs [YYYY-MM-DD]
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { generateGroundedText } from './lib/vertex.mjs';
import { todayJst } from './lib/date.mjs';
import { makeId, normalizeUrl } from './lib/source-id.mjs';
import { resolveSource, sanitizeTitle } from './lib/source-resolver.mjs';
import { classifySourceTier } from './lib/source-tier.mjs';
import { parseFrontmatter } from './lib/frontmatter.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_CARE_DIR = join(ROOT, 'data', 'raw-care');
const CARE_POSTS_DIR = join(ROOT, 'site', 'src', 'content', 'care');

const MIN_RESOLVED_SOURCES = 3;
const RECENT_TOPICS_LOOKBACK = 14; // 直近何件の既出記事を「避けるべきテーマ」としてLLMに渡すか

async function loadRecentTopics() {
  let files;
  try {
    files = await readdir(CARE_POSTS_DIR);
  } catch {
    return [];
  }
  const mdFiles = files.filter((f) => f.endsWith('.md')).sort().reverse().slice(0, RECENT_TOPICS_LOOKBACK);
  const topics = [];
  for (const f of mdFiles) {
    try {
      const markdown = await readFile(join(CARE_POSTS_DIR, f), 'utf8');
      const { frontmatter } = parseFrontmatter(markdown);
      if (frontmatter.title) topics.push(frontmatter.title);
    } catch {
      // 壊れたファイルは無視
    }
  }
  return topics;
}

function buildPrompt(recentTopics) {
  const avoidance =
    recentTopics.length > 0
      ? `\n\n## 直近で既に取り上げたテーマ（重複を避けること）\n${recentTopics.map((t) => `- ${t}`).join('\n')}`
      : '';

  return [
    'あなたは介護福祉分野のDX専門アドバイザーです。',
    '訪問介護・通所介護（デイサービス）・施設入所（特養・老健等）・居宅介護支援（ケアマネジメント）・',
    '小規模多機能型・短期入所（ショートステイ）など、介護サービス全般の現場で日々発生する業務',
    '（事務・記録、請求・給付管理、シフト・労務管理、送迎、ケアプラン作成、職員間の情報共有、',
    '家族対応、教育・研修など）のうち、AIを活用して具体的に効率化できる方法を1つ、Google検索で',
    '調べてください。',
    '',
    '## 調査の条件',
    '- 一般論ではなく、実際に現場で今日から検討できる具体的な方法であること',
    '- 取り上げる方法は、Google Workspace（スプレッドシート・ドキュメント・フォーム等）・Gemini・',
    '  ChatGPT・Claude（Claude Codeを含む）など、一般に広く使われている汎用AIツール・サービスを',
    '  使ったやり方を優先的に探すこと。特定の介護専用商用SaaS製品（見守りセンサー連携アプリ・',
    '  介護記録専用AIアプリ等）の紹介・宣伝になるテーマは避けること',
    '- 厚生労働省・自治体・介護保険関連の公的機関、デジタル庁等が公開している生成AI活用の',
    '  ガイドライン等、裏付けとなる公式・信頼できる情報源が存在するテーマを選ぶこと',
    '- 特定の営利企業の宣伝文句をそのまま信じるのではなく、制度・実務として妥当かを確認すること',
    avoidance,
    '',
    '調査した内容を、見つけた情報源に基づいて簡潔に要約してください（後続の記事執筆で使う下調べ',
    'のためのメモなので、厳密な文章構成は不要です）。',
  ].join('\n');
}

/**
 * 1回目の調査で official ドメイン（*.go.jp 等）が1件も見つからなかった場合に、
 * 同じテーマの裏付けとなる公的機関の情報だけを狙って絞り込む2回目の検索プロンプト。
 * 実運用では「厚生労働省」等をキーワードに含めても、Google検索が優先的に返すのは
 * ベンダーブログ等の web ドメインであることが多く実測で確認済みのため、
 * 1回で official が見つからないことは珍しくない（想定内の挙動としてフォールバックする）。
 */
function buildOfficialFollowupPrompt(researchSummary) {
  return [
    '以下は、介護現場のAI活用について調べた下調べメモです。',
    '',
    researchSummary,
    '',
    'この内容の裏付けとなる、厚生労働省・デジタル庁・自治体・介護保険関連の公的機関（ドメインが',
    'go.jp や lg.jp など）が公開している一次情報を、Google検索で探してください。ベンダーブログや',
    '商用メディアの記事ではなく、公的機関自身が発行している制度解説・通知・ガイドライン・統計等を',
    '優先すること。特に、Google Workspace・Gemini・ChatGPT・Claude等の生成AIツールの業務利用に',
    '関する公的機関のガイドライン・手引き・注意事項があれば、それも有力な候補として探すこと。',
  ].join('\n');
}

async function resolveChunks(groundingChunks, seenUrls, items) {
  const webChunks = groundingChunks.filter((c) => c.web?.uri);
  for (const chunk of webChunks) {
    const resolved = await resolveSource(chunk.web.uri);
    if (!resolved.ok) {
      const reason = resolved.reason ?? `status=${resolved.httpStatus ?? 'N/A'}`;
      console.warn(`✗ 採用不可: ${chunk.web.title || chunk.web.uri}（${reason}）`);
      continue;
    }
    const key = normalizeUrl(resolved.url);
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);

    // resolved.title は resolveSource() 内で既に正規化済みだが、chunk.web.title / resolved.url を
    // フォールバックとして使う経路もあるため、最終的な title は必ずここでも正規化する
    // （多層防御。resolveSource側の正規化だけに依存しない）。
    const title = sanitizeTitle(resolved.title || chunk.web.title || resolved.url);
    const tier = classifySourceTier(resolved.url);
    let hostname = chunk.web.title || resolved.url;
    try {
      hostname = new URL(resolved.url).hostname;
    } catch {
      // URLとして不正な場合はそのまま
    }

    items.push({
      id: makeId(resolved.url),
      source: hostname,
      sourceType: 'web',
      title,
      url: resolved.url,
      publishedAt: new Date().toISOString(),
      summary: resolved.excerpt.slice(0, 400),
      tier,
      httpStatus: resolved.httpStatus,
      checkedAt: new Date().toISOString(),
    });
    console.log(`✓ [${tier}] ${title} — ${resolved.url}`);
  }
}

async function main() {
  const dateArg = process.argv[2] ?? todayJst();

  const recentTopics = await loadRecentTopics();
  const prompt = buildPrompt(recentTopics);

  console.log('Google検索グラウンディングで介護DXテーマを調査中...');
  const first = await generateGroundedText({ prompt });
  console.log(`調査クエリ: ${first.webSearchQueries.join(' / ') || '(なし)'}`);
  console.log(`groundingChunks: ${first.groundingChunks.length}件`);

  const seenUrls = new Set();
  const items = [];
  let webSearchQueries = [...first.webSearchQueries];
  // 検索候補チップの表示義務（利用規約）は、記事の裏付けに使われた検索結果を返した
  // 全ての検索呼び出しに対して発生する。1回目のチップだけを残して2回目（official限定の
  // 追加検索）のチップを捨てると、追加検索で見つかった出典が記事に採用された場合に
  // 対応するチップが表示されない状態になる（codex reviewで指摘・修正）。両方を保持し連結する。
  const searchEntryPointHtmlParts = [first.searchEntryPointHtml].filter(Boolean);

  await resolveChunks(first.groundingChunks, seenUrls, items);

  let officialCount = items.filter((i) => i.tier === 'official').length;

  if (officialCount < 1) {
    console.log('official ドメインが見つからなかったため、公的機関限定の追加検索を行います...');
    const followup = await generateGroundedText({ prompt: buildOfficialFollowupPrompt(first.text) });
    webSearchQueries = [...webSearchQueries, ...followup.webSearchQueries];
    if (followup.searchEntryPointHtml) searchEntryPointHtmlParts.push(followup.searchEntryPointHtml);
    await resolveChunks(followup.groundingChunks, seenUrls, items);
    officialCount = items.filter((i) => i.tier === 'official').length;
  }

  const searchEntryPointHtml = searchEntryPointHtmlParts.join('\n');

  console.log(`到達性検証済み: ${items.length}件（うち official: ${officialCount}件）`);

  if (items.length < MIN_RESOLVED_SOURCES || officialCount < 1) {
    console.error(
      `検証失敗: 到達性検証済みソースが不足しています（${items.length}件、要${MIN_RESOLVED_SOURCES}件以上・` +
        `official ${officialCount}件、要1件以上）。data/raw-care は更新しません。`,
    );
    process.exit(1);
  }

  await mkdir(RAW_CARE_DIR, { recursive: true });
  const payload = {
    date: dateArg,
    collectedAt: new Date().toISOString(),
    // researchSummary はグラウンディングされていないLLMの要約メモ（デバッグ・人間の確認用）。
    // curate-care.mjs はこれを記事執筆の材料として使わない（無出典の主張が紛れ込むのを防ぐため、
    // 使うのは到達性検証済みの items のみ）。
    researchSummary: first.text,
    webSearchQueries,
    searchEntryPointHtml,
    items,
  };
  await writeFile(join(RAW_CARE_DIR, `${dateArg}.json`), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`data/raw-care/${dateArg}.json を書き出しました（${items.length}件）`);
}

import { resolve } from 'node:path';
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('介護版の収集処理が失敗しました:', err);
    process.exit(1);
  });
}
