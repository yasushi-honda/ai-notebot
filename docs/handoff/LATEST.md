# ハンドオフ（最新）

- セッション: 2026-10-06（10/6 分の記事欠落の復旧、schedule 欠落 7 件目の構造対策として
  GCP Cloud Scheduler 起動経路を新設。認証は GitHub App + Cloud KMS。PR #57・#58・#59 マージ・本番適用まで完了）
- 更新日: 2026-10-06

## セッション概要

### 10/6 分の記事欠落の復旧
`/catchup` 後、「10/6 分が失敗していないか」の確認で、daily.yml の 06:07 JST 枠（21:07 UTC）が約 4 時間たっても
発火していないことが判明した（run に失敗は無く、run 自体が無かった）。GitHub Actions の schedule 欠落で、
同種の事象は 7 件目（過去 6 件: PR #8, #16, #17, #47, #48, #51）。`gh workflow run daily.yml` を手動実行して
10/6 分を公開した（run 37397606845、コミット 7fc121b、本番 `/posts/2026-10-06/` が 200）。

### 構造対策: GCP Cloud Scheduler から daily / weekly を起動（PR #57・#58・#59、plan mode で承認済み）
GitHub の schedule に依存しない起動源を作った。GitHub の cron は保険として残している（冪等性ガードで二重生成しない）。

```
Cloud Scheduler (daily 06:00 JST / weekly 日曜 08:20 JST)
  → Cloud Workflows `github-dispatch` → Cloud KMS で JWT(RS256) を署名
  → GitHub App のインストールトークン（1 時間で失効、権限 actions:write・対象 ai-notebot のみ）
  → daily.yml / weekly.yml の workflow_dispatch（skip_if_exists=true）
```

1. **PR #57**: `daily.yml`・`weekly.yml` に `skip_if_exists` 入力（既定 false。入力なしの手動実行は従来どおりフル実行）。
   Workflows 定義・`setup.sh`・ADR の骨格。当初は PAT 案だった。
2. **PR #58**: decision-maker の判断（「PAT はアンチパターン。公式情報から最適解を」）で、認証を **GitHub App + KMS 署名専用鍵**
   に変更し PAT を廃止。`infra/scheduler/bootstrap-github-app.mjs`（App 作成・鍵の KMS インポート・`--selftest`・
   `--pem-file`（ローテーション・復旧）・`--check-install`）。Workflows に権限ガード・allowlist（daily.yml/weekly.yml のみ）。
3. **PR #59**: ADR に本番適用後の end-to-end 確認結果を反映。

**本番適用済みの GCP リソース（プロジェクト `ai-notebot-yh`、アカウント `hy.unimail.11@gmail.com`）**:
SA `ai-notebot-dispatcher`、KMS キーリング `github-app`・鍵 `github-app-signer`（ENABLED は鍵バージョン 3 のみ。1・2 は
selftest の使い捨てで DESTROY_SCHEDULED）、Workflows `github-dispatch`（`GITHUB_APP_ID=5205499`）、Scheduler ジョブ
`daily-digest-dispatch`・`weekly-digest-dispatch`、ログベースのアラート「ai-notebot: Scheduler起動失敗」（メール通知）。
GitHub App は `ai-notebot-scheduler-yh`（App ID 5205499、インストール ID 168356379、選択したリポジトリのみ）。
Secret Manager は未使用（有効化もしていない）。詳細・鍵ローテーション手順: `docs/adr/adr-2026-10-06-cloud-scheduler-dispatch.md`。

