import { Router } from 'express';
import { getHealth } from './health.controller.js';

export function healthRouter(): Router {
  const router = Router();
  router.get('/health', getHealth);
  return router;
}
