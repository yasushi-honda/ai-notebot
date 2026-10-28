/**
 * 「別枠の版（介護版・セキュリティ版）の生成が失敗しても、AIトレンド版本体の生成・公開を止めない」
 * ためのオーケストレーション共通部品。build-care.mjs / build-security.mjs が使う。
 *
 * 失敗時は生成途中のファイルを削除するのではなく、実行前の状態に復元する（同日中に複数回実行され、
 * 1回目が成功して記事が既にコミット済みの状態で2回目が失敗しても、公開済みの記事を失わない）。
 * 復元の対象は、記事・画像・収集アーカイブなど一組のパスを必ず同じスナップショットとして扱う
 * （記事だけ復元してアーカイブが新しいままだと、脚注 id と整合しなくなる）。
 */

import { spawnSync } from 'node:child_process';
import { rm, cp, access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 指定したファイル/ディレクトリの現状を一時ディレクトリへ退避し、復元用のハンドルを返す。
 * @param {string[]} paths 退避対象（ファイルまたはディレクトリの絶対パス。存在しなくてもよい）
 * @param {string} [backupPrefix] 一時ディレクトリ名の接頭辞
 */
export async function snapshotPaths(paths, backupPrefix = 'ai-notebot-backup-') {
  const backupRoot = await mkdtemp(join(tmpdir(), backupPrefix));
  const entries = [];
  try {
    for (const [i, path] of paths.entries()) {
      const backupPath = join(backupRoot, String(i));
      const had = await exists(path);
      if (had) await cp(path, backupPath, { recursive: true });
      entries.push({ path, backupPath, had });
    }
  } catch (err) {
    // この時点ではまだ何も変更していない。退避の途中失敗で一時ディレクトリを残さない
    await rm(backupRoot, { recursive: true, force: true });
    throw err;
  }

  return {
    /** 退避先。restore が失敗したとき、運用者が手で戻せるようログに出す */
    backupRoot,
    /**
     * 失敗時: 今回の実行で書かれた内容を破棄し、実行前の状態（無ければ「存在しない」状態）に戻す。
     * 復元の途中で失敗した場合は退避先を消さずに例外を投げる（退避先が唯一の正本になるため）。
     */
    async restore() {
      for (const e of entries) await rm(e.path, { recursive: true, force: true });
      for (const e of entries) if (e.had) await cp(e.backupPath, e.path, { recursive: true });
      await rm(backupRoot, { recursive: true, force: true });
    },
    /** 成功時: バックアップは不要になったので削除するだけ */
    async discard() {
      await rm(backupRoot, { recursive: true, force: true });
    },
  };
}

/**
 * @typedef {object} Step
 * @property {string[]} args node に渡す引数（先頭はスクリプトの絶対パス）
 * @property {string} failMessage 失敗時に ::warning:: で出す理由
 */

/**
 * ステップ（子プロセス）を順に実行し、1つでも失敗（または時間超過）したら復元して { ok: false } を返す。
 * 予期しない例外が起きた場合も復元する（スナップショット取得後の例外で、書きかけのファイルを残さない）。
 * 復元は1回だけ行い、復元自体が失敗したら { ok: false, restoreFailed: true } を返す
 * （公開済みの記事・アーカイブが欠損している可能性があるため、呼び出し側は strict でなくても失敗にすること）。
 * プロセスを終了させるのは呼び出し側（exitCode を使う）。
 *
 * @param {object} opts
 * @param {string} opts.label ログ・警告に出す版の名前（例: 'build-care'）
 * @param {Step[]} opts.steps
 * @param {string[]} opts.paths 復元対象のパス
 * @param {string} opts.cwd
 * @param {number} [opts.timeoutMs] 全ステップ合計の時間予算（未指定なら無制限）。超過したステップは止めて失敗扱い
 * @param {string} [opts.backupPrefix]
 * @param {Function} [opts.spawn] テスト用に差し替え可能（既定は spawnSync）
 * @returns {Promise<{ok: boolean, restoreFailed?: boolean}>}
 */
export async function runPipeline({ label, steps, paths, cwd, timeoutMs, backupPrefix, spawn = spawnSync }) {
  const warn = (message) => console.warn(`::warning::[${label}] ${message}`);
  const deadline = timeoutMs ? Date.now() + timeoutMs : null;
  const backup = await snapshotPaths(paths, backupPrefix);

  let failure = null;
  try {
    for (const step of steps) {
      const remaining = deadline ? deadline - Date.now() : undefined;
      if (deadline && remaining <= 0) {
        failure = `時間予算（${Math.round(timeoutMs / 1000)}秒）を使い切りました。${step.failMessage}`;
        break;
      }
      const result = spawn('node', step.args, {
        cwd,
        env: process.env,
        stdio: 'inherit',
        ...(remaining ? { timeout: remaining, killSignal: 'SIGKILL' } : {}),
      });
      if (result.status !== 0) {
        if (result.error?.code === 'ETIMEDOUT') {
          failure = `時間予算を超過したため中断しました。${step.failMessage}`;
        } else if (result.status === null) {
          // シグナル終了（OOM kill 等）や起動失敗。終了コードが無いので原因を添える
          failure = `${step.failMessage}（${result.signal ?? result.error?.message ?? '原因不明'}）`;
        } else {
          failure = step.failMessage;
        }
        break;
      }
    }
  } catch (err) {
    failure = `予期しないエラーが発生しました: ${err.message}`;
  }

  if (failure === null) {
    try {
      await backup.discard();
    } catch (err) {
      // 生成・検証は成功済み。退避先の掃除の失敗で成功を失敗扱いにしない
      warn(`バックアップの削除に失敗しました（成功扱いで続行）: ${err.message}`);
    }
    return { ok: true };
  }

  warn(failure);
  try {
    await backup.restore();
  } catch (err) {
    warn(
      `復元に失敗しました: ${err.message}。公開済みの記事・アーカイブが欠損している可能性があります。` +
        `実行前の内容は ${backup.backupRoot} に残っています`,
    );
    return { ok: false, restoreFailed: true };
  }
  return { ok: false };
}
