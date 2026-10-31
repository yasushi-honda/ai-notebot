# ハンドオフ（最新）

- セッション: 2026-10-31（セキュリティ用語集が増えない問題の修正、用語集ページの検索・五十音ナビ追加。PR #77・#78・#79 マージ、本番反映済み）
- 更新日: 2026-10-31

## セッション概要

### 用語集が増えない問題の修正（PR #77・#78）
decision-maker の報告:「セキュリティ用語集（1語）・今日の用語が最初の日から全く増えない」。実データで確認すると、10/29〜31 の全記事が「脆弱性」1語だけだった。
- **原因（2つ）**: ①収集元の約半数（10/31 は 38 件中 17 件）が英語記事で、LLM が書く日本語の用語が出典の title/summary に載らず、`validateTerms` の「出典に実在する語」検証で毎回落ちた ②プロンプトが「出典の中で意味が説明されている語だけ」と狭かった。CI ログでも「用語が引用した出典の本文に見当たりません」が毎回出ていた
- **修正**: `scripts/lib/security-glossary.mjs` に一般用語（約45語）・固定の定義文・別表記の辞書を持ち、記事本文に出てきた語だけを、その文の脚注つきで機械的に拾う（LLM に定義を書かせない）。LLM 由来の検証済み用語は補助として残す。上限は日次の重複排除の後に「1テーマ新規3語・1日8語」を数える。詳細: ADR §9
- **品質ゲート**: codex review 2 回（1 回目 P2×2＝非同義の別表記・結合時の重複排除、2 回目 P2×4＝脚注を行でなく文単位に、任意コード実行/脱獄/二段階認証の別表記）＋ pr-review-toolkit（code-reviewer＝読みの誤字・テーマ枠の食い合い・脚注の無制限・非同義の別表記、pr-test-analyzer＝結合・上限・表記ゆれ・定数の未テスト）。すべて反映
- **PR #78**: 10/31 の記事だけを再生成（収集済みの `data/raw-security` は変更せず `curate-security.mjs` のみ再実行）。用語 1語→7語、出典検証は裏取り率 100%（32/32 文）。10/29・10/30 は再生成していない（decision-maker 確認済み）

### 用語集ページの検索・五十音ナビ（PR #79）
decision-maker の依頼:「今後どんどん増えるので、頭文字で抽出される設計や検索窓など、最適解のコントローラーを付け足して」。
- 検索窓（用語・読み・説明。カナ/全半角/大文字小文字を吸収、空白区切りは AND、`?q=`、`/` と Esc、件数表示）＋語数つき五十音チップ（クリックでジャンプ、絞り込みに連動、スクロールで上部固定）。JS 無効でも全件が読める。正規化は `site/src/lib/glossary.mjs` の純関数
- 実ブラウザ（Playwright、ローカルのビルド）で絞り込み・行チップの連動・Esc・ジャンプ・`?q=` を確認。codex review 1 回（指摘 0 件）

### 本番反映と確認
`gh workflow run care-rebuild.yml -f regenerate=false`（再収集なし）で PR #77〜#79 を反映。本番で `/security/glossary/` に検索窓 1・行チップ 11・用語項目 9 を curl で確認（用語数が 7 から 9 に増えたのは同日の自動生成によるものと推測。根拠は未確認）。本番での検索操作の確認は未実施。

### 訂正（セッションの学び）
辞書のコメントと PR #77 の説明に「人が確認した定義」と書いたが、定義文は AI が起草したもので人は確認していない。コメントと ADR を「AI が起草、人による事実確認は未了」に訂正した（本ハンドオフ PR）。PR #77 の説明文は未修正。

## ドキュメント整合性

| 項目 | 状態 | 備考 |
|------|------|------|
| AGENTS.md（CLAUDE.md の実体） ↔ 実装 | ✅ | 用語は固定辞書で拾うことを反映 |
| ADR | ✅ | `adr-2026-10-29-security-digest.md` に §9（固定辞書・検索・行ナビ）を追記、「既知の限界」の用語の記述を更新 |
| 完了ステータス一致 | ✅ | PR #77・#78・#79 マージ済み、本番反映済み |

## Git状態

| 項目 | 状態 |
|------|------|
| 未コミット変更 | なし（本ハンドオフ PR を除く） |
| 未プッシュコミット | なし（`main` = `origin/main` = `a9fb1ba`、本ハンドオフ PR を除く） |
| CI/CD | ✅ PR #77・#78・#79 とも test・GitGuardian・CodeRabbit が PASS。本番反映の care-rebuild（run 41175743761、41176651096）も success |

## 品質ゲート

