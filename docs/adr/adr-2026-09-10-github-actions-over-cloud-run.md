# ADR: 日次実行基盤に GitHub Actions cron を採用し、Cloud Run Jobs は採らない

- 日付: 2026-09-10
- 状態: 確定

## Context

毎日1回、数分で終わる「収集→記事生成→画像生成→サイトビルド→公開」のパイプラインを動かす基盤を選ぶ必要があった。候補は主に2つ:

1. GitHub Actions の `schedule: cron` + `workflow_dispatch`
2. Cloud Scheduler + Cloud Run Jobs（Docker イメージ・Artifact Registry・デプロイ用 WIF が別途必要）

## Decision

GitHub Actions cron を採用した。

## Rationale

- 実行時間は1日1回・数分程度で、Cloud Run Jobs が得意とする「長時間処理・重い依存」には該当しない。
- public リポジトリのため GitHub Actions の実行時間はほぼ無料。GCP 側は Vertex AI 呼び出しのみで済み、Docker ビルド・Artifact Registry・Cloud Run 用の追加デプロイパイプラインが不要になる。
- 生成物（`data/raw/*.json`・記事・画像）を git にコミットすること自体がアーカイブの実体であり、GitHub Actions ならリポジトリと同じ場所で完結する。
- 既存プロジェクト `kaifukuhonpo-syllabus` の `daily-news.yml` が同型のパターンで安定運用されており、そのまま踏襲できた（依存パッケージゼロの Node スクリプト + WIF 認証）。

## Consequences

- Cloud Run Jobs 特有の柔軟性（長時間実行・リトライポリシーの細かい制御・並列実行）は使えないが、現状の要件では不要。
- 将来、収集ソースが増えて実行時間が伸びたり、リトライ制御を細かくしたくなった場合は Cloud Run Jobs への移行を再検討する。
