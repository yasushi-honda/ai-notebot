/**
 * ハルシネーション遮断ゲートの中核ロジック（純関数）。
 * 元は validate-citations.mjs に直接書かれていたが、介護版記事（scripts/curate-care.mjs）にも
 * 同じ検証を適用するため、CLIから独立した純関数として抽出した。
 * validate-citations.mjs は本モジュールを呼ぶ薄いCLIラッパーになっており、
 * 出力文言・終了コードは抽出前と完全に同一（既存テストは subprocess 経由でこれを検証している）。
 */

/**
 * フェンス付きコードブロックを行単位で除去する。CommonMarkはバッククォート（```...```）だけでなく
 * チルダ（~~~...~~~）も正当なフェンス区切りとして認め、フェンスの長さも3以上であれば任意
 * （閉じ側は開始と同じ文字種で、開始以上の長さであればよい）。当初はバッククォート3連続の
 * 固定パターンしか除去しておらず、`~~~` フェンスや4連続以上のバッククォートフェンスの中に
 * 書かれた見た目だけの脚注 `[^s-xxx]` を取りこぼしていた（codex reviewで指摘・修正）。
 * 単一の正規表現でバックリファレンスによる「開始以上の長さ」を表現するのは煩雑なため、
 * 行単位の状態機械として実装する。
 */
function stripFencedCodeBlocks(text) {
  const lines = text.split('\n');
  const kept = [];
  let fenceChar = null;
  let fenceLen = 0;
  for (const line of lines) {
    if (fenceChar === null) {
      const openMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (openMatch) {
        fenceChar = openMatch[1][0];
        fenceLen = openMatch[1].length;
        continue; // 開始フェンス行自体も破棄する
      }
      kept.push(line);
      continue;
    }
    const closePattern = new RegExp(`^ {0,3}[${fenceChar}]{${fenceLen},}[ \t]*$`);
    if (closePattern.test(line)) {
      fenceChar = null;
      fenceLen = 0;
    }
    // フェンス内部の行（開始・終了行を含む）は本文として扱わない
  }
  return kept.join('\n');
}

/**
 * Markdownのコードスパン（`...`）・フェンス付きコードブロック（```...``` / ~~~...~~~）・
 * HTMLコメント（<!-- ... -->）を除去する。remark-gfmはコードスパン内では脚注参照構文 [^id] を
 * 一切解釈せず、`[^s-xxx]` という文字列がそのままリテラル表示される（実際にはどの出典にも
 * リンクしない）。HTMLコメントも同様に、Astroのremark-rehype（allowDangerousHtml: true）配下
 * ではそのまま出力されるがブラウザ上では不可視のため、中に書かれた [^s-xxx] は実際には機能する
 * 脚注参照として表示されない。しかし脚注抽出の正規表現は生のMarkdownテキストに対して機械的に
 * マッチするため、これらで囲まれた「見た目だけの脚注」を本物の引用として誤ってカウントして
 * しまう（codex reviewで指摘・修正）。脚注抽出・検証を行う前に必ず一度だけ呼び出し、以降は
 * この結果をprose/bodyとして扱うこと。
 */
export function stripCodeSpans(text) {
  let result = stripFencedCodeBlocks(text);
  result = result.replace(/<!--[\s\S]*?-->/g, '');
  // インラインコードスパンはCommonMark上、開始と同じ長さのバッククォート連続が、それより長い
  // 連続の一部ではない形で閉じ側に現れるまでが1つの区間になる（例: ``[^s-xxx]`` は2連続
  // バッククォートで囲まれる。``a`b`` のように開始より短い連続を内部に含んでもよい）。
  // 当初は「内部にバッククォートを含む場合は除去しない」という安全側のつもりの判定を入れて
  // いたが、これはまさにCommonMarkが正当なコードスパンとして許す「内部に短い連続を含む」
  // ケースそのものであり、見た目だけの脚注を取りこぼす原因になっていた（codex reviewで
  // 指摘・修正）。前後を `(?<!\`)` / `(?!\`)` で挟み、開始・終了とも「それより長い連続の
  // 一部ではない、独立した同じ長さの連続」であることを要求することで、内部の内容によらず
  // 正しくコードスパンとして除去する。
  result = result.replace(/(?<!`)(`+)[\s\S]*?(?<!`)\1(?!`)/g, '');
  return result;
}

/**
 * @param {object} opts
 * @param {string} opts.markdown 記事ファイル全体（frontmatter込み。opts.bodyOnly指定時は本文断片）
 * @param {Set<string>} opts.validIds 当日アーカイブに実在する出典id集合
 * @param {string|null} [opts.exemptTableHeading] このヘッダのセクション内に限り `|` 始まりの行を脚注検証対象外にする（AIトレンド版のみ）
 * @param {boolean} [opts.bodyOnly] trueの場合、frontmatter区切り(`\n---\n`)の自動検出を行わず
 *   markdown全体をそのまま本文として扱う。LLM生成直後の本文断片（frontmatterを含まない）を
 *   検証する用途向け。指定しない場合、本文中にMarkdownの水平線（`---`）が現れると誤ってそこを
 *   frontmatter区切りと認識し、それより前の文を検証対象から取りこぼす
 *   （codex reviewで指摘・修正: curate.mjs/curate-care.mjsの生成直後チェックで実際に発生しうる
 *   経路だった）。
 * @returns {{
 *   ok: boolean, cited: Set<string>, unresolved: string[], malformed: string[],
 *   sentences: string[], citedSentences: string[], uncited: string[], backingRate: number
 * }}
 */
