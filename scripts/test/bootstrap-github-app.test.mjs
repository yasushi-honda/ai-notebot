import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync, sign } from 'node:crypto';
import {
  base64url,
  buildManifest,
  buildSigningInput,
  parseCallback,
  parseRsaBits,
} from '../../infra/scheduler/bootstrap-github-app.mjs';

test('base64url: + / を置換し padding を付けない', () => {
  // 0xfb 0xff 0xfe は標準 base64 で "+//+"、padding なしの境界（1〜3バイト）も確認する
  assert.equal(base64url(Buffer.from([0xfb, 0xff, 0xfe])), '-__-');
  assert.equal(base64url(Buffer.from([0x01])), 'AQ');
  assert.equal(base64url(Buffer.from([0x01, 0x02])), 'AQI');
  assert.equal(base64url(Buffer.from([0x01, 0x02, 0x03])), 'AQID');
  assert.equal(base64url(Buffer.alloc(0)), '');
});

test('buildManifest: 権限は actions:write のみ・非公開・Webhook無効・イベント購読なし', () => {
  const m = buildManifest({ appName: 'x', ownerRepo: 'o/r', redirectUrl: 'http://127.0.0.1:1234/callback' });
  assert.deepEqual(m.default_permissions, { actions: 'write' });
  assert.equal(m.public, false);
  assert.equal(m.hook_attributes.active, false);
  assert.deepEqual(m.default_events, []);
  assert.equal(m.redirect_url, 'http://127.0.0.1:1234/callback');
  assert.equal(m.url, 'https://github.com/o/r');
});

test('parseRsaBits: 鍵長を読み取る。読めなければ null', () => {
  assert.equal(parseRsaBits('Private-Key: (2048 bit, 2 primes)\nmodulus:'), 2048);
  assert.equal(parseRsaBits('RSA Private-Key: (3072 bit, 2 primes)'), 3072);
  assert.equal(parseRsaBits('Private-Key: (4096 bit'), 4096);
  assert.equal(parseRsaBits(''), null);
  assert.equal(parseRsaBits('unable to load Private Key'), null);
});

test('buildSigningInput: RS256・iss は整数のApp ID・exp は10分以内でiatは過去', () => {
  const now = 1_800_000_000;
  const input = buildSigningInput(1234567, now);
  const [h, p, extra] = input.split('.');
  assert.equal(extra, undefined);
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });
  assert.strictEqual(payload.iss, 1234567, 'GitHub は iss に整数を要求する');
  // 文字列で渡された数値（env / CLI 由来）も整数に正規化する
  assert.strictEqual(JSON.parse(Buffer.from(buildSigningInput('42', now).split('.')[1], 'base64url').toString()).iss, 42);
  assert.ok(payload.iat < now, 'clock drift 対策で iat は過去');
  assert.ok(payload.exp - now <= 600, 'GitHub の上限は10分');
  assert.ok(payload.exp > now);
  assert.doesNotMatch(input, /[+/=]/, 'base64url であること');
});

test('buildSigningInput + base64url: 標準の RS256 検証器で署名検証できる JWT になる', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const input = buildSigningInput(1234567, 1_800_000_000);
  const sig = base64url(sign('sha256', Buffer.from(input), privateKey));
  const jwt = `${input}.${sig}`;
  const [h, p, s] = jwt.split('.');
  const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url'));
  assert.equal(ok, true);
  // 署名対象が1文字でも違えば検証に失敗する（検証器が実際に効いていることの確認）
  const tampered = createVerify('RSA-SHA256').update(`${h}.${p}x`).verify(publicKey, Buffer.from(s, 'base64url'));
  assert.equal(tampered, false);
});

test('parseCallback: state 一致かつ code ありのときだけ code を返す', () => {
  assert.equal(parseCallback('/callback?code=abc&state=s1', 's1'), 'abc');
  assert.equal(parseCallback('/callback?code=abc&state=other', 's1'), null, 'state 不一致');
  assert.equal(parseCallback('/callback?state=s1', 's1'), null, 'code 欠落');
  assert.equal(parseCallback('/callback?code=&state=s1', 's1'), null, 'code 空');
  assert.equal(parseCallback('/other?code=abc&state=s1', 's1'), null, 'パス違い');
  assert.equal(parseCallback('/', 's1'), null);
});
