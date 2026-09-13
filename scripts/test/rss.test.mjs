import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, decodeEntities, stripTags, pick } from '../lib/rss.mjs';

test('decodeEntities: &amp; を最後にデコードする（二重デコード防止）', () => {
  assert.equal(decodeEntities('A &amp;lt; B'), 'A &lt; B');
  assert.equal(decodeEntities('&#x3042;&#12356;'), 'あい');
  assert.equal(decodeEntities('<![CDATA[hello & world]]>'), 'hello & world');
});

test('stripTags: HTMLタグを除去し400文字に切り詰める', () => {
  assert.equal(stripTags('<p>hello <b>world</b></p>'), 'hello world');
  const long = 'a'.repeat(500);
  assert.equal(stripTags(long).length, 400);
});

test('pick: 複数タグ候補から最初にマッチしたものを返す', () => {
  const block = '<entry><summary>要約</summary><content>本文</content></entry>';
  assert.equal(pick(block, 'description', 'summary', 'content'), '要約');
});

test('parseFeed: 空フィードは空配列を返す', () => {
  assert.deepEqual(parseFeed('<rss><channel></channel></rss>'), []);
  assert.deepEqual(parseFeed(''), []);
});

test('parseFeed: RSS 2.0 の item を正しくパースする', () => {
  const xml = `<rss><channel>
    <item>
      <title>テスト記事</title>
      <link>https://example.com/a</link>
      <pubDate>Wed, 10 Sep 2026 00:00:00 GMT</pubDate>
      <description><![CDATA[<p>概要です</p>]]></description>
    </item>
  </channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'テスト記事');
  assert.equal(items[0].url, 'https://example.com/a');
  assert.equal(items[0].description, '概要です');
  assert.ok(items[0].date instanceof Date);
});

test('parseFeed: Atom の entry（相対リンクではなく href 属性のlink）を正しくパースする', () => {
  const xml = `<feed>
    <entry>
      <title>Atomエントリ</title>
      <link href="https://example.com/b" rel="alternate"/>
      <published>2026-09-10T00:00:00Z</published>
      <summary>要約テキスト</summary>
    </entry>
  </feed>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://example.com/b');
});

test('parseFeed: 不正な日付のエントリは除外する', () => {
  const xml = `<rss><channel>
    <item>
      <title>日付不正</title>
      <link>https://example.com/c</link>
      <pubDate>not-a-date</pubDate>
    </item>
  </channel></rss>`;
  assert.deepEqual(parseFeed(xml), []);
});

test('parseFeed: 日付欠落のエントリは除外する', () => {
  const xml = `<rss><channel>
    <item>
      <title>日付なし</title>
      <link>https://example.com/d</link>
    </item>
  </channel></rss>`;
  assert.deepEqual(parseFeed(xml), []);
});

test('parseFeed: isPermaLink=false な guid（壊れたURL）のエントリは除外する', () => {
  const xml = `<rss><channel>
    <item>
      <title>非URLguid</title>
      <guid isPermaLink="false">tag:example.com,2026:abc123</guid>
      <pubDate>Wed, 10 Sep 2026 00:00:00 GMT</pubDate>
    </item>
  </channel></rss>`;
  assert.deepEqual(parseFeed(xml), []);
});

test('parseFeed: title欠落のエントリは除外する', () => {
  const xml = `<rss><channel>
    <item>
      <link>https://example.com/e</link>
      <pubDate>Wed, 10 Sep 2026 00:00:00 GMT</pubDate>
    </item>
  </channel></rss>`;
  assert.deepEqual(parseFeed(xml), []);
});

test('parseFeed: 複数エントリを正しい件数でパースする', () => {
  const xml = `<rss><channel>
    <item><title>1</title><link>https://example.com/1</link><pubDate>Wed, 10 Sep 2026 00:00:00 GMT</pubDate></item>
    <item><title>2</title><link>https://example.com/2</link><pubDate>Wed, 10 Sep 2026 00:00:00 GMT</pubDate></item>
    <item><title>3</title><link>https://example.com/3</link><pubDate>Wed, 10 Sep 2026 00:00:00 GMT</pubDate></item>
  </channel></rss>`;
  assert.equal(parseFeed(xml).length, 3);
});
