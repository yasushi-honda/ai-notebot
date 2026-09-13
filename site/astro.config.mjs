// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import pagefind from 'astro-pagefind';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://yasushi-honda.github.io',
  base: '/ai-notebot',
  trailingSlash: 'ignore',
  // sitemap.xmlはGoogle等の検索エンジンにページの存在を発見させるための標準的な仕組み。
  // このサイトはGoogleに一度もクロール・インデックスされていないことが判明しており
  // （`site:yasushi-honda.github.io`のWeb検索で0件。2026-09-13実データで確認）、
  // Google Chatのリンクプレビュー画像がGoogleの検索・画像インデックス状況に依存している
  // 可能性が高いと分かったため追加した。sitemapの送信をping（www.google.com/ping）で
  // 能動通知する方式は2023年に廃止済み・2026年8月時点で404になることをWebSearchで確認
  // 済みのため使わない（公式に存在しないメカニズムを前提にした設計をしない方針）。
  // robots.txt経由での発見とGoogle Search Consoleでの手動送信（人間側の作業）が現行の
  // 正規の経路。
  integrations: [pagefind(), sitemap()],
  markdown: {
    // GFM footnotes（[^id] / [^id]: ...）の自動生成セクションを日本語化する
    remarkRehype: {
      footnoteLabel: 'この記事の出典',
      footnoteBackLabel: '本文へ戻る',
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
