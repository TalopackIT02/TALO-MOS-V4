import helmet from 'helmet';
import type { RequestHandler } from 'express';

// Helmet defaults suit a JSON API. HSTS is left on (browsers ignore it over plain HTTP on localhost;
// behind the future TLS reverse proxy it applies as intended).
export const securityHeaders: RequestHandler = helmet();

// API responses must never be cached by browsers or intermediaries.
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};
