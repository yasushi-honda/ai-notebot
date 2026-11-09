# ハンドオフ（最新）

- セッション: 2026-11-09（セキュリティ版 11-09 分の未生成の復旧。PR #87 マージ、Issue #86 クローズ）
- 更新日: 2026-11-09

## セッション概要

### セキュリティ版 11-09（月）が未生成（Issue #86、PR #87）
`/catchup` 時点で 07:00 JST の daily が「候補 1 件 < 閾値 10 件」でセキュリティ版を打ち切っていた（AI 版の候補は 57 件で、RSS 取得の障害ではない）。
- **原因**: 土日（鮮度窓 5 日、PR #84）の記事が週末の新着を使い切り、月曜は窓が 3 日に戻る。窓内の約 13 件のうち 12 件が使用済みで、7 日の重複排除により候補は 1 件になった。#84 の副作用で、コードのバグではなく設計上の穴
- **修正（PR #87）**: `effectiveMaxAgeDays()` の対象を土日月に拡張（`weekendMaxAgeDays` を月曜にも適用）。ADR・テスト（月=5日・火=3日）を更新。実フィードで 11-09 の候補は 12 件（閾値 10 に対し余裕は小さい）
- **復旧**: マージ後に `daily.yml -f skip_if_exists=true` を手動実行（run 42539414546、success）。`site/src/content/security/2026-11-09.md` が生成された。Issue #86 はクローズ済み

### 公的機関が 0 件の日（11-08・11-09）の調査（read-only、修正なし）
- 4 フィード（JPCERT/CC・IPA・JVN・CISA）は全て取得でき、5 日窓内に公的機関の項目が 15 件以上あった
- 11-06・11-07 の記事が CISA 4 件・JPCERT/CC・JVN を使用済みで、7 日の重複排除により 11-08 以降の候補から外れた。金曜 11-06 以降に公的機関の新着がほぼ無い
- 結論: 不具合ではなく、週末の更新停止と使用済みの重なり。火曜以降は自然に解消する見込み。重複排除を縮める案は再掲が増えるため見送り

### 条件待ち 14（#84 の本番効果）の結果
11-07（土）は公的機関の項目あり（CISA 4 件・JPCERT/CC 1 件）で、窓拡張は効いた。11-08（日）は 0 件だが、上記のとおり使用済みが理由。

## ドキュメント整合性

| 項目 | 状態 | 備考 |
|------|------|------|
| ADR | ✅ | `adr-2026-10-29-security-digest.md` の鮮度窓を「火〜金 3 日、土日月 5 日」に更新 |
| CLAUDE.md ↔ 実装 | ✅ | 収集条件のみの変更で構成の記述に影響なし |
| 完了ステータス一致 | ✅ | PR #87 マージ済み、Issue #86 クローズ |

## Git状態

| 項目 | 状態 |
|------|------|
| 未コミット変更 | なし（本ハンドオフ PR を除く） |
| CI/CD | ✅ 手動 daily（run 42539414546）success。PR #87 にはチェックが出なかった（`ci.yml` は PR 時の対象外の可能性） |

## 品質ゲート

| 項目 | 状態 |
|------|------|
| codex review | PR #87: 1 回（medium、指摘 0 件。codex のサンドボックスは読み取り専用で mkdtemp を使うテストは EPERM。環境制約でコードの問題ではない） |
| テスト | ✅ `collect-core.test.mjs` 10 件 pass（ローカル）。全体件数の再計測は未実施 |
| 実機動作確認 | ✅ 実フィードで候補 12 件、手動 daily で 11-09 の記事を生成 |

## 同根再発スキャン（§4.6）と対症療法判定（§4.7）

- `fix:` は PR #87 の 1 件。ただし根は 11-01 の #83・#84 と同じ「週末前後の供給変動 × 鮮度窓・重複排除」で、**同根候補あり（過去 8 日に 2 件）**
  - 仮説: ①週末前後は供給が減り、窓と重複排除の組み合わせで候補が枯れる（今回は月曜を対応）②週の途中の祝日（次は 11-23 勤労感謝の日・月）も同じ枯渇が起きうる③今回の窓拡張後も候補 12 件で、閾値 10 との余裕が小さい
  - 次に出るとしたら: 火曜（窓 3 日）に、月曜が 5 日窓で多く消費した後の枯渇
