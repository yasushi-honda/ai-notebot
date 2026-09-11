/**
 * Vertex AI の Google 検索グラウンディングが返す groundingChunks は、実URLではなく
 * `vertexaisearch.cloud.google.com/grounding-api-redirect/...` という約30日で失効する
 * リダイレクトURLしか含まない（公式ドキュメントで確認済み。title もドメイン名のみ）。
 * このモジュールは実際にリダイレクトを辿って実URL・実タイトル・到達性を検証し、
 * 到達できないソースは呼び出し側で破棄できるようにする。
 */
import { isIP } from 'node:net';
// globalThis.fetch と同様、テストから差し替えられるように名前付き関数ではなく
// promisesオブジェクト経由で呼び出す（dnsPromises.lookup をテスト側でモンキーパッチする）。
import { promises as dnsPromises } from 'node:dns';
import { decodeEntities, stripTags } from './rss.mjs';

const FETCH_TIMEOUT_MS = 15000;
const USER_AGENT =
  'Mozilla/5.0 (compatible; ai-notebot/1.0; +https://github.com/yasushi-honda/ai-notebot)';
const MIN_PARAGRAPH_TEXT_LENGTH = 50;
const MAX_REDIRECTS = 10;
// 記事本文の抽出にはページ冒頭の数十KB程度あれば十分であり、これを大きく超える上限。
// res.text() は応答全体をメモリにバッファしてから返すため、悪意ある・壊れたソースが
// 巨大な（あるいはchunked encodingで際限なく続く）応答を返すと収集プロセスやCI runnerの
// メモリを枯渇させうる（codex reviewで指摘・修正）。
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB

/**
 * リダイレクト先URLがループバック・リンクローカル・プライベートIPレンジ等の
 * 非公開ネットワーク宛でないかを検証する（SSRF対策）。groundingChunks の URL は
 * Googleが検索した任意の外部サイトに由来し、そのサイトが `http://169.254.169.254/...`
 * （クラウドメタデータエンドポイント）や `http://localhost/...` へのHTTPリダイレクトを
 * 返した場合、`fetch(..., redirect: 'follow')` で無条件に追従すると GitHub Actions runner
 * から内部ネットワークへのリクエストが発生し、そのレスポンス内容が data/raw-care/*.json
 * 経由で公開リポジトリに漏出しうる（codex reviewで指摘・修正）。
 *
 * 注意（既知の限界）: この関数自体はURL文字列上のホスト名・IPリテラルのみを検証する。
 * `169.254.169.254.nip.io` のようなワイルドカードDNSサービスを使えば、ホスト名自体は
 * IPリテラルに見えないままDNS解決結果だけがプライベートIP（クラウドメタデータサーバ等）を
 * 指すケースがあり、文字列検証だけではこれを検出できない（codex reviewで指摘）。この種の
 * 攻撃は `isResolvedAddressAllowed`（fetch直前にDNS解決して実IPを検証する）と組み合わせて
 * 遮断する。ただし「検証したIPに直接接続しHost/SNIだけ差し替える」という完全なDNS
 * rebinding対策（TOCTOUの窓を完全に閉じる）は標準fetch APIの範囲を超え新規依存パッケージが
 * 必要になり、本プロジェクトの「新規パッケージ非依存」方針（CLAUDE.md）に反するため採用しない
 * （多層防御として、窓を最小化するに留める）。
 */
/**
 * IANA IPv4 Special-Purpose Address Registry に基づく非公開・特殊用途レンジ一覧。
 * 当初は10.0.0.0/8等の代表的なプライベートレンジのみを拒否していたが、100.64.0.0/10
 * （CGNAT・共有アドレス空間）や198.18.0.0/15（ベンチマーク用）等、インターネットからは
 * 到達不能でもCI runner内では到達しうる特殊用途レンジが漏れていた（codex reviewで指摘・修正）。
 * [network, prefixLength] のCIDR表記で網羅的に持つ。
 */
const BLOCKED_IPV4_CIDRS = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT / shared address space
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local（クラウドメタデータエンドポイント169.254.169.254を含む）
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation (TEST-NET-1)
  ['192.88.99.0', 24], // 6to4 relay anycast（非推奨だが特殊用途のまま）
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation (TEST-NET-2)
  ['203.0.113.0', 24], // documentation (TEST-NET-3)
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved（255.255.255.255のbroadcastを含む）
];

