export const ALL_SERVICES_WILDCARD = '全サービス共通';

/**
 * 「全サービス共通」はワイルドカードではなく他の値と対等な独立したenum値だが、実運用上は
 * 「どのサービス種別でも使える」という意味で書かれているため、具体サービスで絞り込む際は
 * 「全サービス共通」記事も含める。
 *
 * このロジックは3箇所に分散して実装されている（同期を保つこと）:
 * 1. ここ（targetservice/配下の静的ページが使う）
 * 2. care/index.astro の buildFilterCss()（CSS :has() の生成。同じ規則をCSSで表現）
 * 3. care/index.astro の <script> 内 matchesAxis()（フィルタUIの動的件数再計算。JS版）
 */
export function matchesTargetService(services: string[], value: string): boolean {
  return value === ALL_SERVICES_WILDCARD ? services.includes(value) : services.includes(value) || services.includes(ALL_SERVICES_WILDCARD);
}