- 対症療法判定: 原因（窓の消費）を実データで特定済みで、retry/fallback ではなく供給側の対応のため**該当なし**。ただし閾値 10 に対し候補 12 件の余裕は小さい

## 次のアクション（3分割・SKILL.md §2.5）

### 即着手タスク
即着手タスクなし（残りは日時・decision-maker の確認待ち）。

### 条件待ち（明示trigger付き）

| # | 項目 | trigger（充足条件） | 充足時のタスク | 充足確認方法 |
|---|------|------------------|--------------|------------|
| 1 | **火曜 11-10 の候補件数の確認**（月曜 5 日窓の消費後の枯渇） | 2026-11-10（火）の daily 実行の後 | read-only で `data/raw-security/2026-11-10.json` の件数と `::warning::[collect-security]` を確認。閾値 10 未満で止まるなら火曜も窓を広げるか、重複排除の見直しを提案（write は指示後） | `gh run list --workflow=daily.yml`、`gh run view <id> --log \| grep "collect-security\|後の件数"` |
| 2 | **対策の空率の測定と、公式補助取得の要否判断** | セキュリティ版の記事が 5 日分以上そろっている（満たした）。決裁者の指示または次の点検機会 | read-only で記事ごとの対策件数・`::warning::`・要約補強の成功率・除外テーマ数を集計し、別モデルで出典忠実性を再監査。空率が高ければ plan mode で設計提案 | `site/src/content/security/*.md` の `### すぐできる対策` を集計 |
| 3 | **用語辞書の定義文の人による確認** | decision-maker が辞書（46語）を確認、または確認を依頼 | 誤りがあれば `security-glossary.mjs` を修正（write は指示後） | `scripts/lib/security-glossary.mjs` の `SECURITY_TERMS` |
| 4 | **次の祝日（11-23 勤労感謝の日・月）の収集確認** | 2026-11-23 の daily 実行の後 | 月曜は 5 日窓になったので枯渇は緩和されるはずだが、公的機関の項目数と件数を read-only で確認 | `data/raw-security/2026-11-23.json` をソース別に集計 |
| 5 | AI 版 `curate.mjs` の本文に生 HTML・リンクの拒否を入れる | decision-maker からの修正指示 | セキュリティ版の `findUnsafeMarkup` を AI 版の Stage B の `evaluate` にも適用する（介護版には既にある）。本文は外部フィードに影響されるため同じ経路で露出している。修正（write）なので起点は decision-maker | `grep -n findUnsafeMarkup scripts/curate.mjs`（現状ヒットなし） |
| 6 | Stage B のテーマ除外の実環境確認（前回から継続） | daily の run ログに「除外したテーマ」が頻発した時 | 10/24 の run で 1 件（脚注欠落 3 試行連続 NG）を確認済み。頻発するなら脚注指示の見直し | `gh run view <id> --log \| grep '除外したテーマ'`（リポジトリ内で実行） |
| 7 | NVIDIA Developer Blog の追加（前回から継続） | `developer.nvidia.com` の名前解決が安定して通ること | `fetchFeed` 経由で取得・直近 3 日の新着を確認し、問題なければ `feeds.mjs` に 1 行追加 | `node -e` で `fetchFeed` を呼ぶ（`scripts/lib/rss.mjs`） |
| 8 | Reddit 429 の再発（前回から継続） | 収集失敗が収集成功しきい値に影響した時 | 10/24・10/25 の run でも `Reddit r/MachineLearning`・`r/artificial` が HTTP 429（他ソースは生きており記事は生成された）。`collect.mjs` の Reddit 取得のリトライ・バックオフを read-only で調査 | `gh run list --workflow=daily.yml` の失敗 run のログ |
| 9 | アラートメールの受信確認（前回から継続） | decision-maker が `hy.unimail.11@gmail.com` の受信箱を確認（AI 代行不可） | 届いていなければ通知チャネルを調査 | decision-maker 本人が確認 |
| 10 | GA4 データ反映の再確認（前回から継続） | decision-maker 本人の Google ログインでの確認（AI 代行不可） | analytics.google.com で DebugView / リアルタイムレポートを確認 | decision-maker 本人が確認 |
| 11 | 「福祉用具」targetServices が生成記事で選ばれるか（前回から継続） | 次回以降の daily.yml / care-rebuild.yml の自然な実行（確率的） | `site/src/content/care/` の新規記事に出現するか確認。長期間出現しなければ `collect-care.mjs` のテーマ指示を見直す | `grep -l '福祉用具' site/src/content/care/*.md` |
| 12 | `content.config.ts` の themes フィールド影響分析（前回から継続） | decision-maker からの実行指示 | `/impact-analysis` 実行（read-only） | 明示指示の有無 |
| 13 | care-rebuild.yml の FETCH_HEAD 方式への統一（前回から継続） | 次に care-rebuild.yml の YAML 自体を編集する用事、または明示指示 | Sync ステップを `git fetch origin main && git reset --hard FETCH_HEAD` に統一 | `grep -n "git reset" .github/workflows/care-rebuild.yml` |

