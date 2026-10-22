// Navigation icon library — key rules (no React, no CSS: also used by the tests). A key is a stable icon name of
// public/assets/icons/navigation/<key>.svg, independent of any menu title; only keys of the generated manifest are drawn.

export const FALLBACK_ICON = 'point';
// Default icon of a menu without a stored icon (B09 has no icon column yet — see Foundation › Điều hướng).
export const DEFAULT_MENU_ICON = 'folder';

const KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const isIconKeyFormat = (key: string): boolean => key.length <= 64 && KEY.test(key);

let names: Promise<ReadonlySet<string>> | null = null;
// The manifest (≈5 000 names) is a separate chunk, loaded once on first use.
export function loadIconNames(): Promise<ReadonlySet<string>> {
  names ??= import('./navigationIconNames').then((m) => new Set(m.NAVIGATION_ICON_NAMES));
  return names;
}

// Key that will actually be drawn: the requested one when it is in the library, otherwise the fallback.
export function resolveIcon(key: string | null | undefined, library: ReadonlySet<string> | null): string {
  if (!key || !isIconKeyFormat(key)) return FALLBACK_ICON;
  if (library !== null && !library.has(key)) return FALLBACK_ICON;
  return key;
}
