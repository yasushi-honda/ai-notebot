# ハンドオフ（最新）

- セッション: 2026-11-14（介護版の NotebookLM を改称後の Gemini Notebook に更新。PR #95 マージ、11-14 を再生成）
- 更新日: 2026-11-14

## セッション概要

### 介護版の NotebookLM → Gemini Notebook 改称対応（PR #95、2026-11-14）
- **報告**: decision-maker が `/care/2026-11-14/` の表記が旧名 NotebookLM だと指摘。前日の PR #93 で旧名のまま追加していたのが原因
- **事実確認**: NotebookLM は 2026-07-16 に「Gemini Notebook」へ改称（Google Workspace Updates ブログの記事 URL `notebooklm-now-gemini-notebook` と複数報道。公式ブログ本文は curl で取得できず、検索結果の要約で確認）。表示への反映は順次
- **変更**: `collect-care.mjs`・`curate-care.mjs` のプロンプトを「Gemini Notebook（旧NotebookLM）」に更新し、執筆ルールに「本文は新名で書く・出典が旧名のときだけ初出に（旧NotebookLM）」を追加。`GENERIC_TOOL_FAMILIES` は `'Gemini Notebook': ['Gemini Notebook','NotebookLM']` に統合し、「Gemini Notebook」の「Gemini」だけで Gemini 系統を満たさないよう除去して判定。回帰テスト 1 件追加
- **11-14 の再生成**: `care-rebuild.yml -f date=2026-11-14 -f regenerate=true`（run 43558370690）が success。再収集でテーマが変わり（新人研修の教材準備 → GeminiとClaudeの業務効率化）、記事に NotebookLM／Gemini Notebook はどちらも出ない。元の記事は残っていない
- **未確認**: 新名「Gemini Notebook」が実際の記事に出る場面（出る日に確認）
- **マージ手順の注意**: 最初のマージ試行は CI 未完了（mergeStateStatus=UNSTABLE）でゲートが拒否。`gh pr checks` で完了を待ち CLEAN になってから通った

### 介護版 11-13 の欠落と復旧（#92）
- **報告**: decision-maker が `/care/` に 11-13 分が無いことを指摘
- **原因**: 07:00 JST の収集で official（公的機関ドメイン）が 0 件。追加検索 2 回でも見つからず検証に落ち、`build-care.mjs` が設計どおり exit 0 で終わった（AI版・セキュリティ版は公開済み）。到達性検証済みの非公式ソースは 12 件あった
- **復旧**: `care-rebuild.yml -f date=2026-11-13 -f regenerate=true`（run 43335251643）が success。`care/2026-11-13.md` が main に入り、公開ページは HTTP 200。#92 はクローズ済み
- **頻度の集計（read-only）**: 介護版の生成失敗 Issue は #50（9-28）・#56（9-29）・#92（11-13）の 3 件。生成済みは 65 日分で、記事ごとの official 件数は 1 件が 26 日・2 件が 23 日・3 件以上が 16 日。1 件だけで通る日が約 4 割ある
- **対策の判断**: decision-maker は「何もしない・明朝以降の結果を見る」を選択（追加検索の上限を 3 回にする案と許可リストを広げる案は未採用）

### 介護版のAIツール拡張（PR #93）
- **要望**: decision-maker から「NotebookLM をもっと使う、ほかのAIツールも入れていってよい」
- **変更**: `collect-care.mjs` の調査プロンプトと `curate-care.mjs` の執筆プロンプトに NotebookLM・Copilot・Perplexity を追加。本文ゲートの系統判定（`GENERIC_TOOL_FAMILIES`）にも NotebookLM・Copilot・Perplexity を独立した系統として追加し、回帰テスト 1 件を足した
- **反映**: コードの変更なので、本番には次回の介護版の収集（毎朝 07:00 JST）から効く。即時反映は `care-rebuild.yml -f regenerate=false`（未実施）
- 補足: NotebookLM や Gemini の公式ヘルプは `support.google.com`（許可リストにある）なので、これらのテーマなら official を取りやすいはず（未検証）