function ipv4ToInt(ipv4String) {
  const parts = ipv4String.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** IPv4アドレス（a.b.c.d文字列）が非公開・特殊用途レンジ（BLOCKED_IPV4_CIDRS）に含まれるか判定する */
function isPrivateIPv4(ipv4String) {
  const ip = ipv4ToInt(ipv4String);
  if (ip === null) return false; // 不正な形式は呼び出し側で拒否させる
  return BLOCKED_IPV4_CIDRS.some(([network, prefixLen]) => {
    const networkInt = ipv4ToInt(network);
    const mask = prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0;
    return (ip & mask) === (networkInt & mask);
  });
}

/**
 * IPv6アドレス文字列（"::"圧縮表記を含む）を8個の16bitグループ（0〜0xffffの数値）の配列に
 * 展開する。パースできない場合は null を返す。
 */
function expandIPv6(hostname) {
  let leftPart = hostname;
  let rightPart = '';
  let hasDoubleColon = false;
  const doubleColonIndex = hostname.indexOf('::');
  if (doubleColonIndex !== -1) {
    hasDoubleColon = true;
    leftPart = hostname.slice(0, doubleColonIndex);
    rightPart = hostname.slice(doubleColonIndex + 2);
  }
  const leftGroups = leftPart ? leftPart.split(':') : [];
  const rightGroups = rightPart ? rightPart.split(':') : [];
  const missing = hasDoubleColon ? 8 - leftGroups.length - rightGroups.length : 0;
  if (missing < 0) return null;
  const allGroupStrings = hasDoubleColon
    ? [...leftGroups, ...Array(missing).fill('0'), ...rightGroups]
    : [...leftGroups];
  if (allGroupStrings.length !== 8) return null;
  const groups = allGroupStrings.map((g) => parseInt(g, 16));
  if (groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

export function isAllowedTargetUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  // DNSの末尾ドット（FQDN表記。例: "localhost."）は new URL() で保持されたままになるが、
  // 多くのDNSリゾルバは末尾ドット無しの表記と同一のものとして解決するため、正規化せずに
  // 文字列比較すると "localhost." が localhost 拒否リストを素通りしてしまう
  // （codex reviewで指摘・修正）。判定前に必ず末尾ドットを1つ取り除く。
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false;

  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    return !isPrivateIPv4(hostname);
  }
  if (ipVersion === 6) {
    // IPv6は特殊用途レンジ（ループバック・リンクローカル fe80::/10・ユニークローカル fc00::/7・
    // 非推奨のサイトローカル fec0::/10・IPv4-mapped/compatible・NAT64 等）が多岐にわたり、
    // 個別にパターンを拒否リストへ追加する方式では codex review で4回にわたり fe80::/10 の
    // 範囲漏れ・IPv4-compatible表記漏れ・site-local漏れを次々と指摘された。IANA IPv6
    // Special-Purpose Address Registry を都度追いかけるのは非現実的なため、方針を転換し
    // 「IANAが現在グローバルユニキャストとして割り当てているレンジ（2000::/3）のみ許可する」
    // 許可リスト方式にする。ループバック等の特殊用途レンジはいずれもこの範囲の外側にあるため、
    // 個別の拒否パターンを保守しなくても自動的に遮断できる（頑健性の高い設計）。
    const groups = expandIPv6(hostname);
    if (!groups) return false; // 展開できないアドレスは安全側で拒否する
    const firstGroup = groups[0];
    if (firstGroup < 0x2000 || firstGroup > 0x3fff) return false; // 2000::/3 以外は拒否
    // 注: IPv4-mapped(::ffff:0:0/96)・IPv4-compatible(::/96)・NAT64(64:ff9b::/96)は
    // いずれも先頭グループが 0 または 0x0064 であり 2000::/3 の外側にあるため、
    // 上のグローバルユニキャスト判定だけで自動的に遮断される（個別の埋め込みIPv4チェックは不要）。
    return true;
  }
  return true;
}

/**
 * ホスト名（IPリテラルでない場合）をDNS解決し、実際に接続されうる全アドレスが
 * プライベート/特殊用途レンジでないことを検証する（isAllowedTargetUrlの「既知の限界」参照）。
 * 解決できない・空・いずれかのアドレスが不許可な場合は安全側に倒して拒否する（fail closed）。
 */
export async function isResolvedAddressAllowed(hostname) {
  if (isIP(hostname)) return true; // IPリテラルはisAllowedTargetUrl側で既に検証済み
  let addresses;
  try {
    addresses = await dnsPromises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return false;
  }
  if (addresses.length === 0) return false;
  return addresses.every(({ address, family }) => {
    if (family === 4) return !isPrivateIPv4(address);
    if (family === 6) {
      const groups = expandIPv6(address);
      if (!groups) return false;
      const firstGroup = groups[0];
      return firstGroup >= 0x2000 && firstGroup <= 0x3fff; // 2000::/3 のみ許可
    }
    return false;
  });
}

/**
 * `fetch(..., redirect: 'follow')` の代わりに、各ホップのリダイレクト先を検証しながら
 * 手動でリダイレクトを追従する（SSRF対策。isAllowedTargetUrl / isResolvedAddressAllowed参照）。
 */
async function fetchFollowingSafeRedirects(initialUrl, options) {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedTargetUrl(currentUrl)) {
      throw new Error(`許可されないリダイレクト先です: ${currentUrl}`);
    }
    const hostname = new URL(currentUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!(await isResolvedAddressAllowed(hostname))) {
      throw new Error(`DNS解決先が許可されないアドレスです: ${currentUrl}`);
    }
    const res = await fetch(currentUrl, { ...options, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      currentUrl = new URL(res.headers.get('location'), currentUrl).toString();
      continue;
    }
    return { res, finalUrl: currentUrl };
  }
  throw new Error('リダイレクトの回数が上限を超えました');
}

