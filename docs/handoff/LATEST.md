# ハンドオフ（最新）

- セッション: 2026-10-09（10/9 分の記事欠落の復旧、daily の起動枠を 07/08/09 時台に前倒し、Stage B の失敗テーマ除外。PR #61・#62 マージ、Scheduler 本番反映まで完了）
- 更新日: 2026-10-09

## セッション概要

### 10/9 分の記事欠落の復旧
`/catchup` で `daily.yml` が 2 回連続で失敗していることが判明した。

| run | 起動元 | JST | 失敗原因 |
|---|---|---|---|
| 37843624514 | workflow_dispatch（Scheduler 経由） | 06:00 | 収集段階で Reddit が HTTP 429。Stage A の有効テーマが 3 件未満で中止 |
| 37868402430 | schedule（GitHub cron） | 10:09 | Stage B「Anthropicの新展開とClaudeエコシステムの急拡大」で、脚注のない文が 3 回の再生成後も残り中止 |

`gh workflow run daily.yml` の手動実行（run 37877563659、generate・deploy とも成功）で `2026-10-09.md` を公開した。

### PR #61: daily の起動枠を 07/08/09 時台の 3 回に前倒し
12:07 JST 枠では公開が遅すぎるとの運用要件（weekly と同じ）による。

| 経路 | 変更前 | 変更後 |
|---|---|---|
| GitHub cron | `7 21,3 * * *`（06:07 / 12:07 JST） | `7 22,23,0 * * *`（07:07 / 08:07 / 09:07 JST） |
| Cloud Scheduler `daily-digest-dispatch` | 毎日 06:00 JST | 毎日 07:00 JST |

- Scheduler は本番の GCP に反映済み。`gcloud scheduler jobs update http daily-digest-dispatch --schedule "0 7 * * *"` のみで更新し（`setup.sh deploy` の全体再適用はしていない）、`describe` で ENABLED・次回発火 10/10 07:00 JST を確認した。
- 新規 ADR `docs/adr/adr-2026-10-09-daily-slots-7-9.md`。`AGENTS.md`（CLAUDE.md の実体）と `adr-2026-10-06-cloud-scheduler-dispatch.md` の記述も更新。
- 日曜は weekly（Scheduler 08:20、cron 08:30〜10:30）と同一 concurrency group で直列化されるが、daily は約 2 分で終わるため待ちは数分。

### PR #62: Stage B で失敗したテーマだけを除外して記事生成を続行
`scripts/curate.mjs` の `runStageB` が再生成を使い切ると記事全体が中止されていた。changelog 系テーマは、箇条書きや「以下の〜」型の導入文に脚注を付けきれず、試行ごとに別の文で落ちる。

- `StageBExhaustedError` を導入し、`partitionStageBOutcomes`（純関数）で失敗テーマを除外する。残りが `MIN_THEMES`（3）以上なら続行、未満なら従来どおり中止。
- API 障害など想定外の例外は握りつぶさず再 throw。出典検証ゲート（`validate-citations.mjs`）は変更なし。
- テスト: 境界値 4 件を追加し、`node --test scripts/test/*.test.mjs` は 313 件全 PASS。

### 未対応（意図的）
- Reddit の HTTP 429（今朝の 06:00 の失敗）。一過性の可能性が高いと見て、対策は未実施。

## ドキュメント整合性

| 項目 | 状態 | 備考 |
|------|------|------|
| AGENTS.md（CLAUDE.md の実体）↔ 実装 | ✅ | Scheduler 07:00、cron 07:07 / 08:07 / 09:07 JST を反映 |
| ADR ↔ 実装 | ✅ | `adr-2026-10-09-daily-slots-7-9.md` を新設。`adr-2026-09-14-schedule-reliability.md` の過去記述は経緯として残置（本 ADR が最新） |
| Stage B 除外の ADR | ⏭ | 未作成。PR #62 本文とコードコメントに記録（小規模のため） |
| 完了ステータス一致 | ✅ | PR #61・#62 マージ済み、Scheduler 本番反映済み |

## Git状態

| 項目 | 状態 |
|------|------|
| 未コミット変更 | なし（本ハンドオフ更新を除く） |
| 未プッシュコミット | なし（`main` = `origin/main` = `43efb0c`、本ハンドオフ PR を除く） |
| CI/CD | ✅ PR #61・#62 とも test・GitGuardian・CodeRabbit が全 PASS |

## 品質ゲート

