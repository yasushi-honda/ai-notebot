# ADR: daily の起動枠を 07/08/09 時台の 3 回に変更

- 日付: 2026-10-09
- ステータス: 採用（GCP の Scheduler ジョブへの再適用はマージ後）

## 背景

2026-10-09 に 06:00 JST の Scheduler 経由が Reddit 429、10:09 JST の cron が出典チェック NG
（Stage B の脚注欠落）で連続して失敗し、最後の砦だった 12:07 JST 枠では公開が遅すぎると判断した。
weekly は既に 08:30/09:30/10:30 JST に前倒し済み（`adr-2026-09-14-weekly-digest.md`）。

## 決定

| 経路 | 変更前 | 変更後 |
|---|---|---|
| Cloud Scheduler `daily-digest-dispatch` | 毎日 06:00 JST | 毎日 07:00 JST |
| GitHub cron（保険） | 06:07 / 12:07 JST（`7 21,3 * * *`） | 07:07 / 08:07 / 09:07 JST（`7 22,23,0 * * *`） |

- 全枠 `skip_if_exists` により、生成済みなら 2 回目以降は何もしない。
- 毎時 00 分を避けて 07 分にずらす方針は従来どおり。
- 日曜は weekly（Scheduler 08:20、cron 08:30〜10:30）と同一 concurrency group（`queue: max`）で直列化される。daily は約 2 分で終わるため待ちは数分。

## 適用

- `.github/workflows/daily.yml` の cron は PR マージで有効になる。
- Scheduler は `bash infra/scheduler/setup.sh deploy` の再実行（冪等）が必要。マージ後に別途実施する。
