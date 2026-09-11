# ADR: 決定的生成SVG画像図解（overview.svg / steps.svg）を廃止し、ネイティブHTML/CSSに一本化する

- 日付: 2026-09-11
- 状態: 確定

## Context

AIトレンド版の「今日のトピック一覧」図解（`scripts/lib/svg-diagram.mjs` が生成する
`overview.svg`）と、介護版の「手順フロー」図解（`scripts/lib/care-svg.mjs` が生成する
`steps.svg`）は、いずれも固定キャンバス幅（480〜1200 viewBox単位）のSVGを Vertex AI 不使用で
決定的に生成し、`<img>` として記事本文の上に別途表示していた。

このうち `steps.svg` について、SVG内部のテキスト折り返し幅（`CHARS_PER_LINE`）が実際の
利用可能幅を使い切っておらず、記事コンテナ幅までCSSで拡大表示された結果、右側に大きな
内在的な余白ができるバグが発生した。`CHARS_PER_LINE` を16→22に上げて当日分の記事だけ
再生成したが、**過去に生成済みでコミット済みの静的SVGファイルは直っていなかった**ため、
「中途半端な修正」との指摘を受けた（該当ユーザーフィードバックはセッションログ参照）。

調査の結果、これら2つのSVG画像は**記事本文に既に存在する情報を、固定キャンバスへの
二重描画として繰り返しているだけ**であることが判明した:

- `steps.svg`: 内容は本文「## 手順」の番号付きリスト（`global.css` の `.prose-care ol` で
  既にネイティブHTML/CSS描画されている）と完全に同一。
- `overview.svg`: 内容は本文冒頭のテーマ別ソース内訳テーブル
  （`scripts/curate.mjs` の `buildOverviewTable()` が機械生成、`.prose-post table` で
  既にネイティブHTML/CSS描画されている）と完全に同一。

固定キャンバスをCSSで拡大表示する構造である限り「内在的な余白」「折り返し位置のズレ」という
バグクラスは今後も再発しうる上、修正のたびに過去記事分の画像再生成（バックフィル）という
運用コストが発生し続ける。

## Decision

1. `scripts/lib/svg-diagram.mjs`・`scripts/lib/care-svg.mjs`・両者が共有する
   `scripts/lib/text-wrap.mjs`（この2ファイル専用のため道連れで削除）と、それぞれの
   テストファイルを削除する。
2. `scripts/images.mjs` から `overview.svg` の生成呼び出しを削除する（hero.jpg生成は維持）。
   `scripts/curate-care.mjs` から `steps.svg` の生成呼び出しを削除する。
3. `site/src/pages/posts/[date]/index.astro` / `site/src/pages/care/[date]/index.astro` から
   対応する `<img>` タグを削除する。表示手段は本文中の既存のネイティブHTML要素
   （テーブル／番号付きリスト）に一本化する。
4. コミット済みの `overview.svg` / `steps.svg` アセット（3+2ファイル）を `git rm` する
   （git履歴からは復元可能）。

## Consequences

- 幅は常に記事コンテナ幅（CSSの `max-width` とビューポート）に追従するため、固定キャンバス
  起因の余白・折り返しズレというバグクラスが構造的に発生しなくなる。
- 過去記事も含め、ページを開くたびに最新のCSSでレンダリングされるため、デザイン変更時の
  画像バックフィル作業が今後一切不要になる（今回のインシデントの再発防止）。
- `adr-2026-09-10-citation-gate-blocks-publish.md` の「テーブル・SVG図解は新たな主張を
  追加しない再表示」という記述のうち、SVG図解に関する部分は本ADRにより実装上は置き換えられる
  （テーブル自体・脚注検証の免除方針は変更なし。ネイティブHTML化しても「LLMが新たに生成する
  主張ではなく既存検証済みデータの再表示」という脚注検証免除の理由は変わらないため、
  `validate-citations.mjs` は無改修）。
- `themes`（テーマ別出典件数）をホームの「本日の記録」一覧に表示するため、
  `scripts/curate.mjs` の frontmatter に `themes: [{title, sourceCount}]` を追加し、
  `site/src/content.config.ts` の `posts` スキーマに対応するフィールドを追加した
  （`default([])` のため、本フィールド追加前の既存記事は `themeTitles`（件数なし表示）に
  自動的にフォールバックする）。
