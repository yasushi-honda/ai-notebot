import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as dnsPromises } from 'node:dns';
import {
  extractArticleText,
  sanitizeTitle,
  resolveSource,
  isLikelyMojibake,
  isAllowedTargetUrl,
  isResolvedAddressAllowed,
  readBoundedText,
} from '../lib/source-resolver.mjs';

// resolveSource は各ホップのfetch直前に実際にDNS解決して検証する（isResolvedAddressAllowed参照）。
// テストで使う `*.example` 等のホスト名は実在しない/テスト目的に沿わないため、実際のDNSには
// 依存させず、常に安全な公開IPを返すようモック化する（globalThis.fetchの既存モック方式と同様）。
function mockPublicDns() {
  const original = dnsPromises.lookup;
  dnsPromises.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  return () => {
    dnsPromises.lookup = original;
  };
}

// resolveSourceはHTML本文をres.body.getReader()経由で読み取る（MAX_RESPONSE_BYTES上限付き。
// source-resolver.mjs参照）ため、モックのfetch応答にはtext()だけでなくbodyストリームも必要。
function bodyFromText(text) {
  const encoded = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });
}

test('extractArticleText: script/styleタグの中身（JSON-LD・トラッキングコード）を除去する', () => {
  const html = `<html><head>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting"}</script>
    <style>.foo { color: red; }</style>
    <script>window.dataLayer = window.dataLayer || []; gtag('js', new Date());</script>
  </head><body>
    <p>介護現場でAIを活用した記録業務の効率化について解説します。具体的な導入手順を紹介します。</p>
  </body></html>`;
  const text = extractArticleText(html);
  assert.ok(!text.includes('schema.org'));
  assert.ok(!text.includes('dataLayer'));
  assert.ok(!text.includes('color: red'));
  assert.ok(text.includes('介護現場でAIを活用した記録業務の効率化について解説します'));
});

test('extractArticleText: nav/header/footerを除去し<p>タグの本文を優先する', () => {
  const html = `<html><body>
    <header><nav><a href="/">トップ</a><a href="/blog">ブログ</a></nav></header>
    <main><p>本文の段落です。ここに実際の記事内容が入ります。読み手にとって有用な情報を提供します。</p></main>
    <footer>Copyright 2026</footer>
  </body></html>`;
  const text = extractArticleText(html);
  assert.ok(!text.includes('トップ'));
  assert.ok(!text.includes('Copyright'));
  assert.ok(text.includes('本文の段落です'));
});

test('extractArticleText: <p>タグが無い/短すぎるページはノイズ除去済み全体テキストにフォールバックする', () => {
  const html = '<html><body><div>タグ構造が特殊なページの本文がここに書かれています。段落タグは使われていません。</div></body></html>';
  const text = extractArticleText(html);
  assert.ok(text.includes('タグ構造が特殊なページの本文'));
});

test('extractArticleText: 400字を超える本文は切り詰められる', () => {
  const html = `<body><p>${'あ'.repeat(600)}</p></body>`;
  const text = extractArticleText(html);
  assert.ok(text.length <= 400);
});

// sanitizeTitle: SNS投稿ページ等で<title>に改行を含む長文（投稿キャプション全文）が入っており、
// それをそのまま `[title](url)` の脚注定義に使うとMarkdownリンクの角括弧が閉じないまま
// 後続の地の文が続き、無出典の文として脚注検証をすり抜けてしまうバグの回帰テスト（実データで発覚）
test('sanitizeTitle: 改行を含む複数行のtitleを1行に正規化する', () => {
  const title = '見出しです\n\n本文の続きです。\nさらに続きます。';
  const result = sanitizeTitle(title);
  assert.ok(!result.includes('\n'));
  assert.equal(result, '見出しです 本文の続きです。 さらに続きます。');
});

test('sanitizeTitle: 角括弧を除去する（Markdownリンク構文を壊さないため）', () => {
  const result = sanitizeTitle('見出し[注記]です');
  assert.ok(!result.includes('['));
  assert.ok(!result.includes(']'));
});

