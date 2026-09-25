/**
 * The one helper the app actually calls.
 *
 * This file used to be the scaffold's utils: `cn` (clsx + tailwind-merge),
 * formatDate, formatRelativeDate, generateSlug, isDueToday, PROJECT_COLORS,
 * STATUS_CONFIG and PRIORITY_CONFIG - eight exports, none of them referenced
 * anywhere, and between them the only reason clsx and tailwind-merge were
 * installed at all.
 */

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}
