# ハンドオフ（最新）

- セッション: 2026-11-01（セキュリティ版 11-01 分の未生成の復旧と、週末の収集条件の見直し。PR #83・#84 マージ、11-01 分は本番反映済み）
- 更新日: 2026-11-01

## セッション概要

### セキュリティ版 11-01 分が未生成（Issue #82、PR #83）
decision-maker の報告:「2026年11月1日分が作られてない」。daily の 2 回の実行（07:01・09:58 JST）で、収集の候補件数が 19 件となり、下限 20 件に 1 件足りず `collect-core.mjs` が打ち切っていた。ワークフローは success のまま（セキュリティ版が落ちても本体は止めない設計）で、失敗は Issue #82 の自動起票だけで通知される。
- **原因**: 日曜は RSS の記事数が減る。過去 3 日は 51 → 39 → 38 件で、日曜に 19 件へ落ちた
- **修正（PR #83）**: `minTotalItems` を 20 → 10。ADR のしきい値の記述を更新。マージ後に `daily.yml -f skip_if_exists=true` を手動実行し、11-01 分を生成（裏取り率 100%、36/36 文）。Issue #82 は自動クローズ

### 公的機関の一次情報が空だった件（PR #84）
再生成のログに「公的機関（JPCERT/CC・IPA・JVN・CISA）の項目が 1 件もありません」の警告が出ていた。
- **原因**: 取得の不具合ではない（9 ソース全て成功）。JPCERT/CC の最新は 10-29（木）、CISA は 10-30（金）で、11-01（日）の収集時点では鮮度窓（3 日）を過ぎていた。週末は公的機関の更新が止まる
- **修正（PR #84）**: 土日（JST）だけ鮮度窓を 5 日に広げる（`collect-core.mjs` の `effectiveMaxAgeDays()`、`weekendMaxAgeDays`）。AI 版・介護版は未指定で挙動不変。重複排除（7 日）は変えない。11-01 の記事自体は一次情報なしのまま（再生成していない）
- **品質ゲート**: テスト先行（Red 確認後に実装）。codex review 1 回（medium、指摘 0 件）

### 訂正・学び
テストを先に書いた際、比較対象の日付を誤り（金曜 10-30 の窓にも 10-28 が入る）、テスト側の誤りで 1 件失敗した。月曜 11-02 に直して解消。実装の誤りではなかった。

## ドキュメント整合性

| 項目 | 状態 | 備考 |
|------|------|------|
| ADR | ✅ | `adr-2026-10-29-security-digest.md` のしきい値（10 件）と鮮度窓（平日 3 日・土日 5 日）を追記 |
| CLAUDE.md ↔ 実装 | ✅ | 変更は収集条件のみで、構成の記述に影響なし |
| 完了ステータス一致 | ✅ | PR #83・#84 マージ済み、Issue #82 クローズ。#84 の本番効果は次の土日まで未確認 |

## Git状態

| 項目 | 状態 |
|------|------|
| 未コミット変更 | なし（本ハンドオフ PR を除く） |
| 未プッシュコミット | なし（`main` = `origin/main` = `aaba8d7`、本ハンドオフ PR を除く） |
| CI/CD | ✅ PR #83・#84 とも test・GitGuardian が PASS。手動の daily（run 41268185425）も success |

## 品質ゲート

| 項目 | 状態 |
|------|------|
| codex review | PR #84: 1 回（medium、指摘 0 件）。PR #83 は実コード 1 行（定数 1 つ）のため対象外 |
| テスト | ✅ 427 件全 PASS（開始時 424 件＋鮮度窓 3 件） |
| 実機動作確認 | ✅ 手動 daily で 11-01 分を生成。本番の `/security/2026-11-01/` が 200、一覧にリンクあり。#84 の週末窓は本番で未確認（実データの土日が来ていない） |

## 同根再発スキャン（§4.6）と対症療法判定（§4.7）

- `fix:` は PR #83・#84 の 2 件で、**同根候補あり（本セッション内）**。どちらも「週末は収集元の供給が減る」が根にある。ただし #84 は #83 の再発ではなく、#83 の再生成ログから見つけた別の影響（件数でなく公的機関の欠落）の対応
  - 仮説: ①週末の供給低下（対応済み: 件数＝#83、公的機関＝#84）②祝日・連休は土日の条件に入らず、同じ事象が起きうる（11-03（火・文化の日）が次の該当）③民間メディアも日曜は少ないので、10 件の下限でも薄い記事になりうる
  - 次に出るとしたら: 11-03 の祝日に公的機関の項目が空になる経路。条件待ち 2 に追加
- 過去 7 日の handoff archive: 同症状の記載なし
- 対症療法判定: #83 は下限の緩和だが、ADR で当初から「暫定値、休日の実データで見直す」とされていた項目で、原因（日曜の供給低下）はログと実データで特定済み。#84 は供給側（鮮度窓）の対応。同症状の修正が過去 30 日にないため**該当なし**

