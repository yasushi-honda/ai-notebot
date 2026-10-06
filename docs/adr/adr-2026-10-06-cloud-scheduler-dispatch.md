# ADR: GCP Cloud Scheduler による daily / weekly の起動（schedule 欠落の構造的対策）

- 日付: 2026-10-06
- 状態: 採用（実装済み、本番での初回発火は未確認）

## Context

GitHub Actions の `schedule` イベントは配送が保証されず、遅延・完全欠落が繰り返し発生している
（詳細: `adr-2026-09-14-schedule-reliability.md`）。2026-10-06 には、daily.yml の 06:07 JST 枠
（21:07 UTC）が約 4 時間たっても発火しなかった。これで同種の事象は 7 件目になる。

過去 6 件の対策（PR #8, #16, #17, #47, #48, #51）は、cron の本数・時刻の調整と冪等性ガードであり、
いずれも GitHub の schedule 機構の上に乗った緩和策だった。同 ADR は外部スケジューラを「最も堅牢」と
評価しつつ、認証設計の投資が重いとして保留し、「7 件目が出たら構造的に対処する」と申し送っていた。

## Decision

GCP Cloud Scheduler を主たる起動源にし、GitHub の `schedule` は保険として残す。

```
Cloud Scheduler (Asia/Tokyo)
  → Cloud Workflows `github-dispatch`（SA: ai-notebot-dispatcher、リージョン asia-northeast1）
    → Secret Manager `github-dispatch-token` から PAT を取得
    → POST /repos/yasushi-honda/ai-notebot/actions/workflows/{daily|weekly}.yml/dispatches
      （ref=main、inputs.skip_if_exists=true）
```

| ジョブ | Scheduler（主） | 既存 GitHub cron（保険、変更なし） |
|---|---|---|
| daily-digest-dispatch | 毎日 06:00 JST | 06:07 / 12:07 JST |
| weekly-digest-dispatch | 日曜 08:20 JST | 08:30 / 09:30 / 10:30 JST |

1. **`skip_if_exists` 入力を追加**: daily.yml・weekly.yml の `workflow_dispatch` に boolean 入力
   `skip_if_exists`（既定 false）を追加し、`Skip if already generated` の条件を
   `github.event_name == 'schedule' || inputs.skip_if_exists` に変えた。Scheduler は true を渡すので、
   後続の GitHub cron や二重起動で生成済みなら収集・生成をスキップする。入力なしの手動実行は
   従来どおり常にフル実行する（既存記事の作り直し・障害復旧の運用を壊さない）。
2. **Cloud Workflows を挟む**: Scheduler の HTTP ターゲットに PAT を直接載せるとジョブ設定に平文で
   残る。Workflows なら Secret Manager コネクタ（`accessString`）で実行時に取得でき、
   コードのデプロイ（Cloud Run 等）も不要。
3. **GitHub App ではなく細粒度 PAT**: GitHub App は JWT の署名が必要で、Workflows 単体では実装できない。
   PAT は対象リポジトリの Actions:write のみで dispatch できる（GitHub 公式の細粒度 PAT 権限表で確認）。
4. **失敗通知**: ログベースのアラートポリシー（Workflows の ERROR、または Scheduler ジョブの
   ERROR 以上）から、メールで通知する。通知は 1 時間に 1 回までに制限する。

リソースの作成手順の正本は `infra/scheduler/setup.sh`（冪等）、Workflows 定義は
`infra/scheduler/github-dispatch.workflows.yaml`。

## Rationale

- schedule 欠落の原因は GitHub 側の配送機構にある。同じ機構に頼る限り、cron の本数や時刻を調整しても
  根本的な解決にならなかった。起動源を GitHub の外に置くことで、この依存を断つ。
- 冪等性ガードは実装済みなので、GitHub cron との併用で記事が二重生成されることはない。
  Scheduler が欠落しても GitHub cron が保険として働く（二重化）。
