# ADR: 週刊AIトレンドまとめを独立パイプラインとして追加する

- 日付: 2026-09-14
- 状態: 確定

## Context

decision-maker から「毎週前週分のまとめ記事を定期発行したい」という要望があった。対象は
AIトレンド版（`posts`）のみで、既存記事へのリンク集ではなく LLM による新規の週間サマリー
生成とし、既存のハルシネーション遮断ゲート（`validate-citations.mjs`、裏取り率100%・
未解決0件）は週次記事にも同等に適用する、という3点が確定要件だった。

日次パイプラインをそのまま7日分繰り返すだけでは成立しない設計上の壁が3つあった:

1. `data/raw/<date>.json` は1日約60件あり、7日分（約430件）をそのまま Stage A のクラスタ
   リングに投げるのはトークン量・ハルシネーションリスクの両面で日次版より緩い検証しかできない。
2. 出典検証（`checkCitations`）は1つの日付＝1つのアーカイブを前提にした薄いCLIラッパー
   （`validate-citations.mjs`）越しに呼ばれており、複数日にまたがる週次記事にそのまま使えない。
3. 日次記事は1日単位のスラッグ（`YYYY-MM-DD.md`）だが、週次記事は「公開日」と「対象期間」の
   2つの日付概念を持ち、同じ考え方をそのまま流用すると再実行時の冪等性が壊れる。

## Decision

### 候補プールは「日次記事が実際に引用した出典」に限定する

`scripts/curate-weekly.mjs` は `data/raw/*.json` の全件ではなく、対象週の各日の
`site/src/content/posts/<date>.md` の frontmatter（`sourceIds`）だけをプールにする。

実測では `data/raw/*.json` は1日62〜126件（5日平均約92件）あり、7日分の生データ全件でも
文字数換算でGeminiの1Mトークンコンテキストには収まる（トークン上限超過が理由ではない）。
それでも絞り込む理由は次の3点: (1) 既に Stage A/B のキュレーションと
`validate-citations.mjs` の検証を通過した＝その週に実際に記事化された事実だけを材料にする
ことで、週次記事が日次記事より広い主張をできない構造にする（日次が拾わなかった話題を
週次だけが新たに拾うのは一貫性を欠く）、(2) 生データ全件を投げるとStage Aへの入力が
5〜10倍に増え、LLM呼び出しのコスト・レイテンシが不必要に増える、(3) 長文投入は
クラスタリング精度の低下（attention希釈）のリスクがある。実測（5日分、日次記事のsourceIds
合計85件、重複排除後も85件でありDEDUP_LOOKBACK_DAYS=7により週内でのid重複は構造的に
起きない）から7日分では約110〜140件のユニークidになると推定される（本プロジェクトは
2026-09-09開始のため、本ADR執筆時点で7日分のデータはまだ存在せず7日ケースの実測はできない。
pr-review-toolkitのコメントレビューで「実測」という表現が誤解を招くと指摘・修正）。

### 出典検証ゲートは無改造で再利用し、CLI側だけ複数日対応にする

`scripts/lib/citation-gate.mjs` の `checkCitations({markdown, validIds, exemptTableHeading})`
は `validIds` を引数で受け取る純関数のため、7日分のアーカイブ id を union した `Set` を渡す
だけで週次記事にそのまま適用できる。`citation-gate.mjs` 本体は変更していない。

`validate-citations.mjs --type=weekly` は記事 frontmatter の `sourceDates`（自己申告値）を
信用せず、公開日から `scripts/lib/date.mjs` の `weeklyWindow()`（生成側の
`curate-weekly.mjs` と共有する純関数）で対象7日を再計算し、その各日の
`data/raw/<date>.json` の id を union して `validIds` を作る。生成側と検証側が同じ関数を
使うことで、両者の対象期間が構造的に一致する。加えて、記事の `sourceDates` が再計算した
窓の部分集合であることも別途検査する（自己申告値と実際の検証対象が食い違っていないかの
防御的多重化）。

### スラッグは公開日ではなく週の開始日にする

`site/src/content/weekly/<weekStart>.md` というファイル名にする。公開日をスラッグにすると、
月曜以降に `workflow_dispatch` で手動再実行した際に同じ週の記事が別URLで二重生成されて
しまうため、週開始日にすることで再実行は常に同じファイルを上書きする冪等な設計にした。

### 対象日数の下限は5日（7日中）

日次パイプラインは出典検証ゲートの失敗等で記事が出ない日がありうる。7日全部を必須にすると
週次側が過度に脆くなるため、実在する日次記事が5日未満なら `curate-weekly.mjs` を exit 1 で
中止する（公開せず、GHA を失敗させて手動 `workflow_dispatch` 再実行に委ねる）。

### 週開始日は日曜日を前提にし、日曜以外の公開日には警告を出す

`weeklyWindow()`自体は「publishDateがどの曜日でも同じ規則（前日から遡って7日）で一貫して
動く」ことを意図的な仕様にしているが、運用上は「週次まとめの対象週は日曜始まり」という
前提を置いている（`weekly.yml`のcronは日曜のみ発火し、サイト上にも「毎週日曜日に公開します」
と表示する）。この前提は`weeklyWindow()`単体では保証されず、`workflow_dispatch`での手動実行
や検証目的の実行で日曜以外のpublishDateを渡すと、weekStartが日曜以外になり静かに崩れる。