// sanitizeTitle: 山括弧をそのまま通すと、スクレイピングした<title>にHTMLタグが含まれる場合
// （悪意あるページによる<script>や<img onerror=...>等）、Astroのremark-rehype
// （allowDangerousHtml: true）がMarkdownリンクラベル内の生HTMLをそのまま描画してしまい、
// 公開サイト上でストアド型XSSになる（codex reviewで指摘・修正）
test('sanitizeTitle: 山括弧を全角に置換する（生HTMLタグ注入・ストアド型XSS防止）', () => {
  const result = sanitizeTitle('見出しです<script>alert(1)</script>');
  assert.ok(!result.includes('<'));
  assert.ok(!result.includes('>'));
  assert.equal(result, '見出しです＜script＞alert(1)＜/script＞');
});

test('sanitizeTitle: img onerror等のタグ属性も山括弧の置換で無害化する', () => {
  const result = sanitizeTitle('<img src=x onerror=alert(1)>タイトル');
  assert.ok(!result.includes('<img'));
  assert.equal(result, '＜img src=x onerror=alert(1)＞タイトル');
});

test('sanitizeTitle: 長すぎるtitleは切り詰めて末尾を…にする', () => {
  const result = sanitizeTitle('あ'.repeat(300));
  assert.ok(result.length <= 150);
  assert.ok(result.endsWith('…'));
});

test('sanitizeTitle: 短い通常のtitleはそのまま', () => {
  assert.equal(sanitizeTitle('介護現場のAI活用ガイド'), '介護現場のAI活用ガイド');
});

// resolveSource: 到達できても本文の裏付けを一切提供できないソース（PDF等の非HTML・空のHTML）を
// 「到達性のみ検証済み」として採用してしまい、LLMがホスト名だけから公式の裏付けがある体で
// 本文を書けてしまうバグの回帰テスト（実データで厚労省の公式PDFがこの経路で採用され発覚）
test('resolveSource: 非HTML（PDF等）のレスポンスは本文抽出できないため採用しない', async () => {
  const originalFetch = globalThis.fetch;
  const restoreDns = mockPublicDns();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    url: 'https://example.com/doc.pdf',
    headers: { get: () => 'application/pdf' },
    text: async () => '',
  });
  try {
    const result = await resolveSource('https://vertexaisearch.example/redirect1');
    assert.equal(result.ok, false);
    assert.match(result.reason, /non-HTML|非HTML/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreDns();
  }
});

test('resolveSource: 本文がほぼ空のHTMLページは採用しない', async () => {
  const originalFetch = globalThis.fetch;
  const restoreDns = mockPublicDns();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    url: 'https://example.com/empty',
    headers: { get: () => 'text/html; charset=utf-8' },
    body: bodyFromText('<html><head><title>Empty</title></head><body></body></html>'),
  });
  try {
    const result = await resolveSource('https://vertexaisearch.example/redirect2');
    assert.equal(result.ok, false);
    assert.match(result.reason, /本文が空/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreDns();
  }
});

test('resolveSource: 本文が抽出できる通常のHTMLページは採用する', async () => {
  const originalFetch = globalThis.fetch;
  const restoreDns = mockPublicDns();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    url: 'https://example.com/article',
    headers: { get: () => 'text/html; charset=utf-8' },
    body: bodyFromText(
      '<html><head><title>記事タイトル</title></head><body>' +
        '<p>これは十分な長さの本文です。記事として成立する内容が書かれています。</p></body></html>',
    ),
  });
  try {
    const result = await resolveSource('https://vertexaisearch.example/redirect3');
    assert.equal(result.ok, true);
    assert.equal(result.title, '記事タイトル');
    assert.ok(result.excerpt.includes('これは十分な長さの本文です'));
  } finally {
    globalThis.fetch = originalFetch;
    restoreDns();
  }
});