/**
 * ページHTMLから記事本文らしきテキストを抽出する。
 * `stripTags`（rss.mjs、RSSのdescriptionフィールド用）はタグの「外側」だけを除去するため、
 * <script>・<style>タグの「中身」（トラッキングコード・JSON-LD構造化データ等）がそのまま
 * 地の文として残ってしまい、実際のページ本文ではなくJSノイズがLLMに渡ってしまう
 * （実データで確認済み: 複数のcollect-care.mjs出力のsummaryがJSON-LDやjQuery初期化コードに
 * なっていた。codex reviewで指摘・修正）。script/style/nav/header/footerをブロックごと除去し、
 * `<p>`タグから本文らしきテキストを優先的に集める。
 */
export function extractArticleText(html) {
  const withoutNoise = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // <head> には <title>・meta・link 等、本文ではない情報しか含まれない。除去しないと
    // <p>タグが見つからないページのフォールバック抽出で <title> の文字列が「本文」として
    // 拾われてしまう（実データで空のHTMLページに対するテストで発覚）。
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, ' ')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ');

  const paragraphs = [...withoutNoise.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripTags(m[1]))
    .filter((t) => t.trim().length > 0);
  const fromParagraphs = paragraphs.join(' ').trim();
  if (fromParagraphs.length >= MIN_PARAGRAPH_TEXT_LENGTH) return fromParagraphs.slice(0, 400);

  // <p>から十分な量が取れないページ（マークアップが特殊なページ等）は、
  // ノイズ除去済みHTML全体のフォールバックにする（何も取れないよりはまし）。
  return stripTags(withoutNoise);
}

const MAX_TITLE_LENGTH = 150;
const MOJIBAKE_RATIO_THRESHOLD = 0.05; // U+FFFD（置換文字）がこの割合を超えたら文字化けとみなす
const MOJIBAKE_MIN_COUNT = 3; // 短いtitle等で1〜2文字の偶発的な置換文字まで誤検出しないための下限

/** 文字列中の置換文字(U+FFFD)の密度から、charset誤判定によるデコード崩れ（文字化け）を検出する */
export function isLikelyMojibake(text) {
  if (!text) return false;
  const replacementCount = [...text].filter((c) => c === '�').length;
  if (replacementCount < MOJIBAKE_MIN_COUNT) return false;
  return replacementCount / text.length >= MOJIBAKE_RATIO_THRESHOLD;
}

/**
 * ページの <title> をMarkdownの脚注定義（`[^id]: [title](url)`）にそのまま埋め込んでも安全な
 * 一行の短いテキストに正規化する。SNS投稿など一部のページは <title> に改行を含む長文
 * （投稿キャプション全文など）を入れていることがあり、そのまま `[title](url)` に使うと
 * Markdownリンクの角括弧が閉じないまま本文が続き、後続の地の文が「見出しでも脚注定義でもない
 * 地の文」として脚注検証にすり抜けてしまう（実データで実際に発生し発覚。理論上の懸念ではない）。
 * 角括弧もリンク構文を壊すため除去する。
 */