| 項目 | 状態 |
|------|------|
| codex review | PR #61 で 1 回実施、指摘 0 件。PR #62 は small tier（2 ファイル・+67/-10）で手動チェックリスト |
| テスト | ✅ 313 件全 PASS（`curate.test.mjs` に `partitionStageBOutcomes` の境界値 4 件を追加） |
| 実機動作確認 | ⚠️ Scheduler の `describe` で更新を確認、cron 式は Ruby の YAML パースで確認。`partitionStageBOutcomes` の呼び出しを含む `main()` は Vertex AI 依存のため通しでは未実行（除外が発生した次回 run のログで確認する） |

## 同根再発スキャン（§4.6）と対症療法判定（§4.7）

- **同根候補 1 件**: Stage B の「LLM が全文に脚注を付けない」失敗は、2026-09-10（裏取り率 97% でゲート失敗、再生成ループを導入）に続く 2 回目。今回は再生成ループを使い切るケースで、PR #62 でテーマ除外を追加した。
  - 仮説: (1) changelog・箇条書き系の出典は文単位の脚注付与と相性が悪い、(2) 軽量モデル（`gemini-3.5-flash-lite`）の指示追従の限界、(3) プロンプトが導入文・箇条書きの扱いを明示していない。
  - 次に出る経路: 除外が続いて `MIN_THEMES` を割る日（Stage A が 4 テーマ中 2 件以上が changelog 系など）。
- **対症療法判定**: 基準 3（過去 30 日以内の同症状 PR、09-10 は 29 日前）に該当。WebSearch で `gemini-3.5-flash-lite` の指示追従・構造化出力の既知回帰を調べたが、該当する報告は見つからなかった。外部要因ではなく確率的な失敗と判断する。PR #62 は retry の追加ではなく「縮退運転」への設計変更だが、根本のプロンプト改善（案 2）は未実施。

## 次のアクション（3分割・SKILL.md §2.5）

### 即着手タスク
即着手タスクなし（残りは日時・decision-maker の確認待ち）。

### 条件待ち（明示trigger付き）

| # | 項目 | trigger（充足条件） | 充足時のタスク | 充足確認方法 |
|---|------|------------------|--------------|------------|
| 1 | **Scheduler 07:00 と cron 3 枠の初回確認** | 2026-10-10 07:00 JST の経過 | Scheduler 経由の `workflow_dispatch` run が 07:00 台に出て記事が生成されたか確認。cron の 07:07 以降は `skip_if_exists` で何もしないはず。出ない場合は Scheduler 側の欠落を調べる | `gh run list --workflow=daily.yml --limit 6`、`gcloud workflows executions list github-dispatch --location asia-northeast1 --project ai-notebot-yh --account hy.unimail.11@gmail.com --limit 3` |
| 2 | **Stage B のテーマ除外の実環境確認** | daily の run ログに「除外したテーマ」が出た時 | 除外されたテーマと記事の整合を確認。除外が頻発するなら、プロンプトへの導入文禁止・箇条書き項目への脚注指示追加（案 2）を検討 | `gh run view <id> --log \| grep '除外したテーマ'` |
| 3 | Reddit 429 の再発 | 同様の収集失敗が再発した時 | `scripts/collect.mjs` の Reddit 取得のリトライ・バックオフを read-only で調査し、対策案を報告 | `gh run list --workflow=daily.yml` の失敗 run のログ |
| 4 | アラートメールの受信確認（前回から継続） | decision-maker が `hy.unimail.11@gmail.com` の受信箱を確認（AI 代行不可） | 届いていなければ通知チャネルの認証状態・迷惑メール・ポリシーのフィルタを調査 | decision-maker 本人が確認 |
| 5 | weekly の Scheduler 初回発火（前回から継続） | 2026-10-11（日）08:20 JST の経過 | 週刊まとめが生成・公開されたか確認（Scheduler 経由と GitHub cron 08:30/09:30/10:30 のどれが作ったか）。daily の 08:07/09:07 cron と同一 concurrency group で直列化されることも併せて確認 | `gh run list --workflow=weekly.yml --limit 5`、`site/src/content/weekly/2026-10-04.md` の有無 |
| 6 | 「福祉用具」targetServices が生成記事で選ばれるか（前回から継続） | 次回以降の daily.yml / care-rebuild.yml の自然な実行（確率的） | `site/src/content/care/` の新規記事 frontmatter の `targetServices` に出現するか確認。長期間出現しなければ `collect-care.mjs` のテーマ指示を見直す | `grep -l '福祉用具' site/src/content/care/*.md` |
| 7 | GA4 データ反映の再確認（前回から継続） | decision-maker 本人の Google ログインでの確認（AI 代行不可） | analytics.google.com で DebugView / リアルタイムレポートを確認 | decision-maker 本人が確認 |
| 8 | `content.config.ts` の themes フィールド影響分析（前回から継続） | decision-maker からの実行指示 | `/impact-analysis` 実行（read-only） | 明示指示の有無 |
| 9 | care-rebuild.yml の FETCH_HEAD 方式への統一（前回から継続） | 次に care-rebuild.yml の YAML 自体を編集する用事、または明示指示 | Sync ステップを `git fetch origin main && git reset --hard FETCH_HEAD` に統一 | `grep -n "git reset" .github/workflows/care-rebuild.yml` |

