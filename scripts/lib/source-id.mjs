/**
 * 出典URLからの決定的id採番。collect.mjs（AIトレンド版）と collect-care.mjs（介護版）で
 * 同一のロジックを共有するために抽出した（元は collect.mjs にのみ存在した）。
 */
import { createHash } from 'node:crypto';

export function normalizeUrl(url) {
  return url.replace(/[?#].*$/, '').replace(/\/$/, '');
}

export function makeId(url) {
  return 's-' + createHash('sha1').update(normalizeUrl(url)).digest('hex').slice(0, 10);
}