// Content-Typeの大文字小文字はサーバー実装依存であり、小文字リテラルとの単純比較では
// 正当なHTMLページを非HTMLと誤判定して破棄してしまう回帰テスト（codex reviewで指摘・修正）
test('resolveSource: Content-Typeが大文字混じり（Text/HTML等）でもHTMLとして採用する', async () => {
  const originalFetch = globalThis.fetch;
  const restoreDns = mockPublicDns();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    url: 'https://example.com/article',
    headers: { get: () => 'Text/HTML; charset=UTF-8' },
    body: bodyFromText(
      '<html><head><title>記事タイトル</title></head><body>' +
        '<p>これは十分な長さの本文です。記事として成立する内容が書かれています。</p></body></html>',
    ),
  });
  try {
    const result = await resolveSource('https://vertexaisearch.example/redirect-case');
    assert.equal(result.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreDns();
  }
});

// isLikelyMojibake: Shift_JISページがUTF-8として誤デコードされ、置換文字(U+FFFD)だらけの
// 文字化けタイトルになる問題の回帰テスト（実データで官公庁の公式ページで実際に発生し発覚）
test('isLikelyMojibake: 置換文字が密集していれば文字化けと判定する', () => {
  assert.equal(isLikelyMojibake('��쌻��̐��Y������֘A���i���Y'), true);
});

test('isLikelyMojibake: 通常の日本語テキストは文字化けと判定しない', () => {
  assert.equal(isLikelyMojibake('介護現場における生産性向上に関する取り組み'), false);
});

test('isLikelyMojibake: 偶発的に1〜2文字の置換文字が混じっただけでは誤検出しない', () => {
  assert.equal(isLikelyMojibake('通常のテキストに1文字だけ�が混じった場合'), false);
});

test('isLikelyMojibake: 空文字はfalse', () => {
  assert.equal(isLikelyMojibake(''), false);
});

test('resolveSource: 文字化けしたtitleのページは採用しない', async () => {
  const originalFetch = globalThis.fetch;
  const restoreDns = mockPublicDns();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    url: 'https://example.go.jp/garbled',
    headers: { get: () => 'text/html; charset=utf-8' },
    body: bodyFromText(
      '<html><head><title>��쌻��̐��Y������֘A���i���Y������Ɏ�����K�C�h���C��</title></head>' +
        '<body><p>本文です。十分な長さがあります。読み手にとって有用な情報を提供します。</p></body></html>',
    ),
  });
  try {
    const result = await resolveSource('https://vertexaisearch.example/redirect5');
    assert.equal(result.ok, false);
    assert.match(result.reason, /文字化け/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreDns();
  }
});

// isAllowedTargetUrl / fetchFollowingSafeRedirects: グラウンディング結果が指すサイトが
// ループバック・リンクローカル・プライベートIP（クラウドメタデータエンドポイント等）への
// リダイレクトを返した場合、無条件に追従するとGitHub Actions runnerから内部ネットワークへ
// リクエストが飛び、レスポンス内容が公開リポジトリに漏出しうる（SSRF）。codex reviewで指摘・修正
test('isAllowedTargetUrl: 通常の公開HTTPS URLは許可する', () => {
  assert.equal(isAllowedTargetUrl('https://www.mhlw.go.jp/example'), true);
});

test('isAllowedTargetUrl: localhostは拒否する', () => {
  assert.equal(isAllowedTargetUrl('http://localhost/secret'), false);
  assert.equal(isAllowedTargetUrl('http://sub.localhost/secret'), false);
});

test('isAllowedTargetUrl: ループバックIP(127.0.0.1)は拒否する', () => {
  assert.equal(isAllowedTargetUrl('http://127.0.0.1/secret'), false);
});

test('isAllowedTargetUrl: クラウドメタデータエンドポイント(169.254.169.254)は拒否する', () => {
  assert.equal(isAllowedTargetUrl('http://169.254.169.254/latest/meta-data/'), false);
});

test('isAllowedTargetUrl: プライベートIPレンジ(10.x / 172.16-31.x / 192.168.x)は拒否する', () => {
  assert.equal(isAllowedTargetUrl('http://10.0.0.5/'), false);
  assert.equal(isAllowedTargetUrl('http://172.16.0.5/'), false);
  assert.equal(isAllowedTargetUrl('http://192.168.1.1/'), false);
});