export function sanitizeTitle(title, maxLength = MAX_TITLE_LENGTH) {
  // スクレイピングしたページの<title>にHTML（<script>等）が含まれると、Astroの
  // Markdown処理（remark-rehypeの allowDangerousHtml: true）でストアド型XSSになりうる。
  // [ ] はMarkdownリンク構文の破壊防止、< > はHTMLタグ注入防止のため両方とも中和する
  // （codex reviewで指摘・修正）。
  const collapsed = String(title)
    .replace(/\s+/g, ' ')
    .replace(/[[\]]/g, '')
    .replace(/</g, '＜')
    .replace(/>/g, '＞')
    .trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 1)}…` : collapsed;
}

/**
 * レスポンスボディを上限バイト数までしか読み取らない（MAX_RESPONSE_BYTES参照）。
 * 上限に達した時点でストリームを打ち切り（cancel）、それ以上ダウンロードしない。
 * fetch/Response.text() はWHATWG Fetch仕様上、Content-Typeのcharsetに関わらず常にUTF-8
 * デコードするため、単純にチャンクを結合してUTF-8デコードすれば res.text() と同じ挙動になる
 * （文字コードがUTF-8でないページの文字化け検出は既存の isLikelyMojibake が別途担う）。
 */
export async function readBoundedText(res, maxBytes = MAX_RESPONSE_BYTES) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        chunks.push(value.subarray(0, value.byteLength - (received - maxBytes)));
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * @param {string} redirectUrl groundingChunks[].web.uri
 * @returns {Promise<{ok: boolean, url: string, httpStatus: number, title: string, excerpt: string} | {ok: false, url: string, httpStatus: number | null, reason?: string}>}
 */
export async function resolveSource(redirectUrl) {
  try {
    const { res, finalUrl } = await fetchFollowingSafeRedirects(redirectUrl, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      return { ok: false, url: finalUrl, httpStatus: res.status };
    }

    // Content-Type ヘッダの大文字小文字はサーバー実装依存（例: "Text/HTML; charset=UTF-8"）で
    // あり、そのまま小文字リテラルと比較すると正当なHTMLページを非HTMLと誤判定して破棄してしまう
    // （codex reviewで指摘・修正）。
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html')) {
      // HTML以外（PDF等）はテキスト抽出手段を持たない（新規依存パッケージを追加しない方針のため）。
      // 到達できても本文の裏付けを一切提供できないソースを採用してしまうと、curate-care.mjs には
      // ホスト名だけが渡り、LLMが「公式の裏付けがある」体で本文を書けてしまう（実データで
      // 厚労省の公式PDFがこの経路で採用され発覚。codex reviewで指摘・修正）。採用しない。
      return { ok: false, url: finalUrl, httpStatus: res.status, reason: 'no-extractable-text（非HTMLコンテンツ）' };
    }

    const html = await readBoundedText(res);
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? sanitizeTitle(decodeEntities(titleMatch[1])) : '';
    const excerpt = extractArticleText(html);

    // res.text() はContent-Typeヘッダのcharsetを見てデコードするが、charsetをHTTPヘッダではなく
    // HTML内の<meta charset>だけで宣言しているページ（Shift_JIS運用の官公庁サイト等に多い）は
    // UTF-8として誤ってデコードされ、不正なバイト列がU+FFFD（置換文字）だらけの文字化けタイトルに
    // なる（実データで厚労省関連の official ページで実際に発生し発覚）。新規の文字コード判定
    // ライブラリを追加する方針は取らず、置換文字の密度で機械的に検出して採用しない。
    if (isLikelyMojibake(title) || isLikelyMojibake(excerpt)) {
      return { ok: false, url: finalUrl, httpStatus: res.status, reason: 'no-extractable-text（文字化けを検出）' };
    }

    if (!excerpt.trim()) {
      // HTMLとして取得できても本文がほぼ空（マークアップが特殊、JS必須のSPA等）の場合も同様に
      // 裏付けを提供できないため採用しない。
      return { ok: false, url: finalUrl, httpStatus: res.status, reason: 'no-extractable-text（本文が空）' };
    }

    return { ok: true, url: finalUrl, httpStatus: res.status, title, excerpt };
  } catch (err) {
    return { ok: false, url: redirectUrl, httpStatus: null, error: err.message };
  }
}
