#!/usr/bin/env node
/**
 * セキュリティ版オーケストレータ。collect-security → curate-security → validate-citations(--type=security) を
 * 順に実行する。どこかで失敗（または時間超過）しても、既定では exit 0 で終わる（AIトレンド版本体の生成・公開を
 * 止めないため）。サイレント失敗にはせず、::warning:: アノテーションで理由を出す。失敗時は実行前の状態に復元する。
 * 仕組みは介護版（build-care.mjs）と共通（lib/orchestrate.mjs）。
 *
 * `--strict` を付けると失敗時に exit 1 を返す（セキュリティ版だけを再生成する場面向け）。
 * 復元自体が失敗した場合は、公開済みデータが欠損しうるため strict でなくても exit 1。
 * 全体の時間予算は TIME_BUDGET_MS。超過したら子プロセスを止めて復元する（共有の concurrency グループで
 * 後続の workflow を長時間塞がないため）。
 *
 * 使い方: GEMINI_ACCESS_TOKEN=... node scripts/build-security.mjs [YYYY-MM-DD] [--strict]
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { todayJst } from './lib/date.mjs';
import { runPipeline } from './lib/orchestrate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// 収集（本文取得を含む）＋記事生成（テーマ数×最大3回の再生成）＋検証の合計。実測前の暫定値
const TIME_BUDGET_MS = 8 * 60 * 1000;

export function securityPaths(dateArg) {
  return [
    join(ROOT, 'data', 'raw-security', `${dateArg}.json`),
    join(ROOT, 'site', 'src', 'content', 'security', `${dateArg}.md`),
  ];
}

async function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const dateArg = args.find((a) => !a.startsWith('--')) ?? todayJst();
  const failExitCode = strict ? 1 : 0;

  console.log(`セキュリティ版記事の生成を開始します（対象日: ${dateArg}）`);

  const script = (name) => join(ROOT, 'scripts', name);
  const skip = `本日のセキュリティ記事の更新はスキップします（対象日: ${dateArg}）。`;
  const result = await runPipeline({
    label: 'build-security',
    cwd: ROOT,
    paths: securityPaths(dateArg),
    backupPrefix: 'ai-notebot-security-backup-',
    timeoutMs: TIME_BUDGET_MS,
    steps: [
      { args: [script('collect-security.mjs'), dateArg], failMessage: `収集に失敗しました。${skip}` },
      { args: [script('curate-security.mjs'), dateArg], failMessage: `記事生成に失敗しました。${skip}` },
      { args: [script('validate-citations.mjs'), dateArg, '--type=security'], failMessage: `出典検証に失敗しました。${skip}` },
    ],
  });
  if (!result.ok) process.exit(result.restoreFailed ? 1 : failExitCode);

  console.log(`セキュリティ版記事の生成が完了しました（対象日: ${dateArg}）`);
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.warn(`::warning::[build-security] 予期しないエラーが発生しました: ${err.message}`);
    process.exit(process.argv.includes('--strict') ? 1 : 0);
  });
}
