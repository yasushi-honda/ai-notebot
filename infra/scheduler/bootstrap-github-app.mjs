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
//   node infra/scheduler/bootstrap-github-app.mjs --pem-file <PEM> --app-id <ID>
//       # 既存の App の秘密鍵を KMS に取り込む（鍵のローテーション、または途中失敗からの復旧）。
//       # GitHub の App 設定画面で「Generate a private key」した PEM を渡す。成功後、その PEM は上書き削除する。
//
// 前提: setup.sh kms 実行済み、openssl、gcloud。gcloud の自動ラッピングには pyca/cryptography が
// 必要（公式手順）。未導入なら venv に入れ、CLOUDSDK_PYTHON でその python を gcloud に使わせる:
//   python3 -m venv <dir> && <dir>/bin/pip install cryptography
//   CLOUDSDK_PYTHON=<dir>/bin/python CLOUDSDK_PYTHON_SITEPACKAGES=1 node infra/scheduler/bootstrap-github-app.mjs
import { randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, closeSync, existsSync, fsyncSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
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

export function parseArgs(argv) {
  const opts = { ...DEFAULTS, selftest: false, keep: false, open: true, port: 0, installTimeoutSec: 900, pemFile: null, appId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--selftest') opts.selftest = true;
    else if (a === '--keep') opts.keep = true; // selftest の鍵バージョンを破棄せず残す（手動検証用）
    else if (a === '--no-open') opts.open = false;
    else if (a === '--pem-file') opts.pemFile = argv[++i];
    else if (a === '--app-id') opts.appId = argv[++i];
    else if (a.startsWith('--') && a.slice(2) in DEFAULTS) opts[a.slice(2)] = argv[++i];
    else if (a === '--port') opts.port = Number(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (opts.pemFile && opts.selftest) throw new Error('--pem-file と --selftest は同時に指定できません');
  if (opts.pemFile && !/^[0-9]+$/.test(opts.appId ?? '')) throw new Error('--pem-file には整数の --app-id が必要です');
  if (!opts.pemFile && opts.appId) throw new Error('--app-id は --pem-file と一緒に指定してください');
  return opts;
}

function run(cmd, args, { input, allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { input, encoding: 'buffer', env: { ...process.env, CLOUDSDK_PYTHON_SITEPACKAGES: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  if ((r.status !== 0 || r.error) && !allowFail) {
    // 引数・標準出力に秘密鍵は含まれない（鍵はファイル経由のみ）。stderr のみ表示する。
    const why = r.error ? `${r.error.code ?? r.error.message}（${cmd} を実行できません）` : `exit ${r.status}`;
    throw new Error(`${cmd} ${args.slice(0, 4).join(' ')} failed (${why}): ${r.stderr?.toString().trim().slice(0, 600) ?? ''}`);
  }
  return r;
}

// 平文の鍵素材を上書きして削除する。APFS/SSD では上書きしても旧ブロックが残りうるため、実効的なのは
// 「平文ファイルを残さない・早く消す」こと。上書きできなかった場合は黙らず警告する。
function wipe(path) {
  try {
    const size = statSync(path).size;
    const fd = openSync(path, 'r+');
    writeSync(fd, Buffer.alloc(size));
    fsyncSync(fd);
    closeSync(fd);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`警告: ${path} を上書きできませんでした（${e.code ?? e.message}）。削除のみ行います`);
  }
  try { unlinkSync(path); } catch (e) { if (e.code !== 'ENOENT') console.error(`警告: ${path} を削除できませんでした（${e.code ?? e.message}）。手動で削除してください`); }
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

// インポートジョブを作り ACTIVE まで待つ。不可逆な App 作成より前に呼び、権限・環境の問題を先に露呈させる。
function createImportJob(o, gcloud) {
  const jobName = `github-app-import-${Date.now()}`;
  const loc = ['--location', o.location, '--keyring', o.keyring];
  gcloud(['kms', 'import-jobs', 'create', jobName, ...loc, '--import-method', o.importMethod, '--protection-level', 'software']);
  for (let i = 0; i < 60; i++) {
    const state = gcloud(['kms', 'import-jobs', 'describe', jobName, ...loc, '--format', 'value(state)']).trim();
    if (state === 'ACTIVE') return jobName;
    if (i === 59) throw new Error(`import job が ACTIVE になりません（state=${state}）`);
    spawnSync('sleep', ['5']);
  }
}

// PEM（RSA 秘密鍵）を KMS にインポートし、公開鍵の一致を検証して、鍵バージョン名を返す。
// 平文の DER はインポート直後（失敗時も）に消す。検証に失敗した鍵バージョンは破棄予約する
// （ENABLED のまま残ると deploy が誤って選びうるため）。
function importPemToKms(o, gcloud, pemPath, workDir, jobName) {
  const bits = parseRsaBits(run('openssl', ['rsa', '-in', pemPath, '-noout', '-text']).stdout.toString());
  if (bits !== 2048) throw new Error(`想定外の鍵長: ${bits}（RSA 2048 のみ対応。algorithm=${o.algorithm}）`);

  const derPath = join(workDir, 'private.pk8.der');
  const loc = ['--location', o.location, '--keyring', o.keyring];
  const expectedPubDer = run('openssl', ['rsa', '-in', pemPath, '-pubout', '-outform', 'DER']).stdout;
  const listVersions = () => new Set(gcloud(['kms', 'keys', 'versions', 'list', '--key', o.key, ...loc, '--format', 'value(name)']).split('\n').filter(Boolean));
  const before = listVersions();
  try {
    run('openssl', ['pkcs8', '-topk8', '-nocrypt', '-inform', 'PEM', '-outform', 'DER', '-in', pemPath, '-out', derPath]);
    chmodSync(derPath, 0o600);
    gcloud(['kms', 'keys', 'versions', 'import', '--import-job', jobName, '--key', o.key, ...loc, '--algorithm', o.algorithm, '--target-key-file', derPath]);
  } finally {
    wipe(derPath);
  }
  const created = [...listVersions()].filter((n) => !before.has(n));
  if (created.length !== 1) throw new Error(`インポートで作成された鍵バージョンを特定できません（並行操作の可能性）: ${created.join(',') || 'なし'}。KMS の鍵バージョンを確認してください`);
  const version = created[0];
  const versionNum = version.split('/').pop();
  const destroy = () => {
    try { gcloud(['kms', 'keys', 'versions', 'destroy', versionNum, '--key', o.key, ...loc]); console.error(`検証に失敗した鍵バージョンを破棄予約しました: ${version}`); }
    catch (e) { console.error(`警告: 鍵バージョン ${version} を破棄予約できませんでした。手動で破棄してください（${e.message}）`); }
  };

  // 公開鍵の一致検証（インポートした鍵が元の秘密鍵と同一であることの証明）
  try {
    const pubPem = join(workDir, 'kms-public.pem');
    gcloud(['kms', 'keys', 'versions', 'get-public-key', versionNum, '--key', o.key, ...loc, '--output-file', pubPem]);
    const kmsPubDer = run('openssl', ['pkey', '-pubin', '-inform', 'PEM', '-outform', 'DER', '-in', pubPem]).stdout;
    if (!kmsPubDer.equals(expectedPubDer)) throw new Error('KMS の公開鍵が元の秘密鍵の公開鍵と一致しません');
  } catch (e) {
    destroy();
    throw e;
  }
  return { version, versionNum, destroy };
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
  console.log(`\n【操作1】次の URL をブラウザ（${o.ownerRepo.split('/')[0]} でログイン済み）で開き、GitHub の画面で「Create GitHub App」を押してください:\n  ${url}`);
  if (o.open) { try { execFileSync('open', [url]); } catch { /* 開けなくても URL を案内済み */ } }
  const timer = setTimeout(() => rejectCode(new Error('10分以内にApp作成が完了しませんでした')), 10 * 60 * 1000);
  try {
    const code = await codePromise;
    const r = await fetch(`${o.githubApi}/app-manifests/${code}/conversions`, {
      method: 'POST', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ai-notebot-bootstrap' },
    });
    if (r.status !== 201) throw new Error(`マニフェスト変換に失敗: HTTP ${r.status}`);
    const app = await r.json();
    // App は作成済み（不可逆）。以降の失敗で孤児にならないよう、識別情報と復旧手順を先に出す。
    console.log(`\nApp を作成しました: ${app.slug}（App ID ${app.id}、owner ${app.owner?.login ?? '不明'}）`);
    console.log(`  以降の処理が失敗した場合: GitHub の Settings → Developer settings → GitHub Apps → ${app.slug} で、`);
    console.log(`  「Generate a private key」した PEM を使って --pem-file <PEM> --app-id ${app.id} で再開するか、App を削除して最初からやり直してください`);
    // 想定したアカウントが所有する App であることを確認する（別アカウントで作られた App を取り込まない）
    const expectedOwner = o.ownerRepo.split('/')[0];
    if (app.owner?.login !== expectedOwner) {
      throw new Error(`App の所有者が想定と異なります（想定 ${expectedOwner}、実際 ${app.owner?.login ?? '不明'}）。ブラウザのログインアカウントを確認し、作成された App ${app.slug} は GitHub の設定で削除してください`);
    }
    return app;
  } finally {
    clearTimeout(timer);
    server.close();
  }
}

// App のインストール（対象リポジトリ）を、KMS 署名の JWT で確認する。
// 200 が返れば、GitHub が KMS 署名を受け入れたことの実証にもなる。
async function waitForInstallation(o, gcloud, versionNum, appId, workDir, slug) {
  const deadline = Date.now() + o.installTimeoutSec * 1000;
  let jwt = signJwt(o, gcloud, versionNum, appId, workDir);
  let jwtAt = Date.now();
  let last = '応答なし';
  const ghHeaders = () => ({ Accept: 'application/vnd.github+json', Authorization: `Bearer ${jwt}`, 'User-Agent': 'ai-notebot-bootstrap', 'X-GitHub-Api-Version': '2022-11-28' });
  if (!slug) {
    // --pem-file モードではスラッグが分からないため、GET /app（JWT 認証）で取得する
    try { const r = await fetch(`${o.githubApi}/app`, { headers: ghHeaders() }); if (r.ok) slug = (await r.json()).slug; } catch { /* 取れなければ案内を省く */ }
  }
  if (slug) {
    const installUrl = `${o.githubWeb}/apps/${slug}/installations/new`;
    console.log(`\n【操作2】次の URL で「Only select repositories」→ ${o.ownerRepo.split('/')[1]} のみを選び Install を押してください（済みなら不要）:\n  ${installUrl}`);
    if (o.open) { try { execFileSync('open', [installUrl]); } catch { /* 案内済み */ } }
  }
  while (Date.now() < deadline) {
    if (Date.now() - jwtAt > 8 * 60 * 1000) { jwt = signJwt(o, gcloud, versionNum, appId, workDir); jwtAt = Date.now(); }
    try {
      const r = await fetch(`${o.githubApi}/repos/${o.ownerRepo}/installation`, { headers: ghHeaders() });
      if (r.status === 200) return await r.json();
      last = `HTTP ${r.status}`;
      // 404 は未インストール（待機を続ける）。401 は App 作成直後の伝播遅延でも起きうるため、
      // 連続して拒否され続けたときだけ失敗とする。
      if (r.status === 401 && Date.now() - jwtAt > 90 * 1000) {
        throw Object.assign(new Error('GitHub が KMS 署名の JWT を拒否し続けています（401）。鍵のインポートまたは App ID が不正の可能性があります'), { kmsRejected: true });
      }
    } catch (e) {
      if (e.kmsRejected) throw e;
      last = `通信エラー（${e.cause?.code ?? e.message}）`; // 一時的なネットワーク障害は待機を続ける
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
  throw new Error(`インストールを確認できませんでした（タイムアウト。最後の状態: ${last}）`);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const gcloud = makeGcloud(o);
  preflight(o, gcloud);
  const workDir = mkdtempSync(join(tmpdir(), 'ghapp-'));
  chmodSync(workDir, 0o700);
  const pemPath = join(workDir, 'private.pem');
  // 失敗・中断（Ctrl-C 等）のいずれでも、鍵素材を含む一時ファイルは上書き削除する
  const cleanup = () => {
    try { for (const f of readdirSync(workDir)) wipe(join(workDir, f)); rmSync(workDir, { recursive: true, force: true }); } catch { /* 既に無い */ }
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(130); });
  try {
    if (o.selftest) {
      console.log('selftest: 使い捨て RSA 2048 鍵でインポート経路を検証します');
      run('openssl', ['genrsa', '-out', pemPath, '2048']);
      chmodSync(pemPath, 0o600);
      const jobName = createImportJob(o, gcloud);
      const { version, versionNum, destroy } = importPemToKms(o, gcloud, pemPath, workDir, jobName);
      let sig;
      try { sig = signJwt(o, gcloud, versionNum, 1, workDir); } catch (e) { destroy(); throw e; }
      console.log(`selftest OK: 公開鍵一致・KMS署名成功（JWT 長 ${sig.length}）`);
      if (o.keep) {
        console.log(`--keep 指定のため使い捨て鍵バージョンを残します（検証後に必ず破棄してください）: ${version}`);
      } else {
        console.log(`使い捨て鍵バージョンを破棄予約します: ${version}`);
        gcloud(['kms', 'keys', 'versions', 'destroy', versionNum, '--key', o.key, '--keyring', o.keyring, '--location', o.location]);
      }
      return;
    }

    let appId, slug = null, version, versionNum, destroy;
    // 不可逆な App 作成より前にインポートジョブを用意し、KMS 側の問題を先に露呈させる
    const jobName = createImportJob(o, gcloud);
    if (o.pemFile) {
      // 既存 App の鍵の取り込み（ローテーション・復旧）。元の PEM はインポート成功後に上書き削除する。
      appId = o.appId;
      ({ version, versionNum, destroy } = importPemToKms(o, gcloud, o.pemFile, workDir, jobName));
      wipe(o.pemFile);
      console.log(`取り込み元の PEM を上書き削除しました: ${o.pemFile}`);
    } else {
      const app = await manifestFlow(o);
      writeFileSync(pemPath, app.pem, { mode: 0o600 });
      app.pem = undefined; // メモリ上の参照も落とす
      appId = String(app.id);
      slug = app.slug;
      ({ version, versionNum, destroy } = importPemToKms(o, gcloud, pemPath, workDir, jobName));
      wipe(pemPath);
    }
    // 途中で失敗しても鍵バージョンが分かるよう、インポート直後に表示する
    console.log(`KMS にインポートしました: ${version}`);
    let installation;
    try {
      installation = await waitForInstallation(o, gcloud, versionNum, appId, workDir, slug);
    } catch (e) {
      // GitHub が KMS 署名を拒否した鍵は使えない。ENABLED のまま残ると deploy が誤って選びうるため破棄予約する。
      if (e.kmsRejected) destroy();
      else console.error(`この鍵バージョンはインポート済みで公開鍵の一致も検証済みです（${version}）。インストール後に --pem-file なしで確認し直すか、必要なら手動で無効化してください`);
      throw e;
    }
    if (installation.repository_selection !== 'selected') {
      throw new Error(`インストールが「選択したリポジトリのみ」ではありません（${installation.repository_selection}）。App の Install 設定を見直してください`);
    }
    console.log('\n完了（以下はいずれも非機密）:');
    console.log(`  App ID: ${appId}${slug ? `（${slug}）` : ''}`);
    console.log(`  installation ID: ${installation.id}（repository_selection=${installation.repository_selection}、permissions=${JSON.stringify(installation.permissions)}）`);
    console.log(`  KMS 鍵バージョン: ${version}`);
    console.log(`次の手順: GITHUB_APP_ID=${appId} KMS_KEY_VERSION=${version} bash infra/scheduler/setup.sh deploy`);
  } finally {
    cleanup();
    // --pem-file の取り込み元（ユーザーがダウンロードした PEM）は、インポートに失敗すると消えずに残る
    if (o.pemFile && existsSync(o.pemFile)) {
      console.error(`注意: 取り込み元の PEM が残っています: ${o.pemFile}\n  秘密鍵そのものです。原因を直して再実行するか、不要なら安全に削除してください（削除の責任はあなたにあります）。`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
}
