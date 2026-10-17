import express from 'express';
import type { Router } from 'express';
import type { AuthService } from '../auth/auth.service.js';
import { sessionHandler } from './foundation.http.js';
import type { VersionRecord } from './foundation.versions.repository.js';
import type { ModuleVersionService } from './foundation.versions.service.js';

// FBE-02A — /api/foundation/modules/:moduleId/versions[/:versionId]. Same session wrapper as the Module Registry.

export interface ModuleVersionRouterDeps {
  readonly authService: Pick<AuthService, 'describeSession'>;
  readonly service: ModuleVersionService;
  readonly secureCookie: boolean;
}

function versionBody(v: VersionRecord) {
  return {
    versionId: v.versionId, moduleId: v.moduleId, moduleVersion: v.moduleVersion, contractVersion: v.contractVersion, status: v.status,
    manifestJson: v.manifestJson, manifestHash: v.manifestHash, submittedByAccountId: v.submittedByAccountId, createdAt: v.createdAt,
    reviewedByAccountId: v.reviewedByAccountId, reviewedAt: v.reviewedAt, activatedAt: v.activatedAt,
  };
}

export function moduleVersionRouter({ authService, service, secureCookie }: ModuleVersionRouterDeps): Router {
  const router = express.Router();
  const handle = sessionHandler({ authService, secureCookie });

  router.get('/foundation/modules/:moduleId/versions', handle(async (req, res, actor) => {
    const versions = await service.listVersions(actor, req.params['moduleId']);
    res.status(200).json({ versions: versions.map(versionBody) });
  }));

  router.get('/foundation/modules/:moduleId/versions/:versionId', handle(async (req, res, actor) => {
    const version = await service.getVersion(actor, req.params['moduleId'], req.params['versionId']);
    res.status(200).json({ version: versionBody(version) });
  }));

  router.post('/foundation/modules/:moduleId/versions', handle(async (req, res, actor) => {
    const version = await service.createVersion(actor, req.params['moduleId'], req.body);
    res.status(201).json({ version: versionBody(version) });
  }));

  return router;
}
