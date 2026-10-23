import type { Router } from 'express';
import type { Logger } from '../core/logging/logger.js';
import { createHostCapabilities } from './capabilities.js';
import type { HostDeps } from './capabilities.js';
import { HOST_CAPABILITIES, HOST_PROTOCOL } from './contract.js';
import type { InstalledModule } from './contract.js';

// MOD-TEST-02 — Host module loader, runtime part. Mounts the packages of the generated registry (scripts/modules-sync.mjs)
// after the runtime handshake: Host protocol of the manifest AND of the entry, required capabilities provided, entry
// factory present. A package that fails is logged and not mounted; the Host keeps running. Mounting grants nothing: every
// module request still goes through Session + IAM + lifecycle (ACTIVE + ENABLED) inside the module's capabilities.

export function handshake(pkg: InstalledModule): string[] {
  const problems: string[] = [];
  if (pkg.manifest.hostProtocol !== HOST_PROTOCOL || pkg.entry.HOST_PROTOCOL !== HOST_PROTOCOL) problems.push('host protocol');
  const provided: readonly string[] = HOST_CAPABILITIES;
  for (const c of new Set([...pkg.manifest.requiredCapabilities, ...pkg.entry.REQUIRED_CAPABILITIES])) {
    if (!provided.includes(c)) problems.push(`capability ${c}`);
  }
  if (typeof pkg.entry.createModule !== 'function') problems.push('createModule');
  return problems;
}

export function mountModules(packages: readonly InstalledModule[], deps: HostDeps, logger: Logger): Router[] {
  return [...mountModuleMap(packages, deps, logger).values()];
}

// FMI-03: the same mount, keyed by module (the installer's postcheck calls the router this process really runs).
export function mountModuleMap(packages: readonly InstalledModule[], deps: HostDeps, logger: Logger): Map<string, Router> {
  const routers = new Map<string, Router>();
  for (const pkg of packages) {
    const problems = handshake(pkg);
    if (problems.length > 0) {
      logger.warn('module package not loaded', { moduleKey: pkg.manifest.moduleKey, problems: problems.join(', ') });
      continue;
    }
    routers.set(pkg.manifest.moduleKey, pkg.entry.createModule(createHostCapabilities(pkg.manifest.moduleKey, deps)).router);
    logger.info('module package loaded', { moduleKey: pkg.manifest.moduleKey, packageVersion: pkg.manifest.packageVersion, packageHash: pkg.manifest.packageHash ?? null, contract: pkg.manifest.contractVersion });
  }
  return routers;
}