### 実機検証で見つけて直したこと（ADR に記録済み）
- Workflows のパーサーは、式の中の空マップ `{}` とマップリテラル内の式を拒否する（PR #57 の `inputs` 行も該当、PR #58 で修正）。
- GitHub は JWT の `iss` に整数（App ID）を要求する（client ID 文字列は拒否された）。
- ガードの `raise` は `code`・`tags`・`message` を持つマップにする（文字列はリトライ述語が TypeError、tags 無しは KeyError）。
- 新規 SA は数分の IAM 反映遅延がある。インストール画面の既定は「All repositories」（bootstrap が検出して中止する）。
- 私（AI）のバグ: 確認モードがポーリングごとにブラウザを開き、無限にタブが開いた。修正し回帰テストを追加済み
  （メモリ: `feedback_no_side_effects_in_polling_loops.md`）。認証方針は `feedback_no_long_lived_pat_prefer_official_short_lived_auth.md`。

### 同根再発スキャン（§4.6）
GitHub Actions の schedule 信頼性テーマは今回が 7 件目で、申し送りどおり**個別パッチではなく構造対処（外部スケジューラ）**を実施した。
同根候補: PR #8, #16, #17, #47, #48, #51（いずれも schedule の cron 本数・時刻の調整と冪等性ガード）。
もう 1 件出るとしたら: Scheduler ジョブの停止・削除や SA 権限の剥奪で「起動そのものが行われない」ケース（ログが出ず、
アラートでは検知できない。GitHub cron の保険で動く間は記事は公開される）。

### 対症療法判定（§4.7）
該当なし。起動源そのものを GitHub の外に移し、依存を断つ構造対策。GitHub・GCP の公式ドキュメント（Best practices for creating a
GitHub App、Cloud KMS 鍵インポート、Workflows stdlib）を一次情報として確認し、設計の主張は実機の実行で検証した。

## ドキュメント整合性

| 項目 | 状態 | 備考 |
|------|------|------|
| AGENTS.md（CLAUDE.md はリンク）↔ 実装 | ✅ | 起動経路・認証方式・PAT 不使用・時刻（06:00 / 日曜 08:20 JST）を反映済み |
| ADR ↔ 実装 | ✅ | `adr-2026-10-06-cloud-scheduler-dispatch.md` を新設、`adr-2026-09-14-schedule-reliability.md` に Amendment 追記 |
| 完了ステータス一致 | ✅ | PR #57・#58・#59 すべてマージ・main 反映・本番（GCP）適用済み |

## Git状態

| 項目 | 状態 |
|------|------|
| 未コミット変更 | なし（`infra/scheduler/.github-dispatch.workflows.yaml.swp` は decision-maker の vimdiff のスワップで未追跡・`.gitignore` 済み） |
| 未プッシュコミット | なし（`main` = `origin/main` = `d61c435`、本ハンドオフ PR を除く） |
| CI/CD | ✅成功（PR #57・#58・#59 とも test・GitGuardian・CodeRabbit が全 PASS） |

## 品質ゲート

| 項目 | 状態 |
|------|------|
| codex review | PR #57: 1 回目 P2 を 1 件検出・修正。2 回目は内部エラーで結果未取得（上限を消費、**未確認**）。PR #58: 1 回目 P2（鍵バージョンの文字列ソート）修正、2 回目 P2（旧 PAT の掃除）は旧経路が GCP に未適用のため該当せず |
| pr-review-toolkit（sonnet・read-only） | 両 PR で 2 エージェント。指摘は実機で確認して採用（raise の形式、平文 DER の残留、不可逆な App 作成の順序、鍵バージョンの明示、復旧モード等） |
| quality-gate-evaluator | PR #58 で実施（REQUEST_CHANGES、ブロッキングは本物の App での e2e 未検証 → マージ前に実施して解消） |
| セキュリティレビュー（自動） | ローカル受け口の DNS リバインディング → Host 検査・コールバック 1 回制限・所有者確認を追加。ログへのトークン漏洩 → 実ログ 31 件で 0 件を確認し該当せず |
| テスト | ✅ `node --test scripts/test/*.test.mjs` 309 件全 PASS（bootstrap の純粋関数、標準 RS256 検証器による JWT 検証、偽 API・偽 gcloud・偽 open による回帰テストを追加） |
| 実機動作確認 | ✅ Workflows 実行 SUCCEEDED（dispatch 204）、トークン権限 `{"actions":"write","metadata":"read"}`・`selected`、daily の `workflow_dispatch` run が success でスキップ（新規コミットなし）、Scheduler ジョブ手動実行も SUCCEEDED、weekly は既存の週（公開日 2026-10-04）でスキップ確認、許可外 workflow 名は GuardError で FAILED |