実際にPR検証中、`data/raw/`の実データ（5日分）でend-to-endを確認する目的で公開日引数に
検証当日（月曜）を渡して記事を生成したところ、週開始日が月曜になった記事ができてしまい
（evaluatorレビューで指摘）、この前提が実装で保証されていないことが判明した。対策として
`scripts/lib/date.mjs`に`isSunday()`を追加し、`curate-weekly.mjs`のmain()で公開日が日曜で
ない場合に警告を出すようにした（fail-fastにはしない。手動リカバリで意図的に日曜以外を
指定する場合もあり得るため）。この検証で生成した記事（週開始日が月曜）はPRに含めず、
本番の初回自動実行（2026-09-20、対象2026-09-13〜19）に委ねることにした。

### hero画像は新規生成しない

`scripts/images.mjs` は無変更のまま、その週の日次記事のうち実際に `hero.jpg` が生成されて
いる（SVGプレースホルダにフォールバックしていない）最新の日を OGP/Twitter Card 用に使い回す
（`pickOgImageDate`、ファイル実在チェック付き）。介護版（`care`）も同様に新規画像を持たない
既存パターンを踏襲しており、新規の画像生成コスト・失敗モードを追加しない。

### 公開時刻はdaily.ymlと2時間ずらし、daily.ymlにも同期ステップを追加する

初期案では `weekly.yml` を daily.yml と同じ日曜09:07 JST（00:07 UTC）に実行する設計だった。
しかし daily.yml は毎日00:07 UTCに実行されるため、日曜だけ両ワークフローが同時刻に
トリガーされる。`concurrency.group: daily-digest` で実行は直列化されるが、GitHub Actions の
`actions/checkout` はイベント発生時点で固定された `github.sha` を使うため、後から実行される
側は待機中に相手がpushした最新コミットを認識できず、非fast-forwardでの push 失敗を起こす
リスクがある。`care-rebuild.yml` は `git fetch origin main && git reset --hard origin/main`
という同期ステップでこれに対処済みだが、`daily.yml` にはこの対策が無く、週次のpushが先に
走ると日次記事自体の公開が失敗しうる状態だった（設計時に見落としていた）。

対策として、(1) `weekly.yml` の実行時刻を日曜11:07 JST（02:07 UTC）にずらし、通常数分で
完了する daily.yml との同時トリガーを避け、(2) `daily.yml` にも `care-rebuild.yml` と同じ
同期ステップを追加し、仮に将来 `care-rebuild.yml` の手動実行等と重なっても daily.yml 側が
壊れないようにした。`weekly.yml` には共有 concurrency グループをハングでブロックしないよう
`timeout-minutes: 25` も設定した。

## Rationale

- 候補プールを日次記事の `sourceIds` に絞る設計は、`curate-care.mjs` が `curate.mjs` の
  純関数（`normalizeLiteralNewlines` / `evaluateStageBCitations` / `decideStageBRetry`）を
  そのまま import して再利用している既存パターンと同じ発想: 検証済みの安全な既存資産を
  再利用し、新規の検証ロジックを増やさない。
- `weeklyWindow()` を生成側・検証側で共有する設計にしたのは、日付計算がどちらかにしか
  無いと「生成時の対象期間」と「検証時の対象期間」がズレた場合に、ズレたまま気づかずに
  ゲートを通過してしまうリスクがあるため（純関数を1箇所に置き両者が呼ぶことで、ズレが
  構造的に起きなくなる）。
- `concurrency.group` は `daily.yml` / `care-rebuild.yml` と同じ `daily-digest` を使う。
  日曜09:07は `daily.yml`（毎朝09:07）とも重なるため、同じグループで直列化しないと
  push の競合が起きる（`care-rebuild.yml` で確立済みの対策をそのまま踏襲）。

## Consequences

- 週次記事は日次記事の後追いで生成されるため、当日中に日次記事の再生成・修正が入ると
  週次記事との整合性は次回生成まで反映されない（週次は生成時点のスナップショット）。
- 介護版に将来同様の週刊ニーズが出た場合、同じパターン（候補プールを日次記事の
  sourceIdsに限定・validIdsのunion・スラッグを期間開始日にする）を踏襲できる。
- `daily.yml` の同期ステップは `git fetch origin main && git reset --hard FETCH_HEAD` にした
  （`codex review` 指摘: `git reset --hard origin/main` は `remote.origin.fetch` の設定次第で
  fetch直後の内容を指さない場合があり、`FETCH_HEAD` は常にfetch操作自体で更新されるため確実）。
  `care-rebuild.yml` は本PR以前から `git reset --hard origin/main` の形のままであり、同じ潜在
  リスクを抱えている可能性がある。本PRのスコープ外のため据え置いたが、次に `care-rebuild.yml`
  に触る際は同じ修正を検討すること。
