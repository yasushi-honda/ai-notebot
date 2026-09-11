#!/usr/bin/env node
/**
 * 介護版オーケストレータ。collect-care → curate-care → validate-citations(--type=care) を
 * 順に実行する。どこかで失敗しても常に exit 0 で終わる（AIトレンド版本体の生成・公開を
 * 止めないため）。ただしサイレント失敗にはせず、GitHub Actions の ::warning:: アノテーションで
 * 失敗理由を明示する。
 *
 * ゲート（validate-citations.mjs）を緩めるのではなく、「材料や品質が基準に届かない日は
 * 介護記事を出さない」でこの日をスキップする設計（docs/adr/ 参照）。
 *
 * 失敗時は生成途中のファイルを削除するのではなく、実行前の状態に復元する。同日中に
 * workflow_dispatch 等で複数回実行され、1回目が成功して記事が既にコミット済みの状態で
 * 2回目が失敗するケースがあり得るため、単純に削除すると既に公開済みの正しい記事まで
 * 失ってしまう（codex reviewで指摘・修正）。
 *
 * 使い方: GEMINI_ACCESS_TOKEN=... node scripts/build-care.mjs [YYYY-MM-DD]
 */

import { spawnSync } from 'node:child_process';
import { rm, cp, access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { todayJst } from './lib/date.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function warn(message) {
  console.warn(`::warning::[build-care] ${message}`);
}

function run(scriptName, args) {
  const scriptPath = join(ROOT, 'scripts', scriptName);
  const result = spawnSync('node', [scriptPath, ...args], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  });
  return result.status === 0;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 実行前の post/images/raw-care アーカイブの状態を一時ディレクトリへ退避し、復元用のハンドルを返す。
 * post/images だけでなく data/raw-care/<date>.json も必ず一緒に退避・復元する: 同日中に
 * workflow_dispatch 等で複数回実行され、1回目が成功して記事が既にコミット済みの状態で
 * 2回目の collect-care.mjs が data/raw-care/<date>.json を新しい内容で上書きした後に
 * curate-care.mjs や citation-gate が失敗した場合、post/images だけ復元して archive を
 * 新しいまま放置すると、復元された記事の脚注idが新しいarchiveのidと整合しなくなる
 * （post発行時の裏付けが失われる。codex reviewで指摘・修正）。3点は常に同じスナップショット
 * として一括で退避・復元する。
 */
export async function snapshot(dateArg) {
  const postPath = join(ROOT, 'site', 'src', 'content', 'care', `${dateArg}.md`);
  const imagesDir = join(ROOT, 'site', 'public', 'images', 'care', dateArg);
  const rawCarePath = join(ROOT, 'data', 'raw-care', `${dateArg}.json`);
  const backupRoot = await mkdtemp(join(tmpdir(), 'ai-notebot-care-backup-'));
  const backupPostPath = join(backupRoot, 'post.md');
  const backupImagesDir = join(backupRoot, 'images');
  const backupRawCarePath = join(backupRoot, 'raw-care.json');

  const hadPost = await exists(postPath);
  const hadImages = await exists(imagesDir);
  const hadRawCare = await exists(rawCarePath);
  if (hadPost) await cp(postPath, backupPostPath);
  if (hadImages) await cp(imagesDir, backupImagesDir, { recursive: true });
  if (hadRawCare) await cp(rawCarePath, backupRawCarePath);

  return {
    postPath,
    imagesDir,
    rawCarePath,
    /** 失敗時: 今回の実行で書かれた内容を破棄し、実行前の状態（無ければ「存在しない」状態）に戻す */
    async restore() {
      await rm(postPath, { force: true });
      await rm(imagesDir, { recursive: true, force: true });
      await rm(rawCarePath, { force: true });
      if (hadPost) await cp(backupPostPath, postPath);
      if (hadImages) await cp(backupImagesDir, imagesDir, { recursive: true });
      if (hadRawCare) await cp(backupRawCarePath, rawCarePath);
      await rm(backupRoot, { recursive: true, force: true });
    },
    /** 成功時: バックアップは不要になったので削除するだけ */
    async discard() {
      await rm(backupRoot, { recursive: true, force: true });
    },
  };
}

async function main() {
  const dateArg = process.argv[2] ?? todayJst();

  console.log(`介護版記事の生成を開始します（対象日: ${dateArg}）`);

  const backup = await snapshot(dateArg);

  if (!run('collect-care.mjs', [dateArg])) {
    warn(`収集に失敗しました（対象日: ${dateArg}）。本日の介護記事の更新はスキップします。`);
    await backup.restore();
    process.exit(0);
  }

  if (!run('curate-care.mjs', [dateArg])) {
    warn(`記事生成に失敗しました（対象日: ${dateArg}）。本日の介護記事の更新はスキップします。`);
    await backup.restore();
    process.exit(0);
  }

  if (!run('validate-citations.mjs', [dateArg, '--type=care'])) {
    warn(`出典検証に失敗しました（対象日: ${dateArg}）。本日の介護記事の更新はスキップします。`);
    await backup.restore();
    process.exit(0);
  }

  await backup.discard();
  console.log(`介護版記事の生成が完了しました（対象日: ${dateArg}）`);
  process.exit(0);
}

// `node scripts/build-care.mjs` として直接実行された場合のみ main() を走らせる。
// 単体テストが snapshot() を import する際に、意図せず main()（実際のパイプライン実行を伴う）が
// 実行されないようにするため（curate.mjs 等の既存スクリプトと同じパターン）。
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(async (err) => {
    warn(`予期しないエラーが発生しました: ${err.message}`);
    process.exit(0);
  });
}
