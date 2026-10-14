import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

declare global {
  namespace Express {
    interface Locals {
      requestId: string;
    }
  }
}

export const REQUEST_ID_HEADER = 'X-Request-Id';

// Always generated server-side; a client-supplied X-Request-Id is ignored so it cannot be used to forge log correlation.
export const requestId: RequestHandler = (_req, res, next) => {
  const id = randomUUID();
  res.locals.requestId = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  next();
};