## 次のアクション（3分割・SKILL.md §2.5）

### 即着手タスク
即着手タスクなし（残りは日時・decision-maker の確認待ち）。

### 条件待ち（明示trigger付き）

| # | 項目 | trigger（充足条件） | 充足時のタスク | 充足確認方法 |
|---|------|------------------|--------------|------------|
| 1 | **Scheduler の初回定刻発火**（06:00 JST） | 2026-10-07 06:00 JST の経過 | Scheduler 経由の `workflow_dispatch` run が 06:00 台に出て記事が生成されたかを確認。出ない場合は GitHub cron（06:07 JST）が記事を作っているはず。原因（Scheduler 側の欠落か）を調べる | `gh run list --workflow=daily.yml --limit 6`（event=workflow_dispatch の run が 06:00 JST 前後にあること）、`gcloud workflows executions list github-dispatch --location asia-northeast1 --project ai-notebot-yh --account hy.unimail.11@gmail.com --limit 3` |
| 2 | **アラートメールの受信確認** | decision-maker が `hy.unimail.11@gmail.com` の受信箱を確認（AI 代行不可） | 届いていなければ、通知チャネルの認証状態・迷惑メール・ポリシーのフィルタを調査（試験: 10/6 12:11 JST ごろに `nonexistent.yml` で失敗を発生させた） | decision-maker 本人が確認し、「ai-notebot: Scheduler起動失敗」のメールの有無を AI に伝える |
| 3 | weekly の Scheduler 初回発火 | 2026-10-11（日）08:20 JST の経過 | 週刊まとめが生成・公開されたかを確認（Scheduler 経由と GitHub cron 08:30/09:30/10:30 のどれが作ったか） | `gh run list --workflow=weekly.yml --limit 5`、`site/src/content/weekly/2026-10-04.md` の有無 |
| 4 | 「福祉用具」targetServices が生成記事で選ばれるか（前回から継続） | 次回以降の daily.yml / care-rebuild.yml の自然な実行（複数回分、確率的） | `site/src/content/care/` の新規記事 frontmatter の `targetServices` に「福祉用具」が出現するか確認。長期間出現しなければ collect-care.mjs のテーマ指示を見直す | `grep -l '福祉用具' site/src/content/care/*.md` |
| 5 | GA4 データ反映の再確認（前回から継続） | decision-maker 本人の Google ログインでの確認（AI 代行不可） | analytics.google.com で DebugView / リアルタイムレポートを確認 | decision-maker 本人が確認 |
| 6 | `content.config.ts` の themes フィールド影響分析（前回から継続） | decision-maker からの実行指示 | `/impact-analysis` 実行（read-only） | 明示指示の有無 |
| 7 | care-rebuild.yml の FETCH_HEAD 方式への統一（前回から継続） | 次に care-rebuild.yml の YAML 自体を編集する用事、または明示指示 | Sync ステップを `git fetch origin main && git reset --hard FETCH_HEAD` に統一 | `grep -n "git reset" .github/workflows/care-rebuild.yml` |

### 却下候補（記録のみ）

