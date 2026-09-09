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
