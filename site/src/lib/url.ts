/**
 * import.meta.env.BASE_URL は trailingSlash 設定により末尾スラッシュを含まないことがある
 * （例: '/ai-notebot'）。単純な文字列結合だとスラッシュが欠落するため、常に正しく結合するヘルパー。
 */
export function url(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const cleanPath = path.replace(/^\//, '');
  return `${base}/${cleanPath}`;
}
