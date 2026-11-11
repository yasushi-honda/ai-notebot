# ハンドオフ（最新）

- セッション: 2026-11-11（記事本文の未翻訳中国語「開箱即用」の修正と、再発防止ガードの追加。PR #89・#90 マージ）
- 更新日: 2026-11-11

## セッション概要

### 11-11 記事に未翻訳の中国語「開箱即用」（PR #89、#90）
- **報告**: 11-11 記事の makecindy/cindy の段落に「開箱即用」が訳されずに残っていた（decision-maker の指摘）
- **原因**: 収集データの原題に中国語（`开箱即用`）が含まれ、モデルが日本語の字形（開箱）に直して本文へ写した。既存の `findSimplifiedChinese` は簡体字の字単位の検出で、日本語と同じ字形になるとすり抜ける。同じ語は 10-25 記事にもあった
- **本文の修正（PR #89）**: 11-11・10-25 の本文 2 行を日本語に直した。脚注の出典タイトルは原題のまま（変更なし）。マージ後に `care-rebuild.yml -f regenerate=false` で再デプロイし、公開ページで本文に「開箱即用」が無いことを確認した
- **再発防止（PR #90）**: `style-guard.mjs` に語単位の `findChineseOnlyTerms`（開箱・開源・預設・軟體・硬體・伺服器・程式碼・資料庫・網路安全・使用者介面）を追加し、日次版（`digest-curation.mjs`）と介護版（`curate-care.mjs`）の既存の中国語混入チェックに合流させた。検出時は既存どおり再生成する。セキュリティ版は `digest-curation.mjs` を共有するため同じ経路で効く
- **前回の条件待ち 1 は消化**: 火曜 11-10 の候補は 40 件、11-11 は 35 件で閾値 10 を大きく上回り、月曜に 5 日窓を使い切った後の枯渇は起きていない（`::warning::[collect-security]` の有無は run ログ未確認）

## ドキュメント整合性

| 項目 | 状態 | 備考 |
|------|------|------|
| ADR | ⏭ | 今回は設計判断なし（ガードの追加のみ） |
| CLAUDE.md ↔ 実装 | ✅ | 構成の記述に影響なし |
| 完了ステータス一致 | ✅ | PR #89・#90 マージ済み |

## Git状態

| 項目 | 状態 |
|------|------|
| 未コミット変更 | なし（本ハンドオフ PR を除く） |
| CI/CD | ✅ PR #89・#90 とも `test` pass。care-rebuild.yml（regenerate=false）で再デプロイ済み |

## 品質ゲート

| 項目 | 状態 |
|------|------|
| codex review | PR #90: 1 回（medium、findings 0 件。「日次版・介護版の検証経路に一貫して組み込まれ、回帰なし」、165 テスト pass）。PR #89 は本文 2 行のみのため対象外 |
| テスト | ✅ `node --test scripts/test/*.test.mjs` 430 件 pass（新規 3 件: 検出・複数重複なし・空/日本語は非検出） |
| 実データ確認 | ✅ 既存 150 記事の本文（脚注除く）に適用して誤検出 0 件。公開ページで 11-11・10-25 の本文修正を確認 |

## 同根再発スキャン（§4.6）と対症療法判定（§4.7）

- `fix:` は PR #89（本文修正）。同根候補: 2026-10-20 に日次版、2026-10-06 に介護版で「簡体字の混入」があり `findSimplifiedChinese` が入った（今回はその字単位検出のすり抜け）。**同根候補あり**
  - 仮説: ①モデルは原題の中国語を日本語の字形へ直して写すことがあり、字単位の検出では取れない ②簡体字・日本語字形以外（繁体字そのままの語、英語）の写し込みは別経路で残る ③熟語リストは固定なので、未登録の語は再発しうる
  - 次に出るとしたら: リスト外の中国語の熟語（例: 別の技術用語）が日本語の字形に直されて本文に残る経路
- 対症療法判定: 原因（原題の中国語を写す）を実データで特定し、検出ゲートで再生成させる構造的対策のため**該当なし**。ただし熟語リストは固定で網羅ではない

## 次のアクション（3分割・SKILL.md §2.5）

### 即着手タスク
即着手タスクなし（残りは日時・decision-maker の確認待ち）。

### 条件待ち（明示trigger付き）

| # | 項目 | trigger（充足条件） | 充足時のタスク | 充足確認方法 |
|---|------|------------------|--------------|------------|
| 1 | **新ガード（中国語の熟語検出）の本番動作確認** | 2026-11-12 以降の daily 実行の後 | read-only で run ログに `本文に中国語` の再生成の記録があるか、新しい記事に未翻訳の中国語が残っていないかを確認。誤検出で再生成が空回りしていれば `CHINESE_ONLY_TERMS` を見直す提案（write は指示後） | `gh run view <id> --log \| grep '本文に中国語'`、`grep -rn '開箱' site/src/content` |
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

> 上表の 2〜13 は前回から継続（前回の 1＝11-10 の候補件数は 40 件で確認済みのため、新 1＝新ガードの本番確認に差し替え）。うち 5〜13 は前々回から継続（5＝AI 版 `curate.mjs` の生 HTML 拒否、6＝Stage B のテーマ除外、7＝NVIDIA ブログ、8＝Reddit 429、9＝アラートメール、10＝GA4、11＝福祉用具、12＝`content.config.ts` 影響分析、13＝care-rebuild の FETCH_HEAD）。前回の 1（11-02 以降の用語確認）・14（#84 の効果）・15（11-01 記事の再生成）は完了または陳腐化のため削除（14 は上記のとおり確認済み）。

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
✅ **再開可能** - 次回は条件待ち 1（新ガードの本番動作確認、11-12 以降の daily の後）から始める。

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
- Net: 0 件（Issue 起票の triage 基準を満たす事象ではなく、PR #89・#90 で完結したため）

## 最終結論

✅ **セッション終了可** — 未翻訳の本文を修正して公開ページで確認し、検出ガードを追加した（PR #89・#90 マージ済み）。

- OPEN PR: 本ハンドオフ PR のみ / open Issue: 0 件 / Git clean / 即着手 = 0、条件待ち = 13
- §4.6 同根再発スキャン: 候補 2 件（10-20 日次版・10-06 介護版の簡体字混入）。今回はその検出のすり抜けで、語単位の検出で補強済み
- §4.7 対症療法判定: 該当なし（ただし熟語リストは固定で、未登録の語は再発しうる）
