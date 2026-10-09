# ai-notebot

毎日 AI 関連のニュース・ハック・話題を収集し、出典を脚注で紐付けた日本語ブログ記事を自動生成・公開するプロジェクト。

## アーキテクチャ

```
collect.mjs (RSS/HN/Reddit/arXiv/GitHub) → data/raw/YYYY-MM-DD.json
    ↓
curate.mjs (Vertex AI gemini-3.5-flash-lite) → site/src/content/posts/YYYY-MM-DD.md
    ↓
validate-citations.mjs (脚注が data/raw に解決するか機械検証。1件でも未解決なら exit 1)
    ↓
images.mjs (Vertex AI gemini-3.1-flash-lite-image で hero.jpg 1枚) → site/public/images/YYYY-MM-DD/
    ↓
Astro build → dist/ → GitHub Pages
```

`data/raw/*.json` が唯一のファクト源。記事本文の全主張は `[^s-<id>]` 形式の脚注でこの JSON の
エントリに紐付く。未解決の脚注が1件でもあればビルドを失敗させ、ハルシネーションを含む記事を
公開しない設計（詳細: `docs/adr/`）。

### 週刊AIトレンドまとめ（別枠パイプライン、AIトレンド版のみ対象）

```
weekly.yml（毎週日曜08:30/09:30/10:30 JSTの3回cron、daily.ymlとconcurrency.group=daily-digestを共用。
  11時を過ぎると遅すぎるとの運用要件により2026-09-27に11:07単発から前倒し・複数化。詳細:
  docs/adr/adr-2026-09-14-schedule-reliability.md）
  curate-weekly.mjs（対象週=公開日の前日から遡って直近7日分。cronは日曜のみ発火するため
    通常は前日曜〜土曜になるが、weeklyWindow()自体は曜日非依存。手動実行で日曜以外を
    指定するとweekStartも日曜以外になり警告が出る）の site/src/content/posts/<date>.md の
    frontmatter sourceIds だけを候補プールにする。data/raw全件は見ない）
    → site/src/content/weekly/<weekStart>.md（スラッグは公開日ではなく週の開始日）
  validate-citations.mjs --type=weekly（weeklyWindow()で対象7日を再計算しvalidIdsをunion）
```

実在する日次記事が5日未満の週は生成を中止する（安全側フェイルセーフ）。hero画像は新規生成
せず、その週で実際に生成済みのhero.jpgを1枚OGP用に使い回す。詳細:
`docs/adr/adr-2026-09-14-weekly-digest.md`。

### 介護版「今日のAI活用ハック」（別枠パイプライン）

```
build-care.mjs（オーケストレータ。失敗しても本体の生成・公開は止めず、常に exit 0）
  ├─ collect-care.mjs (Vertex AI Google検索グラウンディング → 介護DXテーマを調査・出典を
  │    到達性検証) → data/raw-care/YYYY-MM-DD.json
  ├─ curate-care.mjs (グラウンディングなし・responseSchemaのみ。data/raw-care だけを材料に
  │    構造化生成 + style-guardでAIっぽい表現を検査)
  │    → site/src/content/care/YYYY-MM-DD.md
  └─ validate-citations.mjs --type=care（AIトレンド版と共有のゲート。テーブル免除なし）
    ↓
Astro build → dist/ → GitHub Pages（/care/YYYY-MM-DD/）
```

Google検索グラウンディングと `responseSchema` 構造化出力は同一リクエストで併用できない
（Vertex AI公式仕様）ため2段階に分離している。詳細: `docs/adr/adr-2026-09-11-care-hack-grounded-research.md`。

## GCP / GitHub

- GCP プロジェクト: `ai-notebot-yh`（アカウント `hy.unimail.11@gmail.com`）
- テキストモデル: `gemini-3.5-flash-lite`（`GEMINI_MODEL` env で変更可）
- 画像モデル: `gemini-3.1-flash-lite-image`（`locations/global` 固定。`IMAGE_MODEL` env で変更可）
- 認証: CI は WIF（`google-github-actions/auth@v3`）、API キー・SA JSON は一切使わない
- GitHub: `yasushi-honda/ai-notebot`（Public）、公開先は GitHub Pages
- アクセス解析: Google Analytics 4（プロパティ「ai-notebot」、測定 ID `G-WX6W8ER2LG`、アカウント `hy.unimail.11@gmail.com`）を `site/src/layouts/BaseLayout.astro` に導入済み

### 起動経路（schedule 欠落対策）