## ドキュメント整合性

| 項目 | 状態 | 備考 |
|------|------|------|
| ADR | ⏭ | 今回は設計判断なし（プロンプトとゲートの語の追加のみ） |
| CLAUDE.md ↔ 実装 | ✅ | 構成の記述に影響なし |
| 完了ステータス一致 | ✅ | PR #93 マージ済み。#92 クローズ済み |

## Git状態

| 項目 | 状態 |
|------|------|
| 未コミット変更 | なし（本ハンドオフ PR を除く） |
| CI/CD | ✅ care-rebuild（11-13 復旧）success。PR #93 の CI（`test`）も success |

## 品質ゲート

| 項目 | 状態 |
|------|------|
| codex review | PR #95: 1 回（medium、findings 0 件。「Gemini Notebook を Notebook と Gemini の両方に数えない判定は正しい」、curate-care 126 件 pass）。PR #93: 1 回（medium、findings 0 件。「プロンプトとツール判定の拡張に一貫性があり、実害のある回帰なし」、curate-care 125 件 pass） |
| テスト | ✅ `node --test $(find scripts -name '*.test.mjs')` 430 件 pass（マージ前）。追加後の `curate-care.test.mjs` は 125 件 pass |
| 実データ確認 | ✅ 11-14 の再生成後、公開ページに旧名の表記なし（出典リンクを除く）。新名が実際の記事に出るかは未確認（出る日に確認） |

## 同根再発スキャン（§4.6）と対症療法判定（§4.7）

- 修正 PR（`fix:`）は無いが、復旧対象の「official 0 件で収集が落ちる」は **同根候補 3 件**（#50 9-28、#56 9-29、#92 11-13）
  - 仮説: ①Google 検索グラウンディングが go.jp/lg.jp を返さない回がある（実行ごとに結果が変わる） ②公的機関に絞る追加検索のプロンプトが効いていない ③official の判定が `.go.jp`/`.lg.jp`/`.gov` と許可リストに限られ、ベンダー公式ドメインが web 扱いになる
  - 次に出るとしたら: 1 件だけで通っていた日（約 4 割）が 0 件側に振れる経路
- 対症療法判定: 修正 PR が無く発動条件外。復旧は再実行のみで、official が取れない原因そのものは未調査（頻度が約 2 か月で 3 回と低く、再実行で復旧するため様子見を選択）

## 次のアクション（3分割・SKILL.md §2.5）

### 即着手タスク
即着手タスクなし（残りは日時・decision-maker の確認待ち）。

### 条件待ち（明示trigger付き）

