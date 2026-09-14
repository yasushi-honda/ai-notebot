/**
 * 「今日」の日付を JST（UTC+9）基準で YYYY-MM-DD 形式で返す。
 *
 * cron は 21:30 UTC（06:30 JST 相当）に起動するが、UTC でその瞬間の日付を取ると
 * JSTでは既に翌日になっているため常に1日ずれる（例: 2026-09-10 06:30 JST 実行時、
 * UTCはまだ 2026-09-09 21:30 であり、素朴に new Date().toISOString() すると
 * "2026-09-09" になってしまう。codex reviewで指摘・修正）。
 * 全スクリプトの「日付引数省略時のデフォルト」はこの関数に統一する。
 */
export function todayJst() {
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const jst = new Date(Date.now() + JST_OFFSET_MS);
  return jst.toISOString().slice(0, 10);
}

/**
 * 週刊まとめ（scripts/curate-weekly.mjs）の対象期間を計算する純関数。
 * publishDate（公開日、通常は日曜）の前日までの直近7日間を対象にする。
 * Date.UTC のみで日付演算を行うため月またぎ・年またぎ・うるう年でも壊れず、
 * publishDate 自体がどの曜日でも同じ規則（「前日から遡って7日」）で一貫して動く。
 *
 * @param {string} publishDate YYYY-MM-DD
 * @returns {{ weekStart: string, weekEnd: string, dates: string[] }}
 *   dates は weekStart から weekEnd まで古い順に7件（YYYY-MM-DD）
 */
export function weeklyWindow(publishDate) {
  const [y, m, d] = publishDate.split('-').map(Number);
  const publishUtc = Date.UTC(y, m - 1, d);
  const DAY_MS = 24 * 60 * 60 * 1000;

  const dates = [];
  for (let offset = 7; offset >= 1; offset--) {
    dates.push(new Date(publishUtc - offset * DAY_MS).toISOString().slice(0, 10));
  }

  return { weekStart: dates[0], weekEnd: dates[dates.length - 1], dates };
}

/**
 * dateStr（YYYY-MM-DD）が日曜日かどうかを判定する純関数。
 * weeklyWindow()自体は「publishDateがどの曜日でも同じ規則で動く」ことを意図的な仕様に
 * しているが、運用上は「週次まとめの対象週は日曜始まり」という前提（ADR・content.config.ts
 * のコメント・site上の「毎週日曜日に公開します」という利用者向け文言）を置いている。
 * workflow_dispatchでの手動実行時や検証目的の実行で日曜以外のpublishDateを渡すと、
 * weekStartが日曜以外になり週開始日の前提が静かに崩れる（実際にPR検証中、公開日引数に
 * 検証都合の当日（月曜）を渡した結果、週開始日が月曜になった生成物を作ってしまい
 * evaluatorレビューで指摘された）。curate-weekly.mjsのmain()がこの関数で警告を出す。
 *
 * @param {string} dateStr YYYY-MM-DD
 * @returns {boolean}
 */
export function isSunday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
}