```
Cloud Scheduler (daily 07:00 / weekly 日曜08:20 JST) → Cloud Workflows `github-dispatch`
  → GitHub App のインストールトークン（KMS 署名の JWT で毎回発行、1時間で失効）で GitHub API
  → daily.yml / weekly.yml の workflow_dispatch（skip_if_exists=true）
GitHub の cron（保険）は従来どおり残す。冪等性ガードで二重生成しない。
```

GCP 側のリソース（SA・KMS 署名鍵・Workflows・Schedulerジョブ・失敗通知アラート）は
`infra/scheduler/setup.sh` で冪等に再現できる。GitHub App の作成と秘密鍵の KMS インポートは
`infra/scheduler/bootstrap-github-app.mjs`（一度きり。長期の秘密情報（PAT 等）は GCP に置かない）。詳細: `docs/adr/adr-2026-10-06-cloud-scheduler-dispatch.md`。

## コマンド

```bash
node scripts/collect.mjs                    # 収集 → data/raw/<today>.json
node scripts/verify-archive.mjs <date>       # 収集結果の検証
node scripts/curate.mjs <date>               # 記事生成
node scripts/validate-citations.mjs <date>   # 出典検証（未解決0件を強制）
node scripts/images.mjs <date>               # 画像生成
node scripts/build-care.mjs <date>           # 介護版オーケストレータ（collect-care→curate-care→gate）
node scripts/validate-citations.mjs <date> --type=care  # 介護版の出典検証を単独実行
node scripts/curate-weekly.mjs <publishDate>              # 週刊まとめ生成（対象は前日から遡って7日間）
node scripts/validate-citations.mjs <publishDate> --type=weekly  # 週刊まとめの出典検証を単独実行
cd site && npm run build                     # 静的サイトビルド
node --test scripts/**/*.test.mjs            # 単体テスト

# 介護版だけを独立して手動再生成・デプロイ（daily.ymlはAIトレンド版と一括実行するため使えない場合。詳細: docs/adr/adr-2026-09-12-care-rebuild-independent-workflow.md）
gh workflow run care-rebuild.yml -f date=YYYY-MM-DD -f regenerate=true   # 再収集からやり直す
gh workflow run care-rebuild.yml -f regenerate=false                     # 既存コミット済み内容のままサイト全体を再ビルド・デプロイのみ

# 週刊まとめを手動実行（通常は毎週日曜08:30/09:30/10:30 JSTに自動実行。詳細: docs/adr/adr-2026-09-14-weekly-digest.md）
gh workflow run weekly.yml -f date=YYYY-MM-DD   # 指定公開日（省略時は当日JST）で対象週を再生成
```

## 開発時の注意

- `scripts/` は Node 22+ 標準 fetch のみで動く設計（依存パッケージなし）。新規パッケージ追加は避ける。
- `data/raw/*.json` は git にコミットする（アーカイブの実体）。`site/public/images/` も同様。
- ローカル実行前に `direnv allow`（`.envrc` が `CLOUDSDK_ACTIVE_CONFIG_NAME=ai-notebot` を設定）。
- `GEMINI_ACCESS_TOKEN=$(gcloud auth print-access-token --account=hy.unimail.11@gmail.com)` を都度取得。
- GitHub Pages への自動デプロイは `daily.yml` のみがトリガー。起動経路は2系統ある: ①主: GCP Cloud Scheduler（毎日 07:00 JST）→ Cloud Workflows → `workflow_dispatch`（`skip_if_exists=true`、生成済みならスキップ）、②保険: GitHub の cron（07:07 / 08:07 / 09:07 JST。GitHub Actions の schedule は遅延・欠落するため保険扱い。GitHub Actions公式が毎時00分は高負荷で遅延しやすいと明記しているため数分ずらしている）。週刊まとめも同様（Scheduler 日曜 08:20 JST + GitHub cron 3回）。認証は GitHub App + Cloud KMS のため PAT の更新作業は無い。詳細・鍵ローテーション手順: `docs/adr/adr-2026-10-06-cloud-scheduler-dispatch.md`、リソースの作成手順: `infra/scheduler/setup.sh`。`ci.yml` は PR 時の型チェック・ビルド確認のみで、`main` への push（PR マージ含む）単体では自動デプロイされない。コード変更だけを今すぐ本番反映したい場合は `gh workflow run care-rebuild.yml -f regenerate=false`（再収集なし・サイト全体を再ビルドしてデプロイのみ）を使う。
