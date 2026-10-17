import express from 'express';
import type { Router } from 'express';
import type { AuthService } from '../auth/auth.service.js';
import { sessionHandler } from './foundation.http.js';
import { MANIFEST_ROUTE, rawJsonBody } from './foundation.json.js';
import type { ModuleManifestService } from './foundation.manifest.service.js';
import type { VersionRecord } from './foundation.versions.repository.js';

// FBE-02B — PUT …/versions/:versionId/manifest (256 KiB parser mounted in app.ts) and POST …/versions/:versionId/submit.

export interface ModuleManifestRouterDeps {
  readonly authService: Pick<AuthService, 'describeSession'>;
  readonly service: ModuleManifestService;
  readonly secureCookie: boolean;
}

function versionBody(v: VersionRecord) {
  return {
    versionId: v.versionId, moduleId: v.moduleId, moduleVersion: v.moduleVersion, contractVersion: v.contractVersion, status: v.status,
    manifestJson: v.manifestJson, manifestHash: v.manifestHash, submittedByAccountId: v.submittedByAccountId, createdAt: v.createdAt,
    reviewedByAccountId: v.reviewedByAccountId, reviewedAt: v.reviewedAt, activatedAt: v.activatedAt,
  };
}

export function moduleManifestRouter({ authService, service, secureCookie }: ModuleManifestRouterDeps): Router {
  const router = express.Router();
  const handle = sessionHandler({ authService, secureCookie });

  router.put(MANIFEST_ROUTE, handle(async (req, res, actor) => {
    const version = await service.updateManifest(actor, req.params['moduleId'], req.params['versionId'], req.body, rawJsonBody(req));
    res.status(200).json({ version: versionBody(version) });
  }));

  router.post('/foundation/modules/:moduleId/versions/:versionId/submit', handle(async (req, res, actor) => {
    const version = await service.submit(actor, req.params['moduleId'], req.params['versionId'], req.body);
    res.status(200).json({ version: versionBody(version) });
  }));

  return router;
}
