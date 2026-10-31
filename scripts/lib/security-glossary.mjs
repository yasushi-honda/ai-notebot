/**
 * セキュリティ版「今日の用語」の固定辞書。
 * 収集元の約半数は英語記事で、LLM が日本語で書いた用語は出典の title / summary に載らないため、
 * 「出典に実在する語だけ」の検証では用語がほぼ毎回落ちる。そこで、人が確認した一般用語と定義を
 * ここに持ち、記事本文に出てきた語だけを機械的に拾う（定義は LLM に書かせない）。
 * 定義は句点・記号を含めない1文（用語行の組み立て時に出典の脚注と句点を付ける）。
 */

// aliases は本文照合用の別表記（大文字小文字・全半角は無視）。term 自体も照合に使う
export const SECURITY_TERMS = [
  { term: '脆弱性', reading: 'ぜいじゃくせい', definition: 'プログラムの不具合や設計上のミスで生じる、攻撃に悪用されうる弱点のこと', aliases: [] },
  { term: 'ゼロデイ', reading: 'ぜろでい', definition: '修正プログラムが出る前から攻撃に悪用されている脆弱性、またはその攻撃のこと', aliases: ['ゼロデイ攻撃', 'zero-day', '0-day'] },
  { term: 'ランサムウェア', reading: 'らんさむうぇあ', definition: 'データを暗号化して使えなくし、元に戻す見返りに金銭を要求する不正なプログラムのこと', aliases: ['ransomware'] },
  { term: 'マルウェア', reading: 'まるうぇあ', definition: '利用者の機器に被害を与える目的で作られた不正なプログラムの総称', aliases: ['malware'] },
  { term: 'フィッシング', reading: 'ふぃっしんぐ', definition: '実在の企業や組織を装った偽のメールやサイトで、パスワードや個人情報をだまし取る手口のこと', aliases: ['phishing'] },
  { term: 'バックドア', reading: 'ばっくどあ', definition: '正規の認証を通らずに機器やシステムへ侵入できるよう、こっそり仕込まれた裏口のこと', aliases: ['backdoor'] },
  { term: 'サプライチェーン攻撃', reading: 'さぷらいちぇーんこうげき', definition: '標的そのものではなく、取引先や利用しているソフトウェアの提供元を経由して侵入する攻撃のこと', aliases: ['supply chain attack', 'supply-chain attack'] },
  { term: '二要素認証', reading: 'にようそにんしょう', definition: 'パスワードに加えて、確認コードや生体情報など別の要素を組み合わせて本人確認する仕組みのこと', aliases: ['2要素認証', '多要素認証', '2fa', 'mfa', 'two-factor', 'multi-factor'] },
  { term: '二段階認証', reading: 'にだんかいにんしょう', definition: 'パスワードに続けて確認コードを入力するなど、2回に分けて本人確認する仕組みのこと', aliases: ['2段階認証', '二段階確認', 'two-step verification'] },
  { term: 'パスキー', reading: 'ぱすきー', definition: 'パスワードの代わりに、端末の生体認証などで安全にログインできる仕組みのこと', aliases: ['passkey'] },
  { term: '情報漏えい', reading: 'じょうほうろうえい', definition: '個人情報や機密情報が、意図せず外部に流出してしまうこと', aliases: ['情報漏洩', '個人情報漏えい', '個人情報漏洩', 'data breach', 'data leak'] },
  { term: '不正アクセス', reading: 'ふせいあくせす', definition: '他人のIDやパスワードを使ったり、システムの弱点を突いたりして、権限なく侵入すること', aliases: ['unauthorized access'] },
  { term: 'DDoS攻撃', reading: 'でぃーでぃーおーえすこうげき', definition: '大量の通信を一斉に送りつけて、サービスを使えなくする攻撃のこと', aliases: ['ddos'] },
  { term: 'ボットネット', reading: 'ぼっとねっと', definition: 'マルウェアに感染して遠隔操作される機器の集まりで、攻撃の踏み台に使われるもののこと', aliases: ['botnet'] },
  { term: 'リモートコード実行', reading: 'りもーとこーどじっこう', definition: '離れた場所から、狙った機器に任意のプログラムを実行させられてしまうこと', aliases: ['remote code execution', 'rce'] },
  { term: '権限昇格', reading: 'けんげんしょうかく', definition: '本来与えられていない、より強い操作権限を不正に手に入れること', aliases: ['privilege escalation', '特権昇格'] },
  { term: 'SQLインジェクション', reading: 'えすきゅーえるいんじぇくしょん', definition: '入力欄などから不正なデータベース命令を紛れ込ませ、情報を盗んだり書き換えたりする攻撃のこと', aliases: ['sql injection', 'sqli'] },
  { term: 'クロスサイトスクリプティング', reading: 'くろすさいとすくりぷてぃんぐ', definition: 'Webサイトに不正なスクリプトを埋め込み、閲覧者の画面上で実行させる攻撃のこと', aliases: ['xss', 'cross-site scripting'] },
  { term: '認証情報', reading: 'にんしょうじょうほう', definition: 'IDやパスワードなど、本人であることを確かめるための情報のこと', aliases: ['credentials'] },
  { term: 'パスワードの使い回し', reading: 'ぱすわーどのつかいまわし', definition: '複数のサービスで同じパスワードを使うこと、1か所で漏れると他にも不正ログインされる危険がある', aliases: ['password reuse'] },
  { term: 'クレデンシャルスタッフィング', reading: 'くれでんしゃるすたっふぃんぐ', definition: '他で漏えいしたIDとパスワードの組を使い、別のサービスへ片っ端からログインを試す攻撃のこと', aliases: ['credential stuffing', 'リスト型攻撃'] },
  { term: 'ブルートフォース攻撃', reading: 'ぶるーとふぉーすこうげき', definition: 'パスワードの候補を総当たりで試して破ろうとする攻撃のこと', aliases: ['brute force', 'brute-force', '総当たり攻撃'] },
  { term: 'ソーシャルエンジニアリング', reading: 'そーしゃるえんじにありんぐ', definition: '技術的な侵入ではなく、人の心理や行動の隙を突いて情報を聞き出したり操作させたりする手口のこと', aliases: ['social engineering'] },
  { term: '標的型攻撃', reading: 'ひょうてきがたこうげき', definition: '特定の組織や個人を狙い、手口を作り込んで行われる攻撃のこと', aliases: ['targeted attack'] },
  { term: 'APT', reading: 'えーぴーてぃー', definition: '特定の標的に対し、長期間にわたって潜伏しながら続けられる高度な攻撃、またはその攻撃集団のこと', aliases: ['APT攻撃', 'advanced persistent threat'], caseSensitive: true },
  { term: 'EDR', reading: 'いーでぃーあーる', definition: 'パソコンやサーバーの挙動を監視し、不審な動きを検知して対処を支援する仕組みのこと', aliases: ['endpoint detection'] },
  { term: 'VPN', reading: 'ぶいぴーえぬ', definition: '通信を暗号化した専用の経路で、社外から社内ネットワークなどへ安全につなぐ仕組みのこと', aliases: ['仮想プライベートネットワーク', 'virtual private network'] },
  { term: 'ファームウェア', reading: 'ふぁーむうぇあ', definition: 'ルーターやカメラなどの機器本体に組み込まれている、基本動作を担うソフトウェアのこと', aliases: ['firmware'] },
  { term: 'セキュリティパッチ', reading: 'せきゅりてぃぱっち', definition: '脆弱性を修正するために提供される更新プログラムのこと', aliases: ['修正パッチ', 'パッチ', 'security patch', 'セキュリティ更新プログラム', 'セキュリティアップデート'] },
  { term: '暗号化', reading: 'あんごうか', definition: 'データを第三者に読めない形に変換し、鍵を持つ人だけが元に戻せるようにすること', aliases: ['encryption', 'encrypt'] },
  { term: 'ハッシュ化', reading: 'はっしゅか', definition: 'パスワードなどを元に戻せない別の値へ変換して保管する方法のこと', aliases: [] },
  { term: 'セッションハイジャック', reading: 'せっしょんはいじゃっく', definition: 'ログイン中の通信の情報を盗み、本人になりすましてサービスを使う攻撃のこと', aliases: ['session hijacking', 'セッション乗っ取り'] },
  { term: 'インフォスティーラー', reading: 'いんふぉすてぃーらー', definition: '端末に保存されたパスワードや認証情報などを盗み出すマルウェアのこと', aliases: ['infostealer', 'info stealer', 'info-stealer', '情報窃取型マルウェア', '情報窃取マルウェア'] },
  { term: 'ワイパー', reading: 'わいぱー', definition: '端末やサーバーのデータを消去して復旧できなくする、破壊を目的としたマルウェアのこと', aliases: ['wiper', 'ワイパーマルウェア'] },
  { term: 'ディープフェイク', reading: 'でぃーぷふぇいく', definition: 'AIで作られた、本物と見分けにくい偽の画像・音声・動画のこと', aliases: ['deepfake'] },
  { term: 'プロンプトインジェクション', reading: 'ぷろんぷといんじぇくしょん', definition: 'AIへの指示文に悪意ある命令を紛れ込ませ、AIに意図しない動作をさせる攻撃のこと', aliases: ['prompt injection'] },
  { term: 'ジェイルブレイク', reading: 'じぇいるぶれいく', definition: 'AIに設けられた安全上の制限を回避し、本来は断る回答を引き出そうとする行為のこと', aliases: [] },
  { term: 'ゼロトラスト', reading: 'ぜろとらすと', definition: '社内ネットワークでも無条件に信頼せず、アクセスのたびに確認する考え方のこと', aliases: ['zero trust'] },
  { term: 'CVE', reading: 'しーぶいいー', definition: '公開された脆弱性に1件ずつ付けられる、世界共通の識別番号のこと', aliases: ['cve番号'] },
  { term: 'CVSS', reading: 'しーぶいえすえす', definition: '脆弱性の深刻さを0から10の数値で表す、世界共通の評価基準のこと', aliases: ['共通脆弱性評価システム'] },
  { term: '多層防御', reading: 'たそうぼうぎょ', definition: '1つの対策に頼らず、複数の守りを重ねて被害を防ぐ考え方のこと', aliases: ['defense in depth', 'defence in depth'] },
  { term: 'ペネトレーションテスト', reading: 'ぺねとれーしょんてすと', definition: '本物の攻撃者と同じ手法で、システムの弱点を実際に試して調べる検査のこと', aliases: ['penetration test', 'pentest', '侵入テスト'] },
  { term: 'ダークウェブ', reading: 'だーくうぇぶ', definition: '通常の検索では見つからず、特別なソフトを使って接続する匿名性の高いネットの領域のこと', aliases: ['dark web', 'darkweb'] },
  { term: 'スキミング', reading: 'すきみんぐ', definition: 'カードの情報や決済情報を不正に読み取って盗むこと、決済端末への細工やWebサイトへの不正なスクリプトの埋め込みなどで行われる', aliases: ['skimming', 'スキマー', 'skimmer'] },
  { term: 'スミッシング', reading: 'すみっしんぐ', definition: 'SMS（ショートメッセージ）で偽のリンクを送り、偽サイトへ誘導してだまし取る手口のこと', aliases: ['smishing'] },
  { term: 'ボイスフィッシング', reading: 'ぼいすふぃっしんぐ', definition: '電話や音声で金融機関などを装い、暗証番号やパスワードを聞き出す手口のこと', aliases: ['ビッシング', 'vishing', 'voice phishing'] },
];

