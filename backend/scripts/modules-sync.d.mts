// Types of the build-time Host module loader (modules-sync.mjs), for the Host tests.
export declare const PACKAGE_FORMAT: string;
export declare const HOST_PROTOCOL: string;
export declare const HOST_CAPABILITIES: readonly string[];
export declare function validateManifest(manifest: unknown, folder: string, packageDir: string): string[];
export declare function syncModules(options: {
  target: 'backend' | 'frontend';
  modulesDir: string;
  outDir: string;
  log?: (line: string) => void;
}): string[];