## 次のアクション（3分割・SKILL.md §2.5）

### 即着手タスク
即着手タスクなし（残りは日時・decision-maker の確認待ち）。

### 条件待ち（明示trigger付き）

| # | 項目 | trigger（充足条件） | 充足時のタスク | 充足確認方法 |
|---|------|------------------|--------------|------------|
| 1 | **11/02 以降の自動生成で用語が増えているかの確認**（11-01 分は 6 語で確認済み。一次情報なしの記事） | 2026-11-02（月）07:00 JST の daily 実行の後 | read-only で、`/security/2026-11-01/` の「今日の用語」が複数語か、`/security/glossary/` の語数が増えているか、`::warning::[curate-security]` の有無を確認する。あわせて本番で検索窓・行ナビが動くか（本番での操作は未確認）を見る | `curl -s https://yasushi-honda.github.io/ai-notebot/security/glossary/ \| grep -o 'data-entry' \| wc -l`、`gh run view <id> --log \| grep -E "用語\|::warning::"`（リポジトリ内で実行） |
| 2 | **対策の空率の測定と、公式補助取得の要否判断**（旧 2 を更新。用語は §9 で解消済み） | セキュリティ版の記事が 5 日分以上そろう（目安 2026-11-03 以降） | read-only で、記事ごとの対策件数・`::warning::` の頻度・要約補強の成功率・除外テーマ数を集計し、別モデル（Sonnet）で出典忠実性を再監査する（再生成後の記事と固定辞書の定義は未監査）。対策の空率が高ければ「公式の対策節を補助資料として別途収集する工程」を plan mode で設計する提案を AskUserQuestion で行う | `site/src/content/security/*.md` の `### すぐできる対策` を集計。監査の入力形式は前回（`{n,date,sentence,sources[{title,summary,source}]}`）と同じ |
| 3 | **用語辞書の定義文の人による確認** | decision-maker が辞書（46語）の定義を確認する、または確認を依頼する | 定義は AI が起草し、別系統モデル（Codex）の事実確認で 18 語の指摘を反映済み（10/31）。人の確認は未了。誤りや言い過ぎがあれば `security-glossary.mjs` を修正（write なので指示後）。確認用に辞書を一覧にした資料の生成は依頼があれば実施 | `scripts/lib/security-glossary.mjs` の `SECURITY_TERMS` |
| 4 | **祝日（11-03 文化の日・火）の収集の確認と、しきい値の見直し** | 2026-11-03 の daily 実行の後 | read-only で、11-03 の `data/raw-security/2026-11-03.json` の件数・公的機関の項目数、daily ログの `::warning::[collect-security]` を確認する。下限は 11-01 に 20 → 10 へ緩め済み。祝日は土日の鮮度窓（5 日）の対象外のため、公的機関が空になるなら祝日も窓を広げる提案をする（write は指示後） | `node -e` で `data/raw-security/2026-11-03.json` をソース別に集計、`gh run view <id> --log \| grep "collect-security"` |
| 5 | AI 版 `curate.mjs` の本文に生 HTML・リンクの拒否を入れる | decision-maker からの修正指示 | セキュリティ版の `findUnsafeMarkup` を AI 版の Stage B の `evaluate` にも適用する（介護版には既にある）。本文は外部フィードに影響されるため同じ経路で露出している。修正（write）なので起点は decision-maker | `grep -n findUnsafeMarkup scripts/curate.mjs`（現状ヒットなし） |
| 6 | Stage B のテーマ除外の実環境確認（前回から継続） | daily の run ログに「除外したテーマ」が頻発した時 | 10/24 の run で 1 件（脚注欠落 3 試行連続 NG）を確認済み。頻発するなら脚注指示の見直し | `gh run view <id> --log \| grep '除外したテーマ'`（リポジトリ内で実行） |
| 7 | NVIDIA Developer Blog の追加（前回から継続） | `developer.nvidia.com` の名前解決が安定して通ること | `fetchFeed` 経由で取得・直近 3 日の新着を確認し、問題なければ `feeds.mjs` に 1 行追加 | `node -e` で `fetchFeed` を呼ぶ（`scripts/lib/rss.mjs`） |
| 8 | Reddit 429 の再発（前回から継続） | 収集失敗が収集成功しきい値に影響した時 | 10/24・10/25 の run でも `Reddit r/MachineLearning`・`r/artificial` が HTTP 429（他ソースは生きており記事は生成された）。`collect.mjs` の Reddit 取得のリトライ・バックオフを read-only で調査 | `gh run list --workflow=daily.yml` の失敗 run のログ |
| 9 | アラートメールの受信確認（前回から継続） | decision-maker が `hy.unimail.11@gmail.com` の受信箱を確認（AI 代行不可） | 届いていなければ通知チャネルを調査 | decision-maker 本人が確認 |
| 10 | GA4 データ反映の再確認（前回から継続） | decision-maker 本人の Google ログインでの確認（AI 代行不可） | analytics.google.com で DebugView / リアルタイムレポートを確認 | decision-maker 本人が確認 |
| 11 | 「福祉用具」targetServices が生成記事で選ばれるか（前回から継続） | 次回以降の daily.yml / care-rebuild.yml の自然な実行（確率的） | `site/src/content/care/` の新規記事に出現するか確認。長期間出現しなければ `collect-care.mjs` のテーマ指示を見直す | `grep -l '福祉用具' site/src/content/care/*.md` |
| 12 | `content.config.ts` の themes フィールド影響分析（前回から継続） | decision-maker からの実行指示 | `/impact-analysis` 実行（read-only） | 明示指示の有無 |
| 13 | care-rebuild.yml の FETCH_HEAD 方式への統一（前回から継続） | 次に care-rebuild.yml の YAML 自体を編集する用事、または明示指示 | Sync ステップを `git fetch origin main && git reset --hard FETCH_HEAD` に統一 | `grep -n "git reset" .github/workflows/care-rebuild.yml` |
| 14 | **#84（土日の鮮度窓 5 日）の本番での効果確認** | 2026-11-07（土）・11-08（日）の daily 実行の後 | read-only で、`data/raw-security/2026-11-07.json`・`11-08.json` に JPCERT/CC・CISA の項目が入っているか、`公的機関の項目が1件もありません` の警告が出ていないかを確認する。窓を広げても空なら原因を再調査 | `node -e` でソース別に集計（`data/raw-security/*.json` の `items[].source`） |
| 15 | 11-01 のセキュリティ記事（一次情報なし）を再生成するか | decision-maker からの指示 | 現状の記事は民間メディアのみ。#84 の窓なら金曜までの公的機関の項目を拾える。再生成は `curate-security.mjs` が前提の収集済み JSON を使うため、収集からやり直す必要があり、手動 `daily.yml` は AI 版・介護版も作り直す（申し送り参照）。decision-maker が必要と判断したら範囲を相談する | 明示指示の有無 |