### 却下候補（記録のみ）

| # | 項目 | 検討経緯 | 着手しない理由 | 参照条件 |
|---|------|---------|--------------|---------|
| 1 | Stage B プロンプトの改善（導入文の禁止、箇条書き項目への脚注指示） | 失敗調査の対策案 2。PR #62 の縮退運転で当面の欠落は防げる | 確率的失敗の根治には弱い。除外の頻度を実測してから判断（条件待ち 2） | decision-maker からの明示指示、または条件待ち 2 の充足時 |
| 2 | 試行回数の増加（3 → 5 回） | 失敗調査の対策案 3 | 確率的失敗への効果が薄い | decision-maker からの明示指示時のみ |
| 3 | `setup.sh deploy` の全体再適用 | Scheduler の時刻変更は `jobs update` のみで反映済み | 影響範囲が広く、`setup.sh` の定義（`0 7 * * *`）は既に本番と一致 | decision-maker からの明示指示時のみ |
| 4 | 「当日記事が無い」ことの外部検知監視（前回から継続） | ADR の失敗通知の限界として記録 | 新規価値創出カテゴリで起点は decision-maker 領分 | decision-maker からの明示指示時のみ |
| 5 | インストールトークンの明示的な revoke、curate-care の品質ゲート再設計、福祉用具の貸与・販売の分離分類（前回から継続） | 前回セッションから継続 | ROI 低、または decision-maker 領分 | decision-maker からの明示指示時のみ |
| 6 | workArea フィルタ / 関連記事リンク / 介護版カテゴリ偏り是正 / GA4 Data API 自動取得 / GA4 プロパティ再作成 / YouTube 動画コーナー / `source-tier.mjs` official ホワイトリスト拡張 / `/posts/[date]/` 詳細ページ h1 定型文（前回から継続） | 前回セッションから継続 | いずれも decision-maker 起点の指示がない | decision-maker からの明示指示時のみ |

> ⚠️ 「優先順にすすめて」等の包括指示では上記却下候補は一切参照しない。条件待ちは trigger 充足を確認してから昇格する。

### 再開可能性判定
✅ **再開可能** - ドキュメントから開発再開できます。次回は条件待ち 1（10/10 07:00 JST の発火確認）から始める。

## 申し送り

- gcloud の named configuration `ai-notebot` の account が別プロジェクトの SA に書き換わっている（汚染）。対話的な gcloud は `--account hy.unimail.11@gmail.com` を明示すること。
- Scheduler 経由でも 07:00 JST の発火が欠落した場合: GitHub cron（07:07/08:07/09:07 JST）が記事を作る二重化になっている。Scheduler 側の欠落が出たら `gcloud scheduler jobs describe daily-digest-dispatch ...` の `status`・`lastAttemptTime` と Workflows の実行履歴を先に確認する。
- 非日曜に weekly.yml を日付なしで手動実行すると全文生成になる。検証時は既存の週を指す公開日（例 2026-10-04）を渡す。

## 残留プロセス

✅ 残留 Node プロセスなし（マシン全体チェック）。

## Issue Net 変化
- Close 数: 0 件
- 起票数: 0 件
- Net: 0 件（open Issue なし。10/9 の失敗は Issue を起票せず、PR #61・#62 で対応）

## 最終結論

✅ **セッション終了可** — 10/9 分の記事を公開し、daily の起動枠（07/08/09 時台）と Stage B のテーマ除外をマージ・本番反映した。残りは日時・decision-maker の確認待ちのみ。

- OPEN PR: 本ハンドオフ PR のみ / open Issue: 0 件 / Git clean / 即着手 = 0、条件待ち = 9
- 同根再発スキャン: 候補 1 件（Stage B の脚注欠落、2026-09-10 以来）。対症療法判定: 基準 3 に該当、WebSearch で外部要因は見つからず、確率的失敗として縮退運転を採用
- 既知の blocker: なし