const nfkc = (s) => String(s).normalize('NFKC');

// 1語に付ける脚注の上限。定義は一般知識なので、出典を並べすぎて「全部がこの定義の根拠」と読ませない
export const MAX_SOURCES_PER_TERM = 2;

// 英数字だけの語は単語境界で照合する（'rce' が source に、'apt' が adapt に一致しないように）
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function matcher(needle, caseSensitive) {
  const n = caseSensitive ? needle : needle.toLowerCase();
  const fold = (t) => (caseSensitive ? t : t.toLowerCase());
  if (/^[A-Za-z0-9 -]+$/.test(n)) {
    const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(n)}(?![A-Za-z0-9])`);
    return (t) => re.test(fold(t));
  }
  return (t) => fold(t).includes(n);
}

/**
 * 記事本文に出てくる辞書の用語を拾う。脚注 id は、その語が出てくる「文」に付いているものだけを使う
 * （脚注の無い文は拾わない。出典に紐付かない用語を載せないため）。
 * 他の用語の一部になっている語（ボイスフィッシングに対するフィッシング）は、長い方だけを残す。
 * @param {string} bodyText Stage B の本文（脚注 [^s-xxxx] 入り）
 * @param {Set<string>} validIds このテーマに与えられた出典 id
 * @returns {Array<{term, reading, definition, sourceIds}>}
 */
export function findGlossaryTerms(bodyText, validIds) {
  // 出典ゲートと同じく「。」までを1文とし、脚注は句点より前に置かれている
  const sentences = String(bodyText ?? '')
    .split('\n')
    .flatMap((line) => line.split(/(?<=。)/))
    .map((raw) => ({ raw, text: nfkc(raw.replace(/\[\^[^\]]+\]/g, '')) }));
  const hits = [];
  for (const entry of SECURITY_TERMS) {
    const tests = [entry.term, ...entry.aliases].map((n) => matcher(nfkc(n), entry.caseSensitive === true));
    const ids = new Set();
    for (const { raw, text } of sentences) {
      if (!tests.some((t) => t(text))) continue;
      for (const m of raw.matchAll(/\[\^(s-[0-9a-f]+)\]/g)) if (validIds.has(m[1])) ids.add(m[1]);
    }
    if (ids.size > 0) hits.push({ term: entry.term, reading: entry.reading, definition: entry.definition, sourceIds: [...ids].slice(0, MAX_SOURCES_PER_TERM) });
  }
  return hits.filter((h) => !hits.some((o) => o !== h && o.term.includes(h.term)));
}
