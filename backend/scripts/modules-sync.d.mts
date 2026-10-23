// Types of the build-time Host module loader (modules-sync.mjs), for the Host tests.
export declare const PACKAGE_FORMAT: string;
export declare const HOST_PROTOCOL: string;
export declare const HOST_CAPABILITIES: readonly string[];
export declare function validateManifest(manifest: unknown, folder: string, packageDir: string): string[];
export declare function syncModules(options: {
  deployments?: unknown;
  target: 'backend' | 'frontend';
  modulesDir?: string;
  releasesDir?: string;
  outDir: string;
  log?: (line: string) => void;
}): string[];
export interface PinnedRelease { readonly packageVersion: string; readonly packageHash: string }
export declare function releaseDir(releasesDir: string, moduleKey: string, packageVersion: string): string;
export declare function checkRelease(dir: string, moduleKey: string, pinned: PinnedRelease): { readonly manifest: unknown; readonly problem: string | null };
export declare function writeRelease(options: {
  releasesDir: string; moduleKey: string; packageVersion: string; sourceDir: string; expectedHash: string;
}): { readonly dir: string; readonly created: boolean };
export declare function copyPackage(sourceDir: string, dest: string, expectedHash: string): string;
export declare function writeDeployments(file: string, entries: readonly { moduleKey: string; packageVersion: string; packageHash: string }[]): unknown;
export declare const DEPLOYMENT_FORMAT: string;
export declare function parseDeployments(value: unknown): Map<string, { readonly packageVersion: string; readonly packageHash: string }>;
