#!/usr/bin/env node
// GitHub App の作成と、その秘密鍵の Cloud KMS インポートを一度きり行う（秘密情報は含まない）。
// Node 22+ 標準のみ。詳細: docs/adr/adr-2026-10-06-cloud-scheduler-dispatch.md
//
// 流れ:
//   1. 127.0.0.1 限定の受け口を立て、GitHub App マニフェスト方式で App を作成する
//      （ブラウザで「Create GitHub App」を押す。権限は actions:write のみ、非公開、Webhook 無効）
//   2. 変換 API の応答（PEM 秘密鍵）をメモリで受け、0600 の一時ファイルで KMS にインポートする。
//      秘密鍵は会話・画面・ログに出さない。インポート後に一時ファイルを上書き削除する。
//   3. KMS の公開鍵と PEM 由来の公開鍵が一致することを検証する
//   4. KMS 署名の JWT で GitHub を呼び、インストール（ai-notebot のみ）を待つ。
//      これは GitHub が KMS 署名を受け入れる実証にもなる。
//
//   node infra/scheduler/bootstrap-github-app.mjs            # 本番手順
//   node infra/scheduler/bootstrap-github-app.mjs --selftest # 使い捨て鍵でインポート経路だけ検証
//
// 前提: setup.sh kms 実行済み、openssl、gcloud。gcloud の自動ラッピングには pyca/cryptography が
// 必要（公式手順）。未導入なら venv に入れ、CLOUDSDK_PYTHON でその python を gcloud に使わせる:
//   python3 -m venv <dir> && <dir>/bin/pip install cryptography
//   CLOUDSDK_PYTHON=<dir>/bin/python CLOUDSDK_PYTHON_SITEPACKAGES=1 node infra/scheduler/bootstrap-github-app.mjs
import { randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, closeSync, fsyncSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULTS = {
  project: 'ai-notebot-yh',
  account: 'hy.unimail.11@gmail.com',
  location: 'asia-northeast1',
  keyring: 'github-app',
  key: 'github-app-signer',
  ownerRepo: 'yasushi-honda/ai-notebot',
  appName: 'ai-notebot-scheduler-yh',
  githubApi: 'https://api.github.com',
  githubWeb: 'https://github.com',
  importMethod: 'rsa-oaep-3072-sha256-aes-256',
  algorithm: 'rsa-sign-pkcs1-2048-sha256',
};

export function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 権限は actions:write のみ（metadata:read は GitHub が自動付与）。非公開・Webhook 無効・イベント購読なし。
export function buildManifest({ appName, ownerRepo, redirectUrl }) {
  return {
    name: appName,
    url: `https://github.com/${ownerRepo}`,
    redirect_url: redirectUrl,
    public: false,
    hook_attributes: { url: 'https://example.com/unused-webhook', active: false },
    default_permissions: { actions: 'write' },
    default_events: [],
  };
}

// `openssl rsa -noout -text` の出力から鍵長を読む。読めなければ null。
export function parseRsaBits(opensslText) {
  const m = /(?:Private-Key|RSA Private-Key):\s*\((\d+)\s*bit/i.exec(opensslText);
  return m ? Number(m[1]) : null;
}

// JWT の署名対象（RS256、有効9分）。iss は App ID（GitHub は整数を要求する。client ID の文字列は
// 'Issuer claim must be an Integer' で拒否されることを実機で確認した）。
export function buildSigningInput(appId, nowSec) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 540, iss: Number(appId) }));
  return `${header}.${payload}`;
}

// コールバックURLの検証。state 不一致や code 欠落は null。
export function parseCallback(urlString, expectedState) {
  const u = new URL(urlString, 'http://127.0.0.1');
  if (u.pathname !== '/callback') return null;
  const code = u.searchParams.get('code');
  if (!code || u.searchParams.get('state') !== expectedState) return null;
  return code;
}

// ローカル受け口は 127.0.0.1:<port> 宛のリクエストだけ受け付ける（DNS リバインディング対策。
// 悪意あるページから別ホスト名で到達されても state を含む応答を返さない）。
export function isAllowedHost(hostHeader, port) {
  return hostHeader === `127.0.0.1:${port}`;
}

