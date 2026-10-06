# ADR: GCP Cloud Scheduler による daily / weekly の起動（schedule 欠落の構造的対策）

- 日付: 2026-10-06
- 状態: 採用（実装済み。認証は GitHub App + Cloud KMS）

## Context

GitHub Actions の `schedule` イベントは配送が保証されず、遅延・完全欠落が繰り返し発生している
（詳細: `adr-2026-09-14-schedule-reliability.md`）。2026-10-06 には、daily.yml の 06:07 JST 枠
（21:07 UTC）が約 4 時間たっても発火しなかった。これで同種の事象は 7 件目になる。

過去 6 件の対策（PR #8, #16, #17, #47, #48, #51）は、cron の本数・時刻の調整と冪等性ガードであり、
いずれも GitHub の schedule 機構の上に乗った緩和策だった。同 ADR は外部スケジューラを「最も堅牢」と
評価しつつ、認証設計の投資が重いとして保留し、「7 件目が出たら構造的に対処する」と申し送っていた。

## Decision

GCP Cloud Scheduler を主たる起動源にし、GitHub の `schedule` は保険として残す。
GitHub への認証は、**GitHub App のインストールアクセストークン（1 時間で失効）** を毎回発行して使う。
App の秘密鍵は **Cloud KMS に署名専用で置く**。GCP に PAT 等の長期の秘密情報は保存しない。

```
Cloud Scheduler (Asia/Tokyo)
  → Cloud Workflows `github-dispatch`（SA: ai-notebot-dispatcher、リージョン asia-northeast1）
    1. JWT（RS256、有効10分以内）の署名対象を組み立て、SHA256 ダイジェストを KMS で署名
    2. GET /repos/yasushi-honda/ai-notebot/installation → POST /app/installations/{id}/access_tokens
       （対象リポジトリと権限 actions:write のみに絞る。それ以外の権限なら中止する）
    3. インストールトークンで POST .../actions/workflows/{daily|weekly}.yml/dispatches
       （ref=main、inputs.skip_if_exists=true）
```

| ジョブ | Scheduler（主） | 既存 GitHub cron（保険、変更なし） |
|---|---|---|
| daily-digest-dispatch | 毎日 06:00 JST | 06:07 / 12:07 JST |
| weekly-digest-dispatch | 日曜 08:20 JST | 08:30 / 09:30 / 10:30 JST |

1. **`skip_if_exists` 入力**: daily.yml・weekly.yml の `workflow_dispatch` に boolean 入力
   `skip_if_exists`（既定 false）を追加し、`Skip if already generated` の条件を
   `github.event_name == 'schedule' || inputs.skip_if_exists` にした。Scheduler は true を渡すので、
   後続の GitHub cron や二重起動で生成済みなら収集・生成をスキップする。入力なしの手動実行は
   従来どおり常にフル実行する（既存記事の作り直し・障害復旧の運用を壊さない）。
2. **GitHub App**（`ai-notebot-scheduler-yh`）: 非公開、Webhook 無効、権限は `actions: write` のみ
   （metadata:read は自動付与）、`yasushi-honda/ai-notebot` のみにインストール。トークン発行時にも
   リポジトリと権限を絞り、Workflows 側で「権限が actions/metadata 以外」「対象が selected でない」
   場合は dispatch せず中止する。
3. **秘密鍵は KMS に署名専用で置く**: GitHub が生成した PEM 秘密鍵を、非対称署名鍵（ソフトウェア、
   RSA 2048、インポート専用）として KMS にインポートする。SA は `roles/cloudkms.signer`
   （その鍵のみ）で、KMS 上では署名しかできず鍵を取り出せない（SA にはほかに、プロジェクト単位の
   `workflows.invoker` と `logging.logWriter` がある）。インポート後、ローカルの PEM は上書き削除する。
4. **失敗通知**: ログベースのアラートポリシー（Workflows の ERROR、または Scheduler ジョブの
   ERROR 以上）から、メールで通知する。通知は 1 時間に 1 回までに制限する。

リソースの作成手順の正本は `infra/scheduler/setup.sh`（冪等）。App の作成と鍵のインポートは
`infra/scheduler/bootstrap-github-app.mjs`（一度きり。鍵のローテーションにも使う）。
Workflows 定義は `infra/scheduler/github-dispatch.workflows.yaml`。
作成した GCP リソースは既存の `ai-notebot-yh` に置く（このリポジトリ専用のプロジェクト）。

## Rationale

- schedule 欠落の原因は GitHub 側の配送機構にある。同じ機構に頼る限り、cron の本数や時刻を調整しても
  根本的な解決にならなかった。起動源を GitHub の外に置くことで、この依存を断つ。