| # | 項目 | trigger（充足条件） | 充足時のタスク | 充足確認方法 |
|---|------|------------------|--------------|------------|
| 1 | **介護版の明朝以降の確認（NotebookLM 拡張の効果と official 件数）** | 2026-11-14 以降の daily の後（数日分そろうと判断しやすい） | read-only で新しい介護版の記事に Gemini Notebook 等が出たか（旧名が残っていないか）、`data/raw-care/` の official 件数が 1 件のままか、`generate` が失敗していないかを確認。1 件が続く・失敗が再発するなら、追加検索の上限を 3 回にする案か許可リストの拡張を decision-maker に提示 | `grep -l 'Gemini Notebook' site/src/content/care/*.md`（旧名 `NotebookLM` が本文に残っていないかも確認）、`grep -c '"tier": *"official"' data/raw-care/<date>.json` |
| 2 | **新ガード（中国語の熟語検出）の本番動作確認**（前回の 1 を継続） | 2026-11-12 以降の daily の後（11-12・11-13 は実行済み） | read-only で run ログに `本文に中国語` の再生成の記録があるか、新しい記事に未翻訳の中国語が残っていないかを確認。誤検出で再生成が空回りしていれば `CHINESE_ONLY_TERMS` を見直す提案（write は指示後） | `gh run view <id> --log \| grep '本文に中国語'`、`grep -rn '開箱' site/src/content` |
| 3 | **対策の空率の測定と、公式補助取得の要否判断** | セキュリティ版の記事が 5 日分以上そろっている（満たした）。決裁者の指示または次の点検機会 | read-only で記事ごとの対策件数・`::warning::`・要約補強の成功率・除外テーマ数を集計し、別モデルで出典忠実性を再監査。空率が高ければ plan mode で設計提案 | `site/src/content/security/*.md` の `### すぐできる対策` を集計 |
| 4 | **用語辞書の定義文の人による確認** | decision-maker が辞書（46語）を確認、または確認を依頼 | 誤りがあれば `security-glossary.mjs` を修正（write は指示後） | `scripts/lib/security-glossary.mjs` の `SECURITY_TERMS` |
| 5 | **次の祝日（11-23 勤労感謝の日・月）の収集確認** | 2026-11-23 の daily 実行の後 | 月曜は 5 日窓になったので枯渇は緩和されるはずだが、公的機関の項目数と件数を read-only で確認 | `data/raw-security/2026-11-23.json` をソース別に集計 |
| 6 | AI 版 `curate.mjs` の本文に生 HTML・リンクの拒否を入れる | decision-maker からの修正指示 | セキュリティ版の `findUnsafeMarkup` を AI 版の Stage B の `evaluate` にも適用する（介護版には既にある）。本文は外部フィードに影響されるため同じ経路で露出している。修正（write）なので起点は decision-maker | `grep -n findUnsafeMarkup scripts/curate.mjs`（現状ヒットなし） |
| 7 | Stage B のテーマ除外の実環境確認（前回から継続） | daily の run ログに「除外したテーマ」が頻発した時 | 10/24 の run で 1 件（脚注欠落 3 試行連続 NG）を確認済み。頻発するなら脚注指示の見直し | `gh run view <id> --log \| grep '除外したテーマ'`（リポジトリ内で実行） |
| 8 | NVIDIA Developer Blog の追加（前回から継続） | `developer.nvidia.com` の名前解決が安定して通ること | `fetchFeed` 経由で取得・直近 3 日の新着を確認し、問題なければ `feeds.mjs` に 1 行追加 | `node -e` で `fetchFeed` を呼ぶ（`scripts/lib/rss.mjs`） |
| 9 | Reddit 429 の再発（前回から継続） | 収集失敗が収集成功しきい値に影響した時 | 10/24・10/25 の run でも `Reddit r/MachineLearning`・`r/artificial` が HTTP 429（他ソースは生きており記事は生成された）。`collect.mjs` の Reddit 取得のリトライ・バックオフを read-only で調査 | `gh run list --workflow=daily.yml` の失敗 run のログ |
| 10 | アラートメールの受信確認（前回から継続） | decision-maker が `hy.unimail.11@gmail.com` の受信箱を確認（AI 代行不可） | 届いていなければ通知チャネルを調査 | decision-maker 本人が確認 |
| 11 | GA4 データ反映の再確認（前回から継続） | decision-maker 本人の Google ログインでの確認（AI 代行不可） | analytics.google.com で DebugView / リアルタイムレポートを確認 | decision-maker 本人が確認 |
| 12 | 「福祉用具」targetServices が生成記事で選ばれるか（前回から継続） | 次回以降の daily.yml / care-rebuild.yml の自然な実行（確率的） | `site/src/content/care/` の新規記事に出現するか確認。長期間出現しなければ `collect-care.mjs` のテーマ指示を見直す | `grep -l '福祉用具' site/src/content/care/*.md` |
| 13 | `content.config.ts` の themes フィールド影響分析（前回から継続） | decision-maker からの実行指示 | `/impact-analysis` 実行（read-only） | 明示指示の有無 |
| 14 | care-rebuild.yml の FETCH_HEAD 方式への統一（前回から継続） | 次に care-rebuild.yml の YAML 自体を編集する用事、または明示指示 | Sync ステップを `git fetch origin main && git reset --hard FETCH_HEAD` に統一 | `grep -n "git reset" .github/workflows/care-rebuild.yml` |

