import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --check-install が、ポーリングが複数回回ってもブラウザ（open）を一度も開かないことを検証する回帰テスト。
// 偽の GitHub API・偽の gcloud・偽の open を使い、実際の GCP/GitHub には触れない。
test('--check-install: 「all」から「selected」に直るまで待ち、open を一度も呼ばない', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chk-'));
  const bin = join(dir, 'bin');
  const openLog = join(dir, 'open.log');
  try {
    // 偽 gcloud: --signature-file に適当な署名を書く。偽 open: 呼ばれたら記録する
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'gcloud'), '#!/usr/bin/env bash\nwhile [ $# -gt 0 ]; do if [ "$1" = "--signature-file" ]; then printf sig > "$2"; fi; shift; done\n');
    writeFileSync(join(bin, 'open'), `#!/usr/bin/env bash\necho "$@" >> "${openLog}"\n`);
    chmodSync(join(bin, 'gcloud'), 0o755);
    chmodSync(join(bin, 'open'), 0o755);

    let hits = 0;
    const server = createServer((req, res) => {
      if (req.url === '/repos/o/r/installation') {
        hits += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // 最初の3回は all、4回目から selected
        res.end(JSON.stringify({ id: 42, repository_selection: hits <= 3 ? 'all' : 'selected', permissions: { actions: 'write' } }));
      } else if (req.url === '/app') {
        // スラッグが取れると、案内とブラウザ起動が走りうる（過去のバグの再現条件）
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ slug: 'fake-app' }));
      } else {
        res.writeHead(404);
        res.end('{}');
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    const args = ['infra/scheduler/bootstrap-github-app.mjs', '--check-install', '--app-id', '1', '--ownerRepo', 'o/r',
      '--kms-key-version', 'projects/p/locations/l/keyRings/k/cryptoKeys/c/cryptoKeyVersions/1',
      '--githubApi', `http://127.0.0.1:${port}`, '--poll-ms', '20'];
    const child = spawn('node', args, { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const code = await new Promise((r) => child.on('close', r));
    server.close();

    assert.equal(code, 0, out);
    assert.match(out, /OK: installation ID 42/);
    assert.ok(hits >= 4, `all のあいだポーリングが続くこと（hits=${hits}）`);
    assert.equal((out.match(/選択したリポジトリのみ.*ではありません/g) ?? []).length, 1, '警告は1回だけ');
    assert.equal(existsSync(openLog), false, `open は呼ばれないこと: ${existsSync(openLog) ? readFileSync(openLog, 'utf8') : ''}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