- **PAT を採らない理由**: PAT は長期の秘密情報で、漏洩・失効・更新（有効期限の管理）の負担を負う。
  GitHub 公式は、自動化には GitHub App のインストールトークンを使うことを推奨している
  （[Best practices for creating a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app):
  アプリは個人用アクセストークンで認証してはならない。インストールトークンは 1 時間で失効し、
  秘密鍵は key vault に置いて署名専用にすることを勧めている）。
  なお、細粒度 PAT を作成する公式の API は確認できず、gh（`gho_` の OAuth トークン、repo+workflow
  スコープ）の流用は、全リポジトリへの書き込みとワークフロー変更ができるため権限が広すぎる。
- `POST .../workflows/{workflow_id}/dispatches` は、GitHub App のインストールトークンに
  `actions: write` を与えれば呼べる
  （[Permissions required for GitHub Apps](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)）。
- Workflows 単体で JWT を署名できる: `hash.compute_checksum`（SHA256）、`base64.encode`
  （`padding=false`）、`text.replace_all`（base64url 化）と、KMS の `asymmetricSign`（`digest` 指定）を
  組み合わせる。実機で、Workflows が組み立てた JWT が KMS の公開鍵で RS256 検証できることを確認した。
- 冪等性ガードは実装済みなので、GitHub cron との併用で記事が二重生成されることはない。
  Scheduler が欠落しても GitHub cron が保険として働く（二重化）。
- 時刻の選定: daily の 06:00 JST の実行は数分で終わり、日曜 08:30 JST 以降の weekly 枠とは衝突しない。
  3 つのワークフローは concurrency グループ `daily-digest`（`queue: max`）を共有しているため、
  日曜の weekly 枠の前後に daily の重い実行を置かないようにした
  （`daily.yml` 冒頭のコメントにある週次との衝突懸念と同じ理由）。
