// Types of the shared module package reader (module-package.mjs).
export interface PackageFile {
  readonly path: string;
  readonly size: number;
  readonly key: string;
}
export interface PackageIssue {
  readonly code: 'PATH_UNSAFE' | 'SENSITIVE_FILE' | 'SCAN_LIMIT_EXCEEDED';
  readonly path: string;
  readonly message: string;
}
export interface PackageWalk {
  readonly files: readonly PackageFile[];
  readonly issues: readonly PackageIssue[];
  readonly bytes: number;
  readonly limited: boolean;
}
export declare const HASH_FORMAT: string;
export declare const LIMITS: { readonly files: number; readonly bytes: number };
export declare const EXCLUDED_DIRS: readonly string[];
export declare function isSensitiveName(name: string): boolean;
export declare function walkPackage(dir: string, limits?: { readonly files: number; readonly bytes: number }): PackageWalk;
export declare function hashPackage(dir: string, walk: PackageWalk): { readonly hash: string | null; readonly changed: boolean };
