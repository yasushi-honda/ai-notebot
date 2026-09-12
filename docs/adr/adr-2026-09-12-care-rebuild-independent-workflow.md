# ADR: 介護版だけを独立して手動再生成・デプロイできる workflow を分離する

- 日付: 2026-09-12
- 状態: 確定

## Context

`build-care.mjs`（介護版オーケストレータ）は、Google 検索グラウンディングでヒットした厚労省等の
公式ドメインが PDF 等で本文抽出不能（`no-extractable-text`）な場合、受け入れ基準（official ドメイン
到達性検証済み1件以上）を満たせず、その日の介護記事をスキップする設計になっている
（[adr-2026-09-11-care-hack-grounded-research.md](adr-2026-09-11-care-hack-grounded-research.md) 参照）。
これは意図的な安全側フェイルセーフであり、`daily.yml` の該当ステップも「失敗しても本体の生成・
公開は止めない」設計で常に exit 0 を返す。

2026-09-12 の日次実行でこのフェイルセーフが発火し、介護版記事が生成されなかった。ローカルで
`build-care.mjs` を手動実行して記事自体は生成できたが、これをサイトに公開するには
`npm run build` → コミット → GitHub Pages デプロイが必要であり、既存の `daily.yml` を
`workflow_dispatch` で丸ごと再実行する以外に手段がなかった。しかし `daily.yml` は
`collect.mjs`（AIトレンド版の収集）・`curate.mjs`（記事生成）・`images.mjs`（画像生成）も
同時に実行するため、介護版だけを直したい場合でも AIトレンド版の記事が意図せず再生成され、
既にコミット済みの内容が上書きされてしまう（無駄な LLM API 呼び出しコストも発生する）。

## Decision

`.github/workflows/care-rebuild.yml` を新設し、介護版（`build-care.mjs` 以降のビルド・
コミット・デプロイ）だけを独立して `workflow_dispatch` で手動実行できるようにした。
`regenerate`（boolean, default true）と `date`（string, optional）の2つの入力を持つ:

- `regenerate=true`: `build-care.mjs <date>` を実行し、収集からやり直す（同日中に複数回
  リトライしたいケース）。
- `regenerate=false`: 既にコミット済みの `data/raw-care/` と `site/src/content/care/` の
  内容をそのまま使い、サイト全体（AIトレンド版含む）を再ビルドしてデプロイするだけを行う
  （ローカルで手動生成してコミット済みの記事を、CI 経由で公開するだけのケース）。

`build-care.mjs` の再収集ロジック（フェイルセーフ・スナップショット復元機構）自体は変更していない。

## Rationale

- `daily.yml` を条件分岐で「介護版だけ実行するモード」に拡張する案もあったが、
  AIトレンド版と介護版の commit ステップ・concurrency グループが密結合しており、
  条件分岐が増えるほど「今動いているどの分岐が」を読み解くコストが上がる。独立ファイルに
  分離した方が、それぞれの workflow が「何をする workflow か」を一目で説明できる。
- `regenerate=false` モードを設けたのは、CSS 等サイト全体に関わる変更（見出しスタイル等）を
  介護版データの再生成を経由せず即座に本番へ反映したいケースにも使えるようにするため
  （2026-09-12 セッション内で実際にこの用途で使用し、動作確認済み）。
- workflow input（`date`）をシェルコマンドに直接埋め込むと command injection のリスクが
  あるため、`env:` 経由で受け渡し、日付解決を専用ステップ（`Resolve target date`）に分離した
  （`??` は空文字列を nullish と見なさないため、`build-care.mjs` に空文字列がそのまま渡ると
  `todayJst()` へのフォールバックが効かないバグを避ける意図もある）。
- `concurrency.group` は `daily.yml` と同じ `daily-digest` を使う（初版では独立した
  `care-rebuild` グループにしていたが、`codex review` で「手動 rebuild と daily.yml の
  定期実行が重なると、両方が同じブランチへ push・Pages デプロイを試み、非 fast-forward
  失敗や新しいデプロイが古い artifact に上書きされるレースコンディションが起きる」と
  指摘され修正した）。

## Consequences

- workflow ファイルが1つ増え、`daily.yml` と `care-rebuild.yml` のどちらが何を担当するかを
  把握しておく必要がある（コメントで明記済み）。
- 将来 AIトレンド版側にも同様の「単体だけ再生成・デプロイしたい」ニーズが出た場合、
  同じパターン（`regenerate` フラグ + `Resolve target date` ステップ）を踏襲できる。