- 費用はほぼゼロ。KMS のソフトウェア鍵は有効なバージョン 1 つで月 約 $0.06、署名操作は 1 日 2〜3 回で
  無視できる（[Cloud KMS 料金](https://cloud.google.com/kms/pricing)）。Scheduler は 3 ジョブまで無料
  （本件は 2 本）、Workflows は月 5,000 内部ステップまで無料。アラートの課金は 2027-09-01 以降に
  条件あたり月 $0.35 が始まる予定。

## Consequences

- **更新作業が不要**: PAT のような有効期限は無い。インストールトークンは毎回発行され、1 時間で失効する。
- **鍵のローテーション（漏洩の疑い時、または定期的に）**: GitHub の App 設定画面（Settings → Developer
  settings → GitHub Apps → 対象の App）で「Generate a private key」し、ダウンロードした PEM を
  `node infra/scheduler/bootstrap-github-app.mjs --pem-file <PEM> --app-id <App ID>` で新しい鍵バージョンとして
  取り込む（公開鍵の一致検証・GitHub への KMS 署名 JWT の受理確認まで行い、成功後に PEM を上書き削除する）。
  出力の `次の手順` のコマンド（`GITHUB_APP_ID=… KMS_KEY_VERSION=… bash infra/scheduler/setup.sh deploy`）で
  参照する鍵バージョンを明示して切り替える。動作確認後、旧バージョンを KMS で無効化・破棄し、
  GitHub 側の旧秘密鍵を削除する。同じ `--pem-file` モードは、App 作成後に途中で失敗した場合の復旧にも使う。
- **`deploy` の鍵バージョンは明示を推奨**: `KMS_KEY_VERSION` を省略すると有効な最新バージョン（作成時刻順）を
  使うが、App と対応しない鍵（使い捨て鍵・検証失敗）が ENABLED のまま残っていると誤って選びうる。
  bootstrap は、公開鍵の不一致、selftest の署名失敗、GitHub が KMS 署名を拒否し続けた（401）鍵バージョンを
  自動で破棄予約する。インストール待ちのタイムアウトなどでは鍵は有効なまま残るため、インポート直後に
  鍵バージョンを表示し、成功時は `KMS_KEY_VERSION` 付きのコマンドを出力する。
- **漏洩時の影響範囲**: GCP 側に取り出せる秘密情報は無い。ただし、万一 SA が侵害されると、攻撃者は
  KMS で JWT を署名してインストールトークンを発行できるため、`actions: write` の範囲（任意の workflow の
  起動、run・ログ・キャッシュの削除など。本リポジトリに限る）が可能になる。鍵は取り出せず、
  コードの書き換えや他リポジトリへの影響は無い。Workflows 側には起動してよい workflow の allowlist
  （`daily.yml` / `weekly.yml`）があり、Workflows の引数経由の誤用や悪用は防ぐが、SA 自体の侵害は防げない。
  侵害が疑われる場合は、SA の `cloudkms.signer` を外し、GitHub で App の鍵を削除する。
- **秘密鍵がローカルに存在する短い時間**: App 作成から KMS インポートまでの間、PEM は
  プロセスのメモリと 0600 の一時ファイルに存在する。インポート用の平文 DER はインポート直後に、
  PEM は成功後に、失敗・中断（SIGINT/SIGTERM/SIGHUP）時も含めて上書き削除する。APFS/SSD では上書きしても
  旧ブロックが残りうるため、効果の中心は「平文ファイルを残さない・早く消す」ことである。
  残る場合がある: SIGKILL やクラッシュ（0600 の一時ファイルが `$TMPDIR/ghapp-*` に残る）、
  `--pem-file` モードでインポートに失敗したとき（ユーザーがダウンロードした取り込み元の PEM は消さない。
  スクリプトが残存を警告するので、削除の責任は実行者にある）。
  GitHub 側にも元の鍵は残る（GitHub の仕様）。ローテーション時に旧鍵を削除する。
- **App 作成は不可逆**: bootstrap は、App 作成より前にインポートジョブを作って ACTIVE まで待つ
  （KMS 側の問題を先に露呈させるため）。App 作成後に失敗した場合は、App のスラッグと ID、復旧手順を
  先に出力する。
- **人間の作業は一度きり 2 回のブラウザ操作**: GitHub は App の作成とリポジトリへのインストールに
  対話的な同意を求める（API では代行できない）。`bootstrap-github-app.mjs` が受け口を用意し、
  App 作成（マニフェスト方式）→ 鍵インポート → インストール待ちまでを自動化する。
- **実機で分かった制約**:
  - Workflows のパーサーは、式の中の空マップ `{}` と、マップのリテラル内の式（`{"iat": now - 60}`）を
    拒否する。変数や assign のマップで渡す。`gcloud workflows deploy` を通すまで分からない。
  - ガードの `raise` は `code`・`tags`・`message` を持つマップにする。文字列の `raise` はリトライ述語が
    `TypeError`、`tags` の無いマップは `KeyError` で落ち、本来のメッセージが失われる（実機で確認）。
    なお、実行失敗時はプラットフォームが ERROR の `FAILED` ログを出すため、メッセージが失われても
    アラートは鳴る。
  - GitHub は JWT の `iss` に整数（App ID）を要求する。client ID の文字列は
    `'Issuer' claim ('iss') must be an Integer` で拒否された。
  - 作成直後のサービスアカウントは、数分間 `IAM permission denied for service account`
    （AuthError）で Workflows から使えないことがある（IAM の反映遅延）。`setup.sh kms` の直後に
    すぐ実行して失敗しても、数分待って再実行する。
  - `gcloud kms keys versions import` の自動ラッピングには pyca/cryptography が必要（公式手順）。
    venv に入れ、`CLOUDSDK_PYTHON` でその python を gcloud に使わせる。
- **inputs の先行マージが必要**: `skip_if_exists` が main に存在しない状態で dispatch すると、
  GitHub API は 422 を返す（daily.yml・weekly.yml は PR #57 でマージ済み）。
- GCP 側に新規リソースが増える（SA 1、KMS キーリング 1・鍵 1、Workflows 1、Scheduler ジョブ 2、アラート 1）。
  すべて `infra/scheduler/` で再現できる。KMS のキーリングと鍵は、GCP の仕様で削除できない
  （鍵バージョンの破棄のみ可能）。
- **失敗通知の限界**: GCP のアラートが拾うのは「起動（dispatch）の失敗」だけである。
  - dispatch は受理（HTTP 2xx）の時点で成功扱いになる。起動後の daily.yml / weekly.yml の run
    自体が失敗（Vertex 障害、出典検証の exit 1 など）しても GCP 側からは通知されない。
    run の失敗は従来どおり GitHub Actions の失敗通知に依存する。
  - Scheduler ジョブの pause・削除、SA の権限剥奪などで「起動そのものが行われない」状態は、
    ログが出ないためログベースのアラートでは検知できない（GitHub cron の保険で動く間は
    記事は公開される）。「当日記事が無い」ことを検知する監視は本 ADR の範囲外とし、必要になれば別途追加する。
- **リトライ**: Workflows の dispatch は POST（非冪等）のため `http.default_retry_non_idempotent`
  を使い、429・503・接続失敗のみ再試行する（公式の定義）。Scheduler 側の再試行（最大 3 回）や受理後の
  応答欠落で二重に dispatch されても、`skip_if_exists` と concurrency グループにより生成は二重にならない。
- 却下した代替案:
  - 細粒度 PAT を Secret Manager に保存: 長期の秘密情報になる（上記 Rationale）。当初案だったが、
    PAT は自動化にはアンチパターンという decision-maker の判断で却下した。
  - gh の OAuth トークンを流用: 権限が広すぎる。
  - Scheduler から GitHub API を直接呼ぶ: 認証情報をジョブ設定に載せることになる。
  - App の秘密鍵を Secret Manager に PEM のまま置く: 長期の秘密情報が残り、Workflows 単体では
    署名できないためコードの常駐も必要になる。
  - 検知と通知のみ（自動起動なし）: 復旧が人手になり、根本策にならない。
- **監視事項**: 実装後の最初の数日、Scheduler 経由の run（`event=workflow_dispatch`、
  06:00 JST 前後）が毎日発生するかを `gh run list --workflow=daily.yml` で確認する。