| 項目 | 状態 |
|------|------|
| codex review | PR #77: 2 回（medium＝P2×2、high＝P2×4、すべて反映）。PR #79: 1 回（medium、指摘 0 件）。PR #78 は生成記事のみのため対象外 |
| 専門レビュー（pr-review-toolkit、sonnet、read-only） | PR #77: code-reviewer（Important 5）、pr-test-analyzer（結合・上限・表記ゆれの未テスト）。すべて反映（否定表現への反応と `APT28` の取りこぼしは用途上許容として見送り） |
| テスト | ✅ 421 件全 PASS（開始時 400 件＋辞書 11・上限/重複排除 3・検索/行ナビ 5 など）、ビルド 358 ページ |
| 実機動作確認 | ✅ Playwright でローカルのビルドを操作（検索・行チップ・Esc・ジャンプ・?q=）。本番は curl で要素の存在のみ確認 |

## 同根再発スキャン（§4.6）と対症療法判定（§4.7）

- `fix:` は PR #77 の 1 件。**同根候補 0 件**（用語に関する過去の修正 PR はなし。過去の handoff にも「用語が少ない」の記載のみで、同一症状の修正は初）
- 対症療法判定: 基準 1（retry/fallback のみ）には該当せず。原因は CI ログと実データで特定し（英語記事と検証の不整合）、検証を緩めるのではなく固定辞書に置き換えた。基準 3（過去 30 日の同症状の修正）も該当なし。**該当なし**

## 次のアクション（3分割・SKILL.md §2.5）

### 即着手タスク
即着手タスクなし（残りは日時・decision-maker の確認待ち）。

### 条件待ち（明示trigger付き）

| # | 項目 | trigger（充足条件） | 充足時のタスク | 充足確認方法 |
|---|------|------------------|--------------|------------|
| 1 | **11/01 以降の自動生成で用語が増えているかの確認** | 2026-11-01（日）07:00 JST の daily 実行の後 | read-only で、`/security/2026-11-01/` の「今日の用語」が複数語か、`/security/glossary/` の語数が増えているか、`::warning::[curate-security]` の有無を確認する。あわせて本番で検索窓・行ナビが動くか（本番での操作は未確認）を見る | `curl -s https://yasushi-honda.github.io/ai-notebot/security/glossary/ \| grep -o 'data-entry' \| wc -l`、`gh run view <id> --log \| grep -E "用語\|::warning::"`（リポジトリ内で実行） |
| 2 | **対策の空率の測定と、公式補助取得の要否判断**（旧 2 を更新。用語は §9 で解消済み） | セキュリティ版の記事が 5 日分以上そろう（目安 2026-11-03 以降） | read-only で、記事ごとの対策件数・`::warning::` の頻度・要約補強の成功率・除外テーマ数を集計し、別モデル（Sonnet）で出典忠実性を再監査する（再生成後の記事と固定辞書の定義は未監査）。対策の空率が高ければ「公式の対策節を補助資料として別途収集する工程」を plan mode で設計する提案を AskUserQuestion で行う | `site/src/content/security/*.md` の `### すぐできる対策` を集計。監査の入力形式は前回（`{n,date,sentence,sources[{title,summary,source}]}`）と同じ |
| 3 | **用語辞書の定義文の事実確認** | decision-maker が辞書（約45語）の定義を確認する、または確認を依頼する | 定義は AI が起草し人の確認は未了。誤りや言い過ぎがあれば `security-glossary.mjs` を修正（write なので指示後）。確認の補助として、辞書を一覧にした確認用資料の生成は依頼があれば実施 | `scripts/lib/security-glossary.mjs` の `SECURITY_TERMS` |
| 4 | セキュリティ版のしきい値の見直し | 土日を含む 7 日分の収集結果がそろう | `minSuccessSources: 5`・`minTotalItems: 20`・時間予算 8 分（`build-security.mjs`）が実測に合うかを見る。休日に収集失敗が続くなら緩める提案をする | `data/raw-security/*.json` の件数、daily のログの収集件数・所要時間 |
| 5 | AI 版 `curate.mjs` の本文に生 HTML・リンクの拒否を入れる | decision-maker からの修正指示 | セキュリティ版の `findUnsafeMarkup` を AI 版の Stage B の `evaluate` にも適用する（介護版には既にある）。本文は外部フィードに影響されるため同じ経路で露出している。修正（write）なので起点は decision-maker | `grep -n findUnsafeMarkup scripts/curate.mjs`（現状ヒットなし） |
| 6 | Stage B のテーマ除外の実環境確認（前回から継続） | daily の run ログに「除外したテーマ」が頻発した時 | 10/24 の run で 1 件（脚注欠落 3 試行連続 NG）を確認済み。頻発するなら脚注指示の見直し | `gh run view <id> --log \| grep '除外したテーマ'`（リポジトリ内で実行） |
| 7 | NVIDIA Developer Blog の追加（前回から継続） | `developer.nvidia.com` の名前解決が安定して通ること | `fetchFeed` 経由で取得・直近 3 日の新着を確認し、問題なければ `feeds.mjs` に 1 行追加 | `node -e` で `fetchFeed` を呼ぶ（`scripts/lib/rss.mjs`） |
| 8 | Reddit 429 の再発（前回から継続） | 収集失敗が収集成功しきい値に影響した時 | 10/24・10/25 の run でも `Reddit r/MachineLearning`・`r/artificial` が HTTP 429（他ソースは生きており記事は生成された）。`collect.mjs` の Reddit 取得のリトライ・バックオフを read-only で調査 | `gh run list --workflow=daily.yml` の失敗 run のログ |
| 9 | アラートメールの受信確認（前回から継続） | decision-maker が `hy.unimail.11@gmail.com` の受信箱を確認（AI 代行不可） | 届いていなければ通知チャネルを調査 | decision-maker 本人が確認 |
| 10 | GA4 データ反映の再確認（前回から継続） | decision-maker 本人の Google ログインでの確認（AI 代行不可） | analytics.google.com で DebugView / リアルタイムレポートを確認 | decision-maker 本人が確認 |
| 11 | 「福祉用具」targetServices が生成記事で選ばれるか（前回から継続） | 次回以降の daily.yml / care-rebuild.yml の自然な実行（確率的） | `site/src/content/care/` の新規記事に出現するか確認。長期間出現しなければ `collect-care.mjs` のテーマ指示を見直す | `grep -l '福祉用具' site/src/content/care/*.md` |
| 12 | `content.config.ts` の themes フィールド影響分析（前回から継続） | decision-maker からの実行指示 | `/impact-analysis` 実行（read-only） | 明示指示の有無 |
| 13 | care-rebuild.yml の FETCH_HEAD 方式への統一（前回から継続） | 次に care-rebuild.yml の YAML 自体を編集する用事、または明示指示 | Sync ステップを `git fetch origin main && git reset --hard FETCH_HEAD` に統一 | `grep -n "git reset" .github/workflows/care-rebuild.yml` |

