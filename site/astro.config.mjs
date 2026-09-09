// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import pagefind from 'astro-pagefind';

// https://astro.build/config
export default defineConfig({
  site: 'https://yasushi-honda.github.io',
  base: '/ai-notebot',
  trailingSlash: 'ignore',
  integrations: [pagefind()],
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
