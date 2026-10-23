import type { ComponentType } from 'react';
import { INSTALLED_MODULES } from '../installed-modules/registry';

// MOD-TEST-02 — module screens of the installed packages (generated registry, backend/scripts/modules-sync.mjs). The
// shell knows no module by name: each package's module.json declares its screens (screenKey, name, description, tabs
// with route paths) and its frontend entry exports `screens` (screenKey → component). The server decides every access
// (Session + IAM + ACTIVE + ENABLED); a screen is reached from the Foundation menu.

export const HOST_PROTOCOL = 'TALO-MODULE-HOST-1';

export interface ModuleScreenProps {
  readonly tab: number;
  readonly onSessionLost: () => void;
}

export interface ModuleScreenManifest {
  readonly screenKey: string;
  readonly name: string;
  readonly description: string;
  readonly tabs: readonly { readonly label: string; readonly path: string }[];
}

export interface InstalledModule {
  readonly manifest: {
    readonly moduleKey: string;
    readonly name: string;
    readonly packageVersion: string;
    readonly packageHash?: string | null;
    readonly contractVersion: string;
    readonly hostProtocol: string;
    readonly requiredCapabilities: readonly string[];
    readonly screens: readonly ModuleScreenManifest[];
  };
  readonly entry: { readonly screens: Readonly<Record<string, ComponentType<ModuleScreenProps>>> };
}

export interface ModuleScreen {
  readonly id: `module:${string}`;
  readonly moduleKey: string;
  readonly path: string;
  readonly name: string;
  readonly desc: string;
  readonly tabs: readonly string[];
  readonly tabPaths: readonly string[];
  readonly component: ComponentType<ModuleScreenProps>;
}

// Screens whose component is exported by the entry and whose paths are not already taken (`reserved` = shell paths).
export function moduleScreens(installed: readonly InstalledModule[], reserved: ReadonlySet<string>): ModuleScreen[] {
  const taken = new Set(reserved);
  const out: ModuleScreen[] = [];
  for (const pkg of installed) {
    if (pkg.manifest.hostProtocol !== HOST_PROTOCOL) continue;
    for (const s of pkg.manifest.screens) {
      const component = pkg.entry.screens[s.screenKey];
      const paths = s.tabs.map((t) => t.path);
      const [path] = paths;
      if (component === undefined || path === undefined || paths.some((p) => taken.has(p))) continue;
      for (const p of paths) taken.add(p);
      out.push({
        id: `module:${pkg.manifest.moduleKey}:${s.screenKey}`, moduleKey: pkg.manifest.moduleKey, path, name: s.name, desc: s.description,
        tabs: s.tabs.map((t) => t.label), tabPaths: paths, component,
      });
    }
  }
  return out;
}

export const INSTALLED = INSTALLED_MODULES;
