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
images.mjs (Vertex AI gemini-3.1-flash-lite-image) → site/public/images/YYYY-MM-DD/*.jpg
    ↓
Astro build → dist/ → GitHub Pages
```

`data/raw/*.json` が唯一のファクト源。記事本文の全主張は `[^s-<id>]` 形式の脚注でこの JSON の
エントリに紐付く。未解決の脚注が1件でもあればビルドを失敗させ、ハルシネーションを含む記事を
公開しない設計（詳細: `docs/adr/`）。

## GCP / GitHub

- GCP プロジェクト: `ai-notebot-yh`（アカウント `hy.unimail.11@gmail.com`）
- テキストモデル: `gemini-3.5-flash-lite`（`GEMINI_MODEL` env で変更可）
- 画像モデル: `gemini-3.1-flash-lite-image`（`locations/global` 固定。`IMAGE_MODEL` env で変更可）
- 認証: CI は WIF（`google-github-actions/auth@v3`）、API キー・SA JSON は一切使わない
- GitHub: `yasushi-honda/ai-notebot`（Public）、公開先は GitHub Pages

## コマンド

```bash
node scripts/collect.mjs                    # 収集 → data/raw/<today>.json
node scripts/verify-archive.mjs <date>       # 収集結果の検証
node scripts/curate.mjs <date>               # 記事生成
node scripts/validate-citations.mjs <date>   # 出典検証（未解決0件を強制）
node scripts/images.mjs <date>               # 画像生成
cd site && npm run build                     # 静的サイトビルド
node --test scripts/**/*.test.mjs            # 単体テスト
```

## 開発時の注意

- `scripts/` は Node 22+ 標準 fetch のみで動く設計（依存パッケージなし）。新規パッケージ追加は避ける。
- `data/raw/*.json` は git にコミットする（アーカイブの実体）。`site/public/images/` も同様。
- ローカル実行前に `direnv allow`（`.envrc` が `CLOUDSDK_ACTIVE_CONFIG_NAME=ai-notebot` を設定）。
- `GEMINI_ACCESS_TOKEN=$(gcloud auth print-access-token --account=hy.unimail.11@gmail.com)` を都度取得。
