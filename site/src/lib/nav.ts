/**
 * ヘッダーのナビゲーション項目。版（セクション）を増やすときはここに1行足す。
 * hoverClass は Tailwind が静的に検出できるよう `hover:text-xxx` の完全なクラス名で書く。
 */
export const NAV_LINKS = [
  { href: 'archive/', label: 'アーカイブ', hoverClass: 'hover:text-verify' },
  { href: 'weekly/', label: '週刊まとめ', hoverClass: 'hover:text-verify' },
  { href: 'care/', label: '介護AIハック', hoverClass: 'hover:text-care' },
  { href: 'about/', label: 'About', hoverClass: 'hover:text-verify' },
] as const;