function parseArgs(argv) {
  const opts = { ...DEFAULTS, selftest: false, open: true, port: 0, installTimeoutSec: 900 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--selftest') opts.selftest = true;
    else if (a === '--keep') opts.keep = true; // selftest の鍵バージョンを破棄せず残す（手動検証用）
    else if (a === '--no-open') opts.open = false;
    else if (a.startsWith('--') && a.slice(2) in DEFAULTS) opts[a.slice(2)] = argv[++i];
    else if (a === '--port') opts.port = Number(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

function run(cmd, args, { input, allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { input, encoding: 'buffer', env: { ...process.env, CLOUDSDK_PYTHON_SITEPACKAGES: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  if (r.status !== 0 && !allowFail) {
    // 引数・標準出力に秘密鍵は含まれない（鍵はファイル経由のみ）。stderr のみ表示する。
    throw new Error(`${cmd} ${args.slice(0, 4).join(' ')} failed (exit ${r.status}): ${r.stderr.toString().trim().slice(0, 600)}`);
  }
  return r;
}

function wipe(path) {
  try {
    const size = statSync(path).size;
    const fd = openSync(path, 'r+');
    writeSync(fd, Buffer.alloc(size));
    fsyncSync(fd);
    closeSync(fd);
    unlinkSync(path);
  } catch { /* 既に無ければ何もしない */ }
}

function makeGcloud(o) {
  const base = ['--project', o.project, '--account', o.account];
  return (args, opts) => run('gcloud', [...args, ...base], opts).stdout.toString();
}

function preflight(o, gcloud) {
  const py = process.env.CLOUDSDK_PYTHON || 'python3';
  if (run(py, ['-c', 'import cryptography'], { allowFail: true }).status !== 0) {
    throw new Error(`gcloud の自動ラッピングに必要な pyca/cryptography が ${py} に見つかりません。ファイル冒頭の手順で venv に導入し、CLOUDSDK_PYTHON を指定してください。`);
  }
  run('openssl', ['version']);
  const keyName = gcloud(['kms', 'keys', 'describe', o.key, '--keyring', o.keyring, '--location', o.location, '--format', 'value(name)']).trim();
  if (!keyName) throw new Error(`鍵 ${o.key} が見つかりません。先に bash infra/scheduler/setup.sh kms を実行してください。`);
}

// PEM（RSA 秘密鍵）を KMS にインポートし、公開鍵の一致を検証して、鍵バージョン名を返す。
function importPemToKms(o, gcloud, pemPath, workDir) {
  const bits = parseRsaBits(run('openssl', ['rsa', '-in', pemPath, '-noout', '-text']).stdout.toString());
  if (bits !== 2048) throw new Error(`想定外の鍵長: ${bits}（RSA 2048 のみ対応。algorithm=${o.algorithm}）`);

  const derPath = join(workDir, 'private.pk8.der');
  const expectedPubDer = run('openssl', ['rsa', '-in', pemPath, '-pubout', '-outform', 'DER']).stdout;
  run('openssl', ['pkcs8', '-topk8', '-nocrypt', '-inform', 'PEM', '-outform', 'DER', '-in', pemPath, '-out', derPath]);
  chmodSync(derPath, 0o600);

  const jobName = `github-app-import-${Date.now()}`;
  const loc = ['--location', o.location, '--keyring', o.keyring];
  gcloud(['kms', 'import-jobs', 'create', jobName, ...loc, '--import-method', o.importMethod, '--protection-level', 'software']);
  for (let i = 0; i < 60; i++) {
    const state = gcloud(['kms', 'import-jobs', 'describe', jobName, ...loc, '--format', 'value(state)']).trim();
    if (state === 'ACTIVE') break;
    if (i === 59) throw new Error(`import job が ACTIVE になりません（state=${state}）`);
    spawnSync('sleep', ['5']);
  }

  const before = new Set(gcloud(['kms', 'keys', 'versions', 'list', '--key', o.key, ...loc, '--format', 'value(name)']).split('\n').filter(Boolean));
  gcloud(['kms', 'keys', 'versions', 'import', '--import-job', jobName, '--key', o.key, ...loc, '--algorithm', o.algorithm, '--target-key-file', derPath]);
  const created = gcloud(['kms', 'keys', 'versions', 'list', '--key', o.key, ...loc, '--format', 'value(name)']).split('\n').filter((n) => n && !before.has(n));
  if (created.length !== 1) throw new Error(`インポートで作成された鍵バージョンを特定できません: ${created.join(',')}`);
  const version = created[0];
  const versionNum = version.split('/').pop();

  // 公開鍵の一致検証（インポートした鍵が元の秘密鍵と同一であることの証明）
  const pubPem = join(workDir, 'kms-public.pem');
  gcloud(['kms', 'keys', 'versions', 'get-public-key', versionNum, '--key', o.key, ...loc, '--output-file', pubPem]);
  const kmsPubDer = run('openssl', ['pkey', '-pubin', '-inform', 'PEM', '-outform', 'DER', '-in', pubPem]).stdout;
  if (!kmsPubDer.equals(expectedPubDer)) throw new Error('KMS の公開鍵が元の秘密鍵の公開鍵と一致しません');
  return { version, versionNum };
}

// KMS で JWT を署名する（asymmetric-sign は入力の SHA256 を KMS 側の鍵で署名する）
function signJwt(o, gcloud, versionNum, appId, workDir) {
  const input = buildSigningInput(appId, Math.floor(Date.now() / 1000));
  const inFile = join(workDir, 'jwt-input.txt');
  const sigFile = join(workDir, 'jwt.sig');
  writeFileSync(inFile, input);
  gcloud(['kms', 'asymmetric-sign', '--version', versionNum, '--key', o.key, '--keyring', o.keyring, '--location', o.location,
    '--digest-algorithm', 'sha256', '--input-file', inFile, '--signature-file', sigFile]);
  return `${input}.${base64url(readFileSync(sigFile))}`;
}

async function manifestFlow(o) {
  const state = randomBytes(16).toString('hex');
  let resolveCode, rejectCode;
  const codePromise = new Promise((res, rej) => { resolveCode = res; rejectCode = rej; });
  let manifestHtml = '';
  let port = 0;
  let handled = false; // コールバックは最初の1回だけ受け付ける
  const server = createServer((req, res) => {
    if (!isAllowedHost(req.headers.host, port)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('bad host');
      return;
    }
    if (req.url === '/' || req.url.startsWith('/?')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(manifestHtml);
      return;
    }
    const code = handled ? null : parseCallback(req.url, state);
    if (code) {
      handled = true;
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('GitHub App を作成しました。ターミナルに戻ってください。');
      resolveCode(code);
    } else {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('bad request');
    }
  });
  await new Promise((res) => server.listen(o.port, '127.0.0.1', res));
  port = server.address().port;
  const manifest = buildManifest({ appName: o.appName, ownerRepo: o.ownerRepo, redirectUrl: `http://127.0.0.1:${port}/callback` });
  const escaped = JSON.stringify(manifest).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  manifestHtml = `<!doctype html><meta charset="utf-8"><title>GitHub App を作成</title>
<form id="f" method="post" action="${o.githubWeb}/settings/apps/new?state=${state}">
<input type="hidden" name="manifest" value="${escaped}">
<p>GitHub の確認画面に進みます。<button type="submit">進む</button></p></form>
<script>document.getElementById('f').submit()</script>`;
  const url = `http://127.0.0.1:${port}/`;
  console.log(`\n【操作1】次の URL をブラウザ（yasushi-honda でログイン済み）で開き、GitHub の画面で「Create GitHub App」を押してください:\n  ${url}`);
  if (o.open) { try { execFileSync('open', [url]); } catch { /* 開けなくても URL を案内済み */ } }
  const timer = setTimeout(() => rejectCode(new Error('10分以内にApp作成が完了しませんでした')), 10 * 60 * 1000);
  try {
    const code = await codePromise;
    const r = await fetch(`${o.githubApi}/app-manifests/${code}/conversions`, {
      method: 'POST', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ai-notebot-bootstrap' },
    });
    if (r.status !== 201) throw new Error(`マニフェスト変換に失敗: HTTP ${r.status}`);
    const app = await r.json();
    // 想定したアカウントが所有する App であることを確認する（別アカウントで作られた App を取り込まない）
    const expectedOwner = o.ownerRepo.split('/')[0];
    if (app.owner?.login !== expectedOwner) {
      throw new Error(`App の所有者が想定と異なります（想定 ${expectedOwner}、実際 ${app.owner?.login ?? '不明'}）。ブラウザのログインアカウントを確認してください`);
    }
    return app;
  } finally {
    clearTimeout(timer);
    server.close();
  }
}

async function waitForInstallation(o, gcloud, versionNum, appId, workDir, slug) {
  console.log(`\n【操作2】次の URL で「Only select repositories」→ ${o.ownerRepo.split('/')[1]} のみを選び Install を押してください:\n  ${o.githubWeb}/apps/${slug}/installations/new`);
  if (o.open) { try { execFileSync('open', [`${o.githubWeb}/apps/${slug}/installations/new`]); } catch { /* 案内済み */ } }
  const deadline = Date.now() + o.installTimeoutSec * 1000;
  let jwt = signJwt(o, gcloud, versionNum, appId, workDir);
  let jwtAt = Date.now();
  while (Date.now() < deadline) {
    if (Date.now() - jwtAt > 8 * 60 * 1000) { jwt = signJwt(o, gcloud, versionNum, appId, workDir); jwtAt = Date.now(); }
    const r = await fetch(`${o.githubApi}/repos/${o.ownerRepo}/installation`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${jwt}`, 'User-Agent': 'ai-notebot-bootstrap', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (r.status === 200) return await r.json();
    if (r.status === 401) throw new Error('GitHub が KMS 署名の JWT を拒否しました（401）。鍵のインポートが不正の可能性があります');
    await new Promise((res) => setTimeout(res, 5000));
  }
  throw new Error('インストールを確認できませんでした（タイムアウト）');
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const gcloud = makeGcloud(o);
  preflight(o, gcloud);
  const workDir = mkdtempSync(join(tmpdir(), 'ghapp-'));
  chmodSync(workDir, 0o700);
  const pemPath = join(workDir, 'private.pem');
  try {
    if (o.selftest) {
      console.log('selftest: 使い捨て RSA 2048 鍵でインポート経路を検証します');
      run('openssl', ['genrsa', '-out', pemPath, '2048']);
      chmodSync(pemPath, 0o600);
      const { version, versionNum } = importPemToKms(o, gcloud, pemPath, workDir);
      const sig = signJwt(o, gcloud, versionNum, 1, workDir);
      console.log(`selftest OK: 公開鍵一致・KMS署名成功（JWT 長 ${sig.length}）`);
      if (o.keep) {
        console.log(`--keep 指定のため使い捨て鍵バージョンを残します（検証後に必ず破棄してください）: ${version}`);
      } else {
        console.log(`使い捨て鍵バージョンを破棄予約します: ${version}`);
        gcloud(['kms', 'keys', 'versions', 'destroy', versionNum, '--key', o.key, '--keyring', o.keyring, '--location', o.location]);
      }
      return;
    }
    const app = await manifestFlow(o);
    writeFileSync(pemPath, app.pem, { mode: 0o600 });
    app.pem = undefined; // メモリ上の参照も落とす
    const { version, versionNum } = importPemToKms(o, gcloud, pemPath, workDir);
    wipe(pemPath);
    const installation = await waitForInstallation(o, gcloud, versionNum, app.id, workDir, app.slug);
    if (installation.repository_selection !== 'selected') {
      throw new Error(`インストールが「選択したリポジトリのみ」ではありません（${installation.repository_selection}）。App の Install 設定を見直してください`);
    }
    console.log('\n完了（以下はいずれも非機密）:');
    console.log(`  App: ${app.slug}（App ID ${app.id}）`);
    console.log(`  installation ID: ${installation.id}（repository_selection=${installation.repository_selection}、permissions=${JSON.stringify(installation.permissions)}）`);
    console.log(`  KMS 鍵バージョン: ${version}`);
    console.log(`次の手順: GITHUB_APP_ID=${app.id} bash infra/scheduler/setup.sh deploy`);
  } finally {
    // 失敗時も含め、鍵素材を含む一時ファイルは必ず上書き削除する
    for (const f of readdirSync(workDir)) wipe(join(workDir, f));
    rmSync(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
}