> 上表の 3〜14 は前回までの 2〜13 を番号だけ繰り下げた継続項目（内容は変更なし）。新 1 は今回追加、新 2 は前回の 1 の継続。

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
| 14 | `CHINESE_ONLY_TERMS` を過去記事の原題から広げる（候補抽出＋誤検出チェック） | 再発防止の次の一手として選択肢に提示した（AI 発想）。decision-maker は選ばなかった | 起点は decision-maker 領分。実害が出ていない語を先回りで足すと誤検出で再生成が空回りするリスクがある | リスト外の中国語の熟語が実際に本文へ残った時、または decision-maker の指示 |


### 再開可能性判定
✅ **再開可能** - 次回は条件待ち 1（介護版の Gemini Notebook 拡張と official 件数の確認、11-14 以降の daily の後）から始める。

## 申し送り

- `gh pr merge` は単独コマンドでないと `pr-merge-gate` が拒否する（パイプ `| tail` も不可）。マージ前に最新コミットの CI（`gh pr checks`）を確認する
- 手動の `daily.yml`（入力なし）は AI 版・介護版・セキュリティ版をすべて作り直す。1 つの版だけ作り直したいときは、ローカルで `GEMINI_ACCESS_TOKEN=$(gcloud auth print-access-token --account=hy.unimail.11@gmail.com)` を渡して `node scripts/curate-security.mjs <date>`（収集済みの JSON を使う）→ `validate-citations.mjs <date> --type=security` → PR、が最小の範囲。反映は `care-rebuild.yml -f regenerate=false`
- BSD `sed -i` は日本語を含む置換で `unescaped newline` エラーになることがある。Edit ツールか Python で置換する（`&&` 連結だと後続が実行されずに気付きにくい）
- Playwright のスクリーンショット・保存先は `.playwright-mcp/` かリポジトリ配下に限られる（スクラッチパッドは不可）。ローカルのプレビューは `npx astro preview --port N`、終了時は `npx astro preview stop`
- `codex review` の 1 ブランチ上限 2 回を超える場合は AskUserQuestion で承認を得た後に限り `CODEX_REVIEW_APPROVED=1` を付けて再実行できる（自己判断での付与は不可）
- 公的機関のフィードは JPCERT/CC と JVN が同じ URL（`jvn.jp/vu/...`）を共有するため、片方で使用済みになると他方も既出扱いになる

- 中国語混入の検出は 2 層: 字単位 `findSimplifiedChinese`（簡体字）と語単位 `findChineseOnlyTerms`（日本語の字形に直された中国語の熟語）。脚注の出典タイトルは原題のまま載せるため検出対象外（呼び出し側が本文だけを渡す）
- 公開サイトへ本文の変更だけを反映するときは `gh workflow run care-rebuild.yml -f regenerate=false`（`main` への push だけでは自動デプロイされない）

## 残留プロセス

✅ 残留 Node プロセスなし（マシン全体チェック）。

## Issue Net 変化
- Close 数: 0 件
- 起票数: 0 件
- Net: 0 件（Issue 起票の triage 基準を満たす事象なし。PR #95 は decision-maker の指摘による修正で Issue なし）

## 最終結論

✅ **セッション終了可** — 介護版の旧名 NotebookLM を Gemini Notebook に更新（PR #95）し、11-14 を再生成して公開を確認した。

- OPEN PR: 本ハンドオフ PR のみ（PR #95 はマージ済み） / open Issue: 0 件 / Git clean / 即着手 = 0、条件待ち = 14
- §4.6 同根再発スキャン: 候補 3 件（#50・#56・#92 の official 0 件）。原因の根治は未実施で、様子見を decision-maker が選択
- §4.7 対症療法判定: 発動条件外（修正 PR なし）。復旧は再実行のみで、official が取れない原因は未調査
