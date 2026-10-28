/**
 * 特性テスト用の fetch スタブ（`node --import <このファイル>` で preload する）。
 * collect.mjs / curate.mjs 等を実ネットワーク・実 Vertex AI なしで end-to-end 実行し、
 * 共通化リファクタの前後で出力（アーカイブ JSON・記事 Markdown・LLM へ送ったプロンプト）が
 * 完全に同一であることを固定するために使う。応答は入力から決定的に作る。
 *
 * - RSS: scripts/lib/feeds.mjs の各フィード URL に、決定的な RSS 2.0 を返す（STUB_RSS_DATE を基準日に使う）。
 *   それ以外の URL（HN・Reddit・arXiv・GitHub 等）は 404 を返し、API 収集器の失敗経路を通す。
 * - Vertex AI: プロンプトの内容から Stage A / Stage B の応答を作る。
 *     Stage B は「見出し『…』」のテーマ名で振る舞いを変える。
 *       テーマ名に「再生成」を含む: 初回は脚注のない文を返し（再生成ループを通す）、修正指示付きの2回目で正常に返す
 *       テーマ名に「除外」を含む: 常に脚注のない文を返す（再生成を使い切ってテーマが除外される）
 * - STUB_LOG に、Vertex AI へ送ったリクエスト（prompt と temperature）を JSON Lines で追記する。
 */
import { appendFileSync } from 'node:fs';
import { RSS_FEEDS, SECURITY_FEEDS_FOR_STUB } from './stub-feeds.mjs';

const realFetch = globalThis.fetch;

function rssXml(feedIndex) {
  const base = new Date(`${process.env.STUB_RSS_DATE}T00:00:00Z`).getTime();
  const items = [];
  for (let i = 0; i < 10; i++) {
    const date = new Date(base + (12 - i) * 3600 * 1000).toUTCString(); // 基準日 12:00Z から1時間ずつ古く
    // 重複排除の経路: フィード0と1の i=0 は同じ URL
    const url = i === 0 && feedIndex <= 1 ? 'https://example.test/shared' : `https://example.test/f${feedIndex}/i${i}`;
    items.push(`<item><title>feed${feedIndex} item${i}</title><link>${url}</link><pubDate>${date}</pubDate><description>feed${feedIndex} 要約${i}</description></item>`);
  }
  // 鮮度フィルタの経路: 古すぎる項目
  items.push(`<item><title>feed${feedIndex} old</title><link>https://example.test/f${feedIndex}/old</link><pubDate>Mon, 01 Jan 2096 00:00:00 GMT</pubDate><description>古い</description></item>`);
  return `<?xml version="1.0"?><rss version="2.0"><channel>${items.join('')}</channel></rss>`;
}

function jsonResponse(obj) {
  return { ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) };
}

function stageAResponse(prompt) {
  const ids = [...prompt.matchAll(/^(s-[0-9a-f]+) \[/gm)].map((m) => m[1]);
  const titles = ['テーマ甲', 'テーマ乙再生成', 'テーマ丙', 'テーマ丁除外'];
  return {
    themes: titles.map((title, k) => ({
      title,
      angle: `${title}の観点`,
      sourceIds: [...ids.slice(k * 2, k * 2 + 3), 's-ffffffffff'], // 実在しない id も混ぜ、絞り込みの経路を通す
    })),
  };
}

function stageBResponse(prompt) {
  const title = prompt.match(/見出し「(.+?)」/)?.[1] ?? '';
  const ids = [...prompt.matchAll(/^(s-[0-9a-f]+) \[/gm)].map((m) => m[1]);
  const cite = ids.map((id) => `[^${id}]`).join('');
  const retryNote = prompt.includes('重要な修正指示');
  const good = `${title}の導入です${cite}。\n\n**重要語**について説明します${cite}。\n\n- 項目の説明です${cite}。`;
  const bad = `${title}の導入です${cite}。\n\n脚注のない文です。`;
  if (title.includes('除外')) return { bodyMarkdown: bad };
  if (title.includes('再生成') && !retryNote) return { bodyMarkdown: bad };
  return { bodyMarkdown: good };
}

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('aiplatform.googleapis.com')) {
    const body = JSON.parse(init.body);
    const prompt = body.contents[0].parts[0].text;
    if (process.env.STUB_LOG) {
      appendFileSync(process.env.STUB_LOG, JSON.stringify({ prompt, temperature: body.generationConfig.temperature }) + '\n');
    }
    const payload = prompt.includes('## 参照可能な一次情報') ? stageBResponse(prompt) : stageAResponse(prompt);
    return jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] });
  }
  const feedIndex = RSS_FEEDS.findIndex((f) => f.urls.includes(u));
  if (feedIndex >= 0 && process.env.STUB_RSS_DATE) {
    const xml = rssXml(feedIndex);
    return { ok: true, status: 200, text: async () => xml };
  }
  const extra = SECURITY_FEEDS_FOR_STUB.findIndex((f) => f.urls.includes(u));
  if (extra >= 0 && process.env.STUB_RSS_DATE) {
    const xml = rssXml(100 + extra);
    return { ok: true, status: 200, text: async () => xml };
  }
  return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
};

export { realFetch };