// IANA IPv4 Special-Purpose Address Registry の特殊用途レンジのうち、代表的なプライベート
// レンジ以外にも漏れがあったバイパスの回帰テスト（codex reviewで指摘・修正）
test('isAllowedTargetUrl: CGNAT/共有アドレス空間(100.64.0.0/10)は拒否する', () => {
  assert.equal(isAllowedTargetUrl('http://100.64.0.1/'), false);
  assert.equal(isAllowedTargetUrl('http://100.100.0.1/'), false);
  assert.equal(isAllowedTargetUrl('http://100.128.0.1/'), true); // /10の範囲外は許可
});

test('isAllowedTargetUrl: ベンチマーク用(198.18.0.0/15)は拒否する', () => {
  assert.equal(isAllowedTargetUrl('http://198.18.0.1/'), false);
  assert.equal(isAllowedTargetUrl('http://198.19.255.254/'), false);
});

test('isAllowedTargetUrl: ドキュメント用レンジ(TEST-NET-1/2/3)は拒否する', () => {
  assert.equal(isAllowedTargetUrl('http://192.0.2.1/'), false);
  assert.equal(isAllowedTargetUrl('http://198.51.100.1/'), false);
  assert.equal(isAllowedTargetUrl('http://203.0.113.1/'), false);
});

test('isAllowedTargetUrl: マルチキャスト(224.0.0.0/4)・reserved(240.0.0.0/4)・broadcastは拒否する', () => {
  assert.equal(isAllowedTargetUrl('http://224.0.0.1/'), false);
  assert.equal(isAllowedTargetUrl('http://255.255.255.255/'), false);
});

test('isAllowedTargetUrl: 通常の公開IPv4アドレスは引き続き許可する', () => {
  assert.equal(isAllowedTargetUrl('http://8.8.8.8/'), true);
  assert.equal(isAllowedTargetUrl('http://203.0.112.1/'), true); // TEST-NET-3の直前は範囲外
});

// IPv6の特殊用途レンジ（ループバック・リンクローカル fe80::/10・ユニークローカル fc00::/7・
// 非推奨のサイトローカル fec0::/10・IPv4-mapped/compatible・NAT64 等）は多岐にわたり、
// 個別に拒否パターンを追加する方式では codex review で fe80::/10 の範囲漏れ・
// IPv4-compatible表記漏れ・site-local漏れを次々と指摘された。そのため「IANAが現在
// グローバルユニキャストとして割り当てているレンジ（2000::/3）のみ許可する」許可リスト方式に
// 設計変更した（isAllowedTargetUrl実装のコメント参照）。特殊用途レンジはいずれもこの範囲の
// 外側にあるため、以下は全て一括で拒否されることを確認する。
test('isAllowedTargetUrl: グローバルユニキャストレンジ(2000::/3)のIPv6アドレスは許可する', () => {
  assert.equal(isAllowedTargetUrl('http://[2001:4860:4860::8888]/'), true); // Google Public DNS
  assert.equal(isAllowedTargetUrl('http://[2606:4700:4700::1111]/'), true); // Cloudflare DNS
});

test('isAllowedTargetUrl: IPv6ループバック(::1)・unspecified(::)は拒否する', () => {
  assert.equal(isAllowedTargetUrl('http://[::1]/secret'), false);
  assert.equal(isAllowedTargetUrl('http://[::]/'), false);
});

test('isAllowedTargetUrl: IPv6リンクローカル(fe80::/10)は範囲全体を拒否する', () => {
  assert.equal(isAllowedTargetUrl('http://[fe80::1]/'), false);
  assert.equal(isAllowedTargetUrl('http://[fe90::1]/'), false);
  assert.equal(isAllowedTargetUrl('http://[febf::1]/'), false);
});

test('isAllowedTargetUrl: IPv6ユニークローカル(fc00::/7)・非推奨のサイトローカル(fec0::/10)は拒否する', () => {
  assert.equal(isAllowedTargetUrl('http://[fc00::1]/'), false);
  assert.equal(isAllowedTargetUrl('http://[fec0::1]/'), false);
});