> 上表の 5〜13 は前回から継続（5＝AI 版 `curate.mjs` の生 HTML 拒否、6＝Stage B のテーマ除外、7＝NVIDIA ブログ、8＝Reddit 429、9＝アラートメール、10＝GA4、11＝福祉用具、12＝`content.config.ts` 影響分析、13＝care-rebuild の FETCH_HEAD）。前回の 1（11-02 以降の用語確認）・14（#84 の効果）・15（11-01 記事の再生成）は完了または陳腐化のため削除（14 は上記のとおり確認済み）。

### 却下候補（記録のみ）

| # | 項目 | 検討経緯 | 着手しない理由 | 参照条件 |
|---|------|---------|--------------|---------|
| 1 | 数値・バージョン・日付の機械照合ゲート（案 A） | 過去 42 日・数値を含む 235 文で試算 | 不一致 27 件はすべて誤検出で、実質の数値誤りは 0 件。10/29 のセキュリティ記事の監査でも数値は全て一致 | decision-maker からの明示指示、または別モデル監査で数値誤りが実際に出た時 |
| 2 | 別モデルによる裏付け判定を生成時のゲートに組み込む（案 B） | 意味の忠実性の監査で有効性は示唆された | #67 の効果は確認済みで必要性は下がった。コストと再生成の増加を伴う | decision-maker が指示した時 |
| 3 | 英語・欧州言語の語句の写し込み検出（案 C） | 簡体字検出の延長で検討 | 製品名・固有名詞の例外が多く誤検出が見込まれる。実害の報告がない | decision-maker からの明示指示時のみ |
| 4 | 公式の対策節・用語解説を補助資料として別途収集する工程（codex 提案） | セキュリティ版で対策が空になりやすい対策として検討（用語は固定辞書で解消済み） | 初版では軽量版（抜粋を 1500 字に拡大し対策節優先）で始め、実データで空率を測る判断（decision-maker 確認済み）。条件待ち 2 の結果で判断 | 条件待ち 2 で空率が高いと分かり、decision-maker が指示した時 |
| 5 | 更新された注意喚起（同一 URL）の再採用 | JPCERT の注意喚起は同じ URL に追記される（codex 指摘） | 既存の既出 URL 除外をそのまま使う。更新の取りこぼしが実際に分かった時点で追加する | 取りこぼしが確認された時、または decision-maker の指示 |
| 6 | 除外したテーマの出典を、翌日以降の既出 URL 扱いから外す | silent-failure-hunter 指摘（AI 版と同じ設計だがセキュリティ版は影響が大きい） | `::warning::` で見える。重要情報の取りこぼしが実際に起きてから | 取りこぼしが確認された時 |
| 7 | 週刊まとめへのセキュリティ版の組み込み、`curate-weekly.mjs` の Stage A/B 重複の解消、Cloud Scheduler の変更 | セキュリティ版の範囲検討 | 要望は「毎日」で週刊は別パイプライン。重複の解消は週刊の挙動変更リスク。Scheduler は `daily.yml` 内のステップ追加で足りた | decision-maker からの明示指示時のみ |
| 8 | `rehype-sanitize` の導入 | stored XSS の対策案として提示された | 既存の版の表示（`<strong>`・介護版の要素）に影響しうる。入力側の拒否・無害化で塞いだ | 入力側の対策で漏れが見つかった時 |
| 9 | 追加ソース候補: Krebs on Security（直近 3 日新着なし）、Wired AI、Hamel Husain、One Useful Thing、Google DeepMind、Mistral、heise（ドイツ語） | 海外ソース・セキュリティソースの拡充検討 | 更新が少ない、AI 専用でない、ドイツ語混入のリスク | decision-maker からの明示指示時のみ |
| 10 | Anthropic 公式ブログの RSS | 2026-10-20 に再確認（404） | 公式提供なし。Claude Code のリリースノートで代替済み | 公式が RSS を提供した時 |
| 11 | Stage B の試行回数の増加（3 → 5 回）、`setup.sh deploy` の全体再適用、「当日記事が無い」ことの外部検知監視、インストールトークンの明示的な revoke、curate-care の品質ゲート再設計、福祉用具の貸与・販売の分離分類、workArea フィルタ / 関連記事リンク / 介護版カテゴリ偏り是正 / GA4 Data API 自動取得 / GA4 プロパティ再作成 / YouTube 動画コーナー / `source-tier.mjs` official ホワイトリスト拡張 / `/posts/[date]/` 詳細ページ h1 定型文（前回から継続） | 前回までの検討 | いずれも ROI 低、または decision-maker 起点の指示がない | decision-maker からの明示指示時のみ |

