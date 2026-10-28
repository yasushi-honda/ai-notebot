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
 * `--strict` を指定すると、失敗時に exit 0 ではなく exit 1 を返す。daily.yml（AIトレンド版と
 * 一括実行、介護版の失敗が本体の生成・公開を止めてはならない）は従来通り strict 無しで呼び出し、
 * care-rebuild.yml（介護版単体を再生成する workflow）は strict 付きで呼び出す。strict 無しのまま
 * だと、介護版単体の workflow で生成に失敗してもワークフロー自体は「成功」のままビルド・デプロイが
 * 続行され、記事が更新されていないのに成功したように見えてしまう（codex reviewで指摘・修正）。
 *
 * 使い方: GEMINI_ACCESS_TOKEN=... node scripts/build-care.mjs [YYYY-MM-DD] [--strict]
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { todayJst } from './lib/date.mjs';
import { snapshotPaths, runPipeline } from './lib/orchestrate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function carePaths(dateArg) {
  return {
    postPath: join(ROOT, 'site', 'src', 'content', 'care', `${dateArg}.md`),
    imagesDir: join(ROOT, 'site', 'public', 'images', 'care', dateArg),
    rawCarePath: join(ROOT, 'data', 'raw-care', `${dateArg}.json`),
  };
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
  const paths = carePaths(dateArg);
  const backup = await snapshotPaths(Object.values(paths), 'ai-notebot-care-backup-');
  return { ...paths, ...backup };
}

async function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const dateArg = args.find((a) => !a.startsWith('--')) ?? todayJst();
  const failExitCode = strict ? 1 : 0;

  console.log(`介護版記事の生成を開始します（対象日: ${dateArg}）`);

  const script = (name) => join(ROOT, 'scripts', name);
  const result = await runPipeline({
    label: 'build-care',
    cwd: ROOT,
    paths: Object.values(carePaths(dateArg)),
    backupPrefix: 'ai-notebot-care-backup-',
    steps: [
      { args: [script('collect-care.mjs'), dateArg], failMessage: `収集に失敗しました（対象日: ${dateArg}）。本日の介護記事の更新はスキップします。` },
      { args: [script('curate-care.mjs'), dateArg], failMessage: `記事生成に失敗しました（対象日: ${dateArg}）。本日の介護記事の更新はスキップします。` },
      { args: [script('validate-citations.mjs'), dateArg, '--type=care'], failMessage: `出典検証に失敗しました（対象日: ${dateArg}）。本日の介護記事の更新はスキップします。` },
    ],
  });
  // 復元に失敗した場合は公開済みデータが欠損しうるため、strict でなくても失敗にして本体の公開を止める
  if (!result.ok) process.exit(result.restoreFailed ? 1 : failExitCode);

  console.log(`介護版記事の生成が完了しました（対象日: ${dateArg}）`);
  process.exit(0);
}

// `node scripts/build-care.mjs` として直接実行された場合のみ main() を走らせる。
// 単体テストが snapshot() を import する際に、意図せず main()（実際のパイプライン実行を伴う）が
// 実行されないようにするため（curate.mjs 等の既存スクリプトと同じパターン）。
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.warn(`::warning::[build-care] 予期しないエラーが発生しました: ${err.message}`);
    process.exit(process.argv.includes('--strict') ? 1 : 0);
  });
}