test('isAllowedTargetUrl: IPv4-mapped(::ffff:a.b.c.d)は埋め込まれたIPv4に関わらず拒否する', () => {
  assert.equal(isAllowedTargetUrl('http://[::ffff:127.0.0.1]/secret'), false);
  assert.equal(isAllowedTargetUrl('http://[::ffff:169.254.169.254]/latest/meta-data/'), false);
  assert.equal(isAllowedTargetUrl('http://[::ffff:8.8.8.8]/'), false); // 公開IPを埋め込んでいても2000::/3外のため拒否
});

test('isAllowedTargetUrl: IPv4-compatible(::a.b.c.d)・NAT64(64:ff9b::/96)も拒否する', () => {
  assert.equal(isAllowedTargetUrl('http://[::127.0.0.1]/secret'), false);
  assert.equal(isAllowedTargetUrl('http://[64:ff9b::127.0.0.1]/secret'), false);
  assert.equal(isAllowedTargetUrl('http://[::8.8.8.8]/'), false); // 公開IPを埋め込んでいても2000::/3外のため拒否
});

// DNSの末尾ドット（FQDN表記）は new URL() で保持されるが、多くのDNSリゾルバは末尾ドット無しと
// 同一に解決するため、正規化しないと "localhost." が拒否リストを素通りするバイパスの回帰テスト
// （codex reviewで指摘・修正）
test('isAllowedTargetUrl: 末尾ドット付きのlocalhost（localhost.）も拒否する', () => {
  assert.equal(isAllowedTargetUrl('http://localhost./secret'), false);
});

test('isAllowedTargetUrl: 末尾ドット付きのサブドメイン（foo.localhost.）も拒否する', () => {
  assert.equal(isAllowedTargetUrl('http://foo.localhost./secret'), false);
});

test('isAllowedTargetUrl: http/https以外のスキームは拒否する', () => {
  assert.equal(isAllowedTargetUrl('file:///etc/passwd'), false);
});

test('isAllowedTargetUrl: 不正なURLはfalse', () => {
  assert.equal(isAllowedTargetUrl('not-a-url'), false);
});

test('resolveSource: 攻撃者が制御するサイトがプライベートIPへのリダイレクトを返しても追従しない', async () => {
  const originalFetch = globalThis.fetch;
  const restoreDns = mockPublicDns();
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://vertexaisearch.example')) {
      return {
        ok: false,
        status: 302,
        url,
        headers: { get: (h) => (h === 'location' ? 'http://169.254.169.254/latest/meta-data/' : null) },
        text: async () => '',
      };
    }
    throw new Error('内部ネットワークへのリクエストが発生しました（テスト失敗を意味する）');
  };
  try {
    const result = await resolveSource('https://vertexaisearch.example/redirect-ssrf');
    assert.equal(result.ok, false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreDns();
  }
});

