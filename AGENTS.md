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

## コマンド

```bash
node scripts/collect.mjs                    # 収集 → data/raw/<today>.json
node scripts/verify-archive.mjs <date>       # 収集結果の検証
node scripts/curate.mjs <date>               # 記事生成
node scripts/validate-citations.mjs <date>   # 出典検証（未解決0件を強制）
node scripts/images.mjs <date>               # 画像生成
node scripts/build-care.mjs <date>           # 介護版オーケストレータ（collect-care→curate-care→gate）
node scripts/validate-citations.mjs <date> --type=care  # 介護版の出典検証を単独実行
cd site && npm run build                     # 静的サイトビルド
node --test scripts/**/*.test.mjs            # 単体テスト

# 介護版だけを独立して手動再生成・デプロイ（daily.ymlはAIトレンド版と一括実行するため使えない場合。詳細: docs/adr/adr-2026-09-12-care-rebuild-independent-workflow.md）
gh workflow run care-rebuild.yml -f date=YYYY-MM-DD -f regenerate=true   # 再収集からやり直す
gh workflow run care-rebuild.yml -f regenerate=false                     # 既存コミット済み内容のままサイト全体を再ビルド・デプロイのみ
```

## 開発時の注意

- `scripts/` は Node 22+ 標準 fetch のみで動く設計（依存パッケージなし）。新規パッケージ追加は避ける。
- `data/raw/*.json` は git にコミットする（アーカイブの実体）。`site/public/images/` も同様。
- ローカル実行前に `direnv allow`（`.envrc` が `CLOUDSDK_ACTIVE_CONFIG_NAME=ai-notebot` を設定）。
- `GEMINI_ACCESS_TOKEN=$(gcloud auth print-access-token --account=hy.unimail.11@gmail.com)` を都度取得。
- GitHub Pages への自動デプロイは `daily.yml`（毎朝 09:00 JST のスケジュール実行）のみがトリガー。`ci.yml` は PR 時の型チェック・ビルド確認のみで、`main` への push（PR マージ含む）単体では自動デプロイされない。コード変更だけを今すぐ本番反映したい場合は `gh workflow run care-rebuild.yml -f regenerate=false`（再収集なし・サイト全体を再ビルドしてデプロイのみ）を使う。
