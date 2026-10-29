/**
 * 収集した候補のうち、要約が短い（または空の）ものについて、元ページの本文を取得して要約を補う。
 * JPCERT/JVN/IPA/ScanNetSecurity の RSS は要約が短いか空で、そのままでは Stage B の材料が足りず、
 * 出典にない一般論で埋めてしまう（PR #67 の監査で確認した水増しの原因の一つ）ため。
 *
 * - 対象は Stage A が見る先頭 targetCount 件のうち、要約が minSummaryLength 未満のもの。件数・同時実行数に上限を付ける。
 * - 取得に失敗した項目は元の要約のまま残す（その項目は「ニュース要約だけ」の材料として扱われる）。
 * - 取得にはリダイレクト先の SSRF 検査つきの resolveSource を使う（呼び出し側が resolve として渡す）。
 */

/**
 * @param {Array<{url: string, summary: string}>} items 日付降順の候補
 * @param {object} opts
 * @param {(url: string) => Promise<{ok: boolean, excerpt?: string}>} opts.resolve
 * @param {number} [opts.targetCount] 先頭から何件を対象にするか（Stage A の候補数に合わせる）
 * @param {number} [opts.minSummaryLength] これ未満の要約を補う
 * @param {number} [opts.maxFetches] 取得する件数の上限
 * @param {number} [opts.concurrency] 同時取得数
 * @returns {Promise<{items: Array, attempted: number, enriched: number, failures: Record<string, number>}>}
 *   failures は失敗の理由ごとの件数（HTTP ステータス・本文なし・例外など）。運用者が原因を見分けられるようにする
 */
export async function enrichSummaries(
  items,
  { resolve, targetCount = 60, minSummaryLength = 150, maxFetches = 30, concurrency = 5 },
) {
  const targets = items
    .slice(0, targetCount)
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => (item.summary ?? '').length < minSummaryLength)
    .slice(0, maxFetches);

  const result = items.map((item) => ({ ...item }));
  let enriched = 0;
  let cursor = 0;
  const failures = {};
  // 理由に URL や詳細が混ざると集計がばらけるため、URL と括弧書きを落として種類ごとにまとめる
  const fail = (reason) => {
    const key = String(reason).replace(/https?:\/\/\S+/g, '').split('（')[0].replace(/[:：\s]+$/, '').trim() || '取得失敗';
    failures[key] = (failures[key] ?? 0) + 1;
  };

  async function worker() {
    while (cursor < targets.length) {
      const { item, index } = targets[cursor++];
      let resolved;
      try {
        resolved = await resolve(item.url);
      } catch (err) {
        fail(`例外: ${err?.name ?? 'Error'}`); // 取得失敗は元の要約のまま。原因は集計して見せる
        continue;
      }
      if (!resolved?.ok) {
        fail(resolved?.httpStatus ? `HTTP ${resolved.httpStatus}` : (resolved?.reason ?? resolved?.error ?? '取得失敗'));
        continue;
      }
      const excerpt = (resolved.excerpt ?? '').trim();
      if (excerpt.length > (item.summary ?? '').length) {
        result[index].summary = excerpt;
        enriched++;
      } else {
        fail('抜粋が元の要約より短い');
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));

  return { items: result, attempted: targets.length, enriched, failures };
}