> 上表の 4 以降は前回の 3〜12 を番号を 1 つずらして継続（4＝セキュリティ版のしきい値、5＝AI 版 `curate.mjs` の生 HTML 拒否、6＝Stage B のテーマ除外、7＝NVIDIA ブログ、8＝Reddit 429、9＝アラートメール、10＝GA4、11＝福祉用具、12＝`content.config.ts` 影響分析、13＝care-rebuild の FETCH_HEAD）。

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
✅ **再開可能** - ドキュメントから開発再開できます。次回は条件待ち 1（11/01 以降の自動生成で用語が増えているかの確認）から始める。

## 申し送り

- `gh pr merge` は単独コマンドでないと `pr-merge-gate` が拒否する（パイプ `| tail` も不可）。マージ前に最新コミットの CI（`gh pr checks`）を確認する
- 手動の `daily.yml`（入力なし）は AI 版・介護版・セキュリティ版をすべて作り直す。1 つの版だけ作り直したいときは、ローカルで `GEMINI_ACCESS_TOKEN=$(gcloud auth print-access-token --account=hy.unimail.11@gmail.com)` を渡して `node scripts/curate-security.mjs <date>`（収集済みの JSON を使う）→ `validate-citations.mjs <date> --type=security` → PR、が最小の範囲。反映は `care-rebuild.yml -f regenerate=false`
- BSD `sed -i` は日本語を含む置換で `unescaped newline` エラーになることがある。Edit ツールか Python で置換する（`&&` 連結だと後続が実行されずに気付きにくい）
- Playwright のスクリーンショット・保存先は `.playwright-mcp/` かリポジトリ配下に限られる（スクラッチパッドは不可）。ローカルのプレビューは `npx astro preview --port N`、終了時は `npx astro preview stop`
- `codex review` の 1 ブランチ上限 2 回を超える場合は AskUserQuestion で承認を得た後に限り `CODEX_REVIEW_APPROVED=1` を付けて再実行できる（自己判断での付与は不可）

## 残留プロセス

✅ 残留 Node プロセスなし（マシン全体チェック。ローカルのプレビューは `astro preview stop` で停止済み）。

## Issue Net 変化
- Close 数: 0 件
- 起票数: 0 件
- Net: 0 件（open Issue なし）

## 最終結論

✅ **セッション終了可** — 用語が増えない問題を修正し（PR #77・#78）、用語集に検索と五十音ナビを追加して（PR #79）本番に反映した。残りは日時・decision-maker の確認待ちのみ。

- OPEN PR: 本ハンドオフ PR のみ / open Issue: 0 件 / Git clean / 即着手 = 0、条件待ち = 13
- §4.6 同根再発スキャン: 候補 0 件 / §4.7 対症療法判定: 該当なし
- 未確認: 本番での検索窓の操作、辞書の定義文の事実確認（条件待ち 1・3）