- 時刻の選定: daily の 06:00 JST の実行は数分で終わり、日曜 08:30 JST 以降の weekly 枠とは衝突しない。
  3 つのワークフローは concurrency グループ `daily-digest`（`queue: max`）を共有しているため、
  日曜の weekly 枠の前後に daily の重い実行を置かないようにした
  （`daily.yml` 冒頭のコメントにある週次との衝突懸念と同じ理由）。
- 費用はほぼゼロ。Scheduler は 3 ジョブまで無料（本件は 2 本）、Workflows は月 5,000 内部ステップまで
  無料。アラートの課金は 2027-09-01 以降に条件あたり月 $0.35 が始まる予定（公式の料金ページで確認）。

## Consequences

- **PAT の年次更新が必要**: 有効期限は 366 日。失効すると Scheduler 経由の起動は失敗し、
  アラートのメールが届く。その間も GitHub cron の保険で動く可能性が高いが、保証はない。
  更新手順:
  1. `https://github.com/settings/personal-access-tokens/new?name=ai-notebot-scheduler-dispatch&expires_in=366&actions=write`
     で新しい PAT を作る（Repository access は ai-notebot のみ）。
  2. 本人のターミナルで次を実行し、新バージョンを追加する（トークンを会話や履歴に出さないため）。
     `read -s T && printf %s "$T" | gcloud secrets versions add github-dispatch-token --data-file=- --project ai-notebot-yh --account hy.unimail.11@gmail.com`
  3. 動作確認後、古い PAT を GitHub 側で revoke する。
- **PAT 漏洩時の影響範囲**: 本リポジトリの Actions の起動・操作に限られる（コード書き換えはできない）。
  漏洩が疑われる場合は GitHub で revoke し、上記手順で差し替える。
- **inputs の先行マージが必要**: `skip_if_exists` が main に存在しない状態で dispatch すると、
  GitHub API は 422 を返す。daily.yml・weekly.yml の変更は Scheduler の有効化より先にマージする。
- GCP 側に新規リソースが増える（SA 1、シークレット 1、Workflows 1、Scheduler ジョブ 2、アラート 1）。
  すべて `infra/scheduler/setup.sh` で再現できる。
- 却下した代替案:
  - Scheduler から GitHub API を直接呼ぶ: PAT がジョブ設定に平文で残る。
  - GitHub App: Workflows 単体で JWT 署名ができず、Cloud Run 等のコード常駐が必要になる。
  - 検知と通知のみ（自動起動なし）: 復旧が人手になり、根本策にならない。
- **失敗通知の限界**: GCP のアラートが拾うのは「起動（dispatch）の失敗」だけである。
  - dispatch は受理（HTTP 2xx）の時点で成功扱いになる。起動後の daily.yml / weekly.yml の run
    自体が失敗（Vertex 障害、出典検証の exit 1 など）しても GCP 側からは通知されない。
    run の失敗は従来どおり GitHub Actions の失敗通知に依存する。
  - Scheduler ジョブの pause・削除、SA の権限剥奪などで「起動そのものが行われない」状態は、
    ログが出ないためログベースのアラートでは検知できない（GitHub cron の保険で動く間は
    記事は公開される）。「当日記事が無い」ことを検知する監視は本 ADR の範囲外とし、必要になれば別途追加する。
- **リトライ**: Workflows の dispatch は POST（非冪等）のため `http.default_retry_non_idempotent`
  を使い、429・503・接続失敗のみ再試行する（公式の定義）。Scheduler 側の再試行（最大 3 回）や受理後の応答欠落で
  二重に dispatch されても、`skip_if_exists` と concurrency グループにより生成は二重にならない。
- **監視事項**: 実装後の最初の数日、Scheduler 経由の run（`event=workflow_dispatch`、
  06:00 JST 前後）が毎日発生するかを `gh run list --workflow=daily.yml` で確認する。