> 上表の 5 以降は前回の 4〜13 を継続（14・15 は今セッションで追加。4 は祝日の確認に更新）。以下は前回の対応表（4＝セキュリティ版のしきい値、5＝AI 版 `curate.mjs` の生 HTML 拒否、6＝Stage B のテーマ除外、7＝NVIDIA ブログ、8＝Reddit 429、9＝アラートメール、10＝GA4、11＝福祉用具、12＝`content.config.ts` 影響分析、13＝care-rebuild の FETCH_HEAD）。

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

### 再開可能性判定
✅ **再開可能** - ドキュメントから開発再開できます。次回は条件待ち 1（11-02 以降の自動生成の確認）と 4（11-03 祝日）から始める。

## 申し送り

- `gh pr merge` は単独コマンドでないと `pr-merge-gate` が拒否する（パイプ `| tail` も不可）。マージ前に最新コミットの CI（`gh pr checks`）を確認する
- 手動の `daily.yml`（入力なし）は AI 版・介護版・セキュリティ版をすべて作り直す。1 つの版だけ作り直したいときは、ローカルで `GEMINI_ACCESS_TOKEN=$(gcloud auth print-access-token --account=hy.unimail.11@gmail.com)` を渡して `node scripts/curate-security.mjs <date>`（収集済みの JSON を使う）→ `validate-citations.mjs <date> --type=security` → PR、が最小の範囲。反映は `care-rebuild.yml -f regenerate=false`
- BSD `sed -i` は日本語を含む置換で `unescaped newline` エラーになることがある。Edit ツールか Python で置換する（`&&` 連結だと後続が実行されずに気付きにくい）
- Playwright のスクリーンショット・保存先は `.playwright-mcp/` かリポジトリ配下に限られる（スクラッチパッドは不可）。ローカルのプレビューは `npx astro preview --port N`、終了時は `npx astro preview stop`
- `codex review` の 1 ブランチ上限 2 回を超える場合は AskUserQuestion で承認を得た後に限り `CODEX_REVIEW_APPROVED=1` を付けて再実行できる（自己判断での付与は不可）

## 残留プロセス

✅ 残留 Node プロセスなし（マシン全体チェック。ローカルのプレビューは `astro preview stop` で停止済み）。

## Issue Net 変化
- Close 数: 1 件 (#82)
- 起票数: 0 件
- Net: 1 件

## 最終結論

✅ **セッション終了可** — 11-01 分を復旧し、週末の収集条件を直した（PR #83・#84、Issue #82 クローズ）。残りは日時の確認待ちのみ。

- OPEN PR: 本ハンドオフ PR のみ / open Issue: 0 件 / Git clean / 即着手 = 0、条件待ち = 15
- §4.6 同根再発スキャン: 本セッション内に同根候補 2 件（仮説と次の経路は上記）/ §4.7 対症療法判定: 該当なし
- 未確認: #84 の週末窓の本番での効果（次の土日 11-07/08）、祝日 11-03 の挙動、11-01 の記事の用語欄（条件待ち 1・4・14）