export function checkCitations({ markdown, validIds, exemptTableHeading = null, bodyOnly = false }) {
  // frontmatter を除いた本文部分から脚注を抽出（frontmatter の sourceIds は自己申告のため対象外）
  const bodyStart = bodyOnly ? -1 : markdown.indexOf('\n---\n', 4);
  const body = bodyStart >= 0 ? markdown.slice(bodyStart + 5) : markdown;

  // 脚注定義行（[^s-xxx]: 出典タイトル ...）を除いた「地の文」だけを引用抽出の対象にする。
  // 定義行の先頭も [^s-xxx] という形をしているため、除外しないと「本文中で一度も
  // 引用されていないが定義だけ存在するid」を誤って「引用済み」と扱ってしまい、
  // どの主張も裏付けていない出典が紛れ込む（codex reviewで指摘・修正）。
  const definitionLinePattern = /^\[\^s-[0-9a-f]+\]:.*$/gm;
  const prose = stripCodeSpans(body.replace(definitionLinePattern, ''));

  const footnotePattern = /\[\^(s-[0-9a-f]+)\]/g;
  const cited = new Set();
  for (const m of prose.matchAll(footnotePattern)) cited.add(m[1]);

  // 不正な脚注表記を検出する（例: [^s-aaa, s-bbb] のようにカンマ区切りで複数idを
  // 1つの角括弧に詰め込んだもの。LLMがまれにこの形式で出力し、GFM footnote構文として
  // 認識されず角括弧がそのまま画面に表示されてしまうため、正しい形式のみ許容する）。
  const bracketPattern = /\[\^[^\]]*\]/g;
  const malformed = [...prose.matchAll(bracketPattern)]
    .map((m) => m[0])
    .filter((s) => !/^\[\^s-[0-9a-f]+\]$/.test(s));

  const unresolved = [...cited].filter((id) => !validIds.has(id));

  const hasFootnote = /\[\^s-[0-9a-f]+\]/;

  // テーブル行（|始まり）の脚注免除は exemptTableHeading で指定されたセクションだけに限定する。
  // 介護版（curate-care.mjs）は exemptTableHeading を渡さず、免除なしで全文100%を要求する。
  let exemptRange = null;
  if (exemptTableHeading) {
    const headingMatch = prose.match(new RegExp(`^## ${exemptTableHeading}$`, 'm'));
    if (headingMatch) {
      const start = headingMatch.index;
      const nextHeadingMatch = prose.slice(start + headingMatch[0].length).match(/^## .+$/m);
      const end = nextHeadingMatch ? start + headingMatch[0].length + nextHeadingMatch.index : prose.length;
      exemptRange = { start, end };
    }
  }

  // paragraphs を prose 中の実位置（インデックス）付きで求める。同一文言の段落が
  // 複数箇所にあっても取り違えないよう、検索開始位置を左から右へ単調に進める。
  let searchFrom = 0;
  const paragraphs = prose
    .split(/\n{2,}/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    // 見出し行（# ...）は「新たな主張」ではなく構造要素のため対象外にする。ただし見出しの
    // 直後に空行を挟まず本文が続く段落（LLMが空行を入れ忘れた場合に発生する）は、見出し「行」
    // だけを取り除き、残りの本文は通常どおり検証対象にする。段落全体を`#`始まりというだけで
    // 丸ごと除外すると、見出しに続く本文（実際の主張）ごと検証をすり抜けてしまう
    // （介護版記事の実データで発覚した実害。単なる理論上の懸念ではない）。
    .map((rawText) => {
      const headingLineMatch = rawText.match(/^#{1,6}\s.*(?:\n|$)/);
      const text = headingLineMatch ? rawText.slice(headingLineMatch[0].length).trim() : rawText;
      return text;
    })
    // 脚注定義行(未使用な保険。定義行自体は既に prose から除去済みだが、万一残っても除外する)
    .filter((text) => text && !text.startsWith('[^'))
    .map((text) => {
      const index = prose.indexOf(text, searchFrom);
      if (index >= 0) searchFrom = index + text.length;
      return { text, index };
    })
    .filter((p) => !(p.text.startsWith('|') && exemptRange && p.index >= exemptRange.start && p.index < exemptRange.end))
    .map((p) => p.text);

  const sentences = paragraphs
    .flatMap((p) => p.split(/(?<=[。！？])|(?<=[.!?])(?=\s|$)/))
    .map((s) => s.trim())
    // Markdown番号付きリストの行頭マーカー（例: "1. 手順です。" の "1." 部分）は、
    // ". " の直後で区切る英文ピリオド用の分割ルールに巻き込まれて独立した断片になってしまう。
    // 実際の主張を含まない書式上の破片であり、これを「無出典の文」として扱うのは意図と異なるため
    // 除外する（介護版の「## 手順」番号付きリストで発覚。curate-care.mjs参照）。
    .filter((s) => !/^\d+\.$/.test(s))
    .filter(Boolean);
  const citedSentences = sentences.filter((s) => hasFootnote.test(s));
  const uncited = sentences.filter((s) => !hasFootnote.test(s));
  const backingRate = sentences.length > 0 ? Math.round((citedSentences.length / sentences.length) * 100) : 0;

  const ok = malformed.length === 0 && unresolved.length === 0 && cited.size > 0 && citedSentences.length === sentences.length;

  return { ok, cited, unresolved, malformed, sentences, citedSentences, uncited, backingRate };
}