| # | 項目 | 検討経緯 | 着手しない理由 | 参照条件 |
|---|------|---------|--------------|---------|
| 1 | 「当日記事が無い」ことの外部検知監視（Scheduler 停止・削除、dispatch 後の run 失敗の検知） | ADR の失敗通知の限界として記録。今回のアラートは起動（dispatch）の失敗のみを拾う | 新規価値創出カテゴリで起点は decision-maker 領分。run の失敗は GitHub Actions の失敗通知に依存する運用 | decision-maker からの明示指示時のみ |
| 2 | インストールトークンの明示的な revoke（`DELETE /installation/token`） | セキュリティレビューで提案。1 時間で自動失効・対象も絞られている | 複雑さに見合う ROI が無い | decision-maker からの明示指示時のみ |
| 3 | curate-care.mjs の品質ゲート設計（15 個近い独立チェック + LLM 再生成ループ）の再レビュー（前回から継続） | 2026-09-12/09-13/09-16/09-28 で計 5 回の個別パッチ履歴 | アーキテクチャ判断（新規価値創出）で起点は decision-maker 領分 | decision-maker からの明示指示時のみ |
| 4 | 福祉用具の貸与・販売を分離する分類への変更（前回から継続） | AskUserQuestion で単一区分にまとめる方を選択済み | decision-maker 明示選択済み | decision-maker からの明示指示時のみ |
| 5 | workArea フィルタ / 関連記事リンク / 介護版カテゴリ偏り是正 / GA4 Data API 自動取得 / GA4 プロパティ再作成 / YouTube 動画コーナー / `source-tier.mjs` official ホワイトリスト拡張 / `/posts/[date]/` 詳細ページ h1 定型文（前回から継続） | 前回セッションから継続 | いずれも decision-maker 起点の指示がない | decision-maker からの明示指示時のみ |

> ⚠️ 「優先順にすすめて」等の包括指示では上記却下候補は一切参照しない。条件待ちは trigger 充足を確認してから昇格する。

### 再開可能性判定
✅ **再開可能** - ドキュメントから開発再開できます。次回は条件待ち 1（10/7 06:00 JST の発火確認）から始める。

## 申し送り

- Scheduler 経由でも 06:00 JST の発火が欠落した場合: GitHub cron（06:07/12:07 JST）が記事を作る二重化になっている。Scheduler 側の欠落が出たら
  `gcloud scheduler jobs describe daily-digest-dispatch ...` の `status`・`lastAttemptTime` と Workflows の実行履歴を先に確認する。
- 鍵のローテーション・復旧手順は ADR に記載。`setup.sh deploy` の `KMS_KEY_VERSION` は明示を推奨（省略時は有効な最新の鍵バージョン）。
- 非日曜に weekly.yml を日付なしで手動実行すると全文生成になる。検証時は既存の週を指す公開日（例 2026-10-04）を渡す。
- gcloud の named configuration `ai-notebot` の account が別プロジェクトの SA に書き換わっていた（汚染）。`setup.sh` は
  `--account hy.unimail.11@gmail.com` を全コマンドに明示しているため影響しないが、対話的な gcloud は `--account` を明示すること。

## 残留プロセス

✅ 残留 Node プロセスなし（マシン全体チェック）。decision-maker の iTerm で `git difftool -x vimdiff` が動作中（本セッションの変更を
レビュー中と思われる別セッション由来、対象外・未操作）。

## Issue Net 変化
- Close 数: 0 件
- 起票数: 0 件
- Net: 0 件（open Issue なし。schedule 欠落は新規 Issue を起票せず、PR #57〜#59 の構造対策で対応）

## 最終結論

✅ **セッション終了可** — schedule 欠落 7 件目への構造対策（Cloud Scheduler 起動経路、認証は GitHub App + KMS）を実装・マージ・
本番適用し、end-to-end を実機で確認した。残りは日時・decision-maker の確認待ちのみ。

- OPEN PR: 本ハンドオフ PR のみ / open Issue: 0 件
- Git: clean（`main` = `origin/main` = `d61c435`、本ハンドオフ PR を除く）
- 即着手タスク: 0 件 / 条件待ち: 7 件（うち新規 3 件。1 は 10/7 06:00 JST、2 は decision-maker の受信確認、3 は 10/11 08:20 JST）
- 残留プロセス: なし
- 同根再発スキャン: 7 件目に到達し構造対処済み（上記）。対症療法判定: 該当なし
- 既知の限界: アラートは起動の失敗のみ検知（ADR に記載）。codex review の最終確認は PR #57 で 1 回未取得