test('resolveSource: 公開URLへの正常なリダイレクトは追従する', async () => {
  const originalFetch = globalThis.fetch;
  const restoreDns = mockPublicDns();
  globalThis.fetch = async (url) => {
    if (String(url) === 'https://vertexaisearch.example/redirect-ok') {
      return {
        ok: false,
        status: 302,
        url,
        headers: { get: (h) => (h === 'location' ? 'https://real-article.example.com/page' : null) },
        text: async () => '',
      };
    }
    if (String(url) === 'https://real-article.example.com/page') {
      return {
        ok: true,
        status: 200,
        url,
        headers: { get: (h) => (h === 'content-type' ? 'text/html; charset=utf-8' : null) },
        body: bodyFromText(
          '<html><head><title>実在の記事</title></head><body><p>十分な長さの本文がここに書かれています。記事として成立する内容です。</p></body></html>',
        ),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  try {
    const result = await resolveSource('https://vertexaisearch.example/redirect-ok');
    assert.equal(result.ok, true);
    assert.equal(result.url, 'https://real-article.example.com/page');
  } finally {
    globalThis.fetch = originalFetch;
    restoreDns();
  }
});

test('resolveSource: HTTPエラーステータスは採用しない', async () => {
  const originalFetch = globalThis.fetch;
  const restoreDns = mockPublicDns();
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    url: 'https://example.com/notfound',
    headers: { get: () => 'text/html' },
    text: async () => '',
  });
  try {
    const result = await resolveSource('https://vertexaisearch.example/redirect4');
    assert.equal(result.ok, false);
    assert.equal(result.httpStatus, 404);
  } finally {
    globalThis.fetch = originalFetch;
    restoreDns();
  }
});

// isResolvedAddressAllowed: isAllowedTargetUrlはURL文字列上のホスト名・IPリテラルのみを見るため、
// `169.254.169.254.nip.io` のようなワイルドカードDNSサービスを使い、一見公開ドメインに見える
// ホスト名がDNS解決時にプライベートIP（クラウドメタデータサーバ等）を返すケースを検出できない
// （codex reviewで指摘・修正）。fetch直前にDNS解決した実アドレスを検証する。
test('isResolvedAddressAllowed: DNS解決先がプライベートIPなら拒否する（DNSリバインディング対策）', async () => {
  const original = dnsPromises.lookup;
  dnsPromises.lookup = async () => [{ address: '169.254.169.254', family: 4 }];
  try {
    assert.equal(await isResolvedAddressAllowed('169.254.169.254.nip.io'), false);
  } finally {
    dnsPromises.lookup = original;
  }
});

test('isResolvedAddressAllowed: DNS解決先が公開IPなら許可する', async () => {
  const original = dnsPromises.lookup;
  dnsPromises.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  try {
    assert.equal(await isResolvedAddressAllowed('example.com'), true);
  } finally {
    dnsPromises.lookup = original;
  }
});

test('isResolvedAddressAllowed: 複数の解決結果のうち1件でもプライベートIPを含めば拒否する', async () => {
  const original = dnsPromises.lookup;
  dnsPromises.lookup = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.1', family: 4 },
  ];
  try {
    assert.equal(await isResolvedAddressAllowed('multi-a-record.example'), false);
  } finally {
    dnsPromises.lookup = original;
  }
});

test('isResolvedAddressAllowed: DNS解決に失敗した場合は安全側に倒して拒否する（fail closed）', async () => {
  const original = dnsPromises.lookup;
  dnsPromises.lookup = async () => {
    throw new Error('ENOTFOUND');
  };
  try {
    assert.equal(await isResolvedAddressAllowed('does-not-resolve.example'), false);
  } finally {
    dnsPromises.lookup = original;
  }
});

test('isResolvedAddressAllowed: IPリテラルはDNS解決せずisIPで即座に許可する', async () => {
  let called = false;
  const original = dnsPromises.lookup;
  dnsPromises.lookup = async () => {
    called = true;
    return [];
  };
  try {
    assert.equal(await isResolvedAddressAllowed('8.8.8.8'), true);
    assert.equal(called, false);
  } finally {
    dnsPromises.lookup = original;
  }
});

// readBoundedText: res.text()は応答全体をメモリにバッファしてから返すため、悪意ある・壊れた
// ソースが巨大な応答を返すと収集プロセスやCI runnerのメモリを枯渇させうる（codex reviewで
// 指摘・修正）。上限バイト数に達した時点でストリームを打ち切ることを確認する。
test('readBoundedText: 上限以下の本文はそのまま返す', async () => {
  const text = '短い本文です。';
  const res = { body: bodyFromText(text) };
  assert.equal(await readBoundedText(res, 1024), text);
});

test('readBoundedText: 上限を超える本文は上限バイト数で打ち切る', async () => {
  const text = 'a'.repeat(10_000);
  const res = { body: bodyFromText(text) };
  const result = await readBoundedText(res, 100);
  assert.equal(result.length, 100);
});

test('readBoundedText: bodyが無い場合は空文字を返す', async () => {
  const result = await readBoundedText({ body: null });
  assert.equal(result, '');
});
