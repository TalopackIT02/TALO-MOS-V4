import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { loadIconNames, resolveIcon } from './iconLibrary';
import '../../styles/nav-icon.css';

// Navigation icon of the fixed SVG library (public/assets/icons/navigation/<key>.svg). A key is a stable name
// (home, settings, folder…), independent of any menu title. Rendering: the SVG file is used as a CSS mask painted with
// `currentColor`, so the icon follows the theme colour (hover / active) and no SVG markup is ever injected into the page.
// Only keys of the generated manifest are used; anything else (unknown, malformed, path-like) shows the fallback icon
// (rules in iconLibrary.ts).

export { DEFAULT_MENU_ICON, FALLBACK_ICON, isIconKeyFormat, loadIconNames, resolveIcon } from './iconLibrary';

export function useIconNames(): ReadonlySet<string> | null {
  const [set, setSet] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    let live = true;
    void loadIconNames().then((s) => { if (live) setSet(s); });
    return () => { live = false; };
  }, []);
  return set;
}

export function iconUrl(key: string): string {
  return `${import.meta.env.BASE_URL}assets/icons/navigation/${key}.svg`;
}

export interface NavIconProps {
  readonly name: string | null | undefined;
  readonly size?: number;
  readonly className?: string;
  readonly title?: string;
}

export function NavIcon({ name, size = 20, className, title }: NavIconProps) {
  const library = useIconNames();
  const key = resolveIcon(name, library);
  const style: CSSProperties = {
    width: size, height: size,
    WebkitMaskImage: `url("${iconUrl(key)}")`, maskImage: `url("${iconUrl(key)}")`,
  };
  return (
    <span className={className ? `nav-icon ${className}` : 'nav-icon'} style={style} data-icon={key}
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} />
  );
}
