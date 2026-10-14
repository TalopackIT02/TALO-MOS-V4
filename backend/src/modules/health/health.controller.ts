import type { RequestHandler } from 'express';

// Liveness only: no database access, no version or runtime details.
export const getHealth: RequestHandler = (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'talo-mos-backend' });
};