> ⚠️ 「優先順にすすめて」等の包括指示では上記却下候補は一切参照しない。条件待ちは trigger 充足を確認してから昇格する。
| 12 | 用語辞書の拡張・「新着の用語」絞り込み・用語ごとの出現記事一覧 | 用語集ページの発展として検討（AI が発想した候補） | 起点は decision-maker 領分。語数が増えて困る実害が出ていない | decision-maker からの明示指示時のみ |

> ⚠️ 「優先順にすすめて」等の包括指示では上記却下候補は一切参照しない。条件待ちは trigger 充足を確認してから昇格する。

| 13 | 重複排除の窓（7日）を縮めて公的機関の再掲を許す | 11-08・11-09 の公的機関 0 件の対策として検討（AI が発想） | 再掲が増え記事の新鮮さが落ちる。火曜以降に自然解消する見込み | 公的機関 0 件が火〜金にも繰り返された時、または decision-maker の指示 |

### 再開可能性判定
✅ **再開可能** - 次回は条件待ち 1（11-10 の候補件数）から始める。

## 申し送り

- `gh pr merge` は単独コマンドでないと `pr-merge-gate` が拒否する（パイプ `| tail` も不可）。マージ前に最新コミットの CI（`gh pr checks`）を確認する
- 手動の `daily.yml`（入力なし）は AI 版・介護版・セキュリティ版をすべて作り直す。1 つの版だけ作り直したいときは、ローカルで `GEMINI_ACCESS_TOKEN=$(gcloud auth print-access-token --account=hy.unimail.11@gmail.com)` を渡して `node scripts/curate-security.mjs <date>`（収集済みの JSON を使う）→ `validate-citations.mjs <date> --type=security` → PR、が最小の範囲。反映は `care-rebuild.yml -f regenerate=false`
- BSD `sed -i` は日本語を含む置換で `unescaped newline` エラーになることがある。Edit ツールか Python で置換する（`&&` 連結だと後続が実行されずに気付きにくい）
- Playwright のスクリーンショット・保存先は `.playwright-mcp/` かリポジトリ配下に限られる（スクラッチパッドは不可）。ローカルのプレビューは `npx astro preview --port N`、終了時は `npx astro preview stop`
- `codex review` の 1 ブランチ上限 2 回を超える場合は AskUserQuestion で承認を得た後に限り `CODEX_REVIEW_APPROVED=1` を付けて再実行できる（自己判断での付与は不可）
- 公的機関のフィードは JPCERT/CC と JVN が同じ URL（`jvn.jp/vu/...`）を共有するため、片方で使用済みになると他方も既出扱いになる

## 残留プロセス

✅ 残留 Node プロセスなし（マシン全体チェック）。

## Issue Net 変化
- Close 数: 1 件 (#86)
- 起票数: 0 件
- Net: 1 件

## 最終結論

✅ **セッション終了可** — 11-09 分を復旧し、月曜の枯渇の根を直した（PR #87、Issue #86 クローズ）。

- OPEN PR: 本ハンドオフ PR のみ / open Issue: 0 件 / Git clean / 即着手 = 0、条件待ち = 13
- §4.6 同根再発スキャン: 候補 2 件（#83・#84、仮説と次の経路は上記）/ §4.7 対症療法判定: 該当なし
- 未確認: 火曜 11-10 の候補件数（条件待ち 1）、11-23 祝日の挙動
