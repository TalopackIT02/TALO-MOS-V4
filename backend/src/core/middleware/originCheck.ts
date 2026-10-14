import type { RequestHandler } from 'express';
import { AppError } from '../errors/AppError.js';

// CSRF protection X1 (Phase B0): state-changing requests must carry an Origin header from the allowlist
// and a JSON body. No CORS headers are ever emitted, so other origins cannot read responses either.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function originCheck(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('Origin');
    if (origin === undefined || !allowed.has(origin)) {
      return next(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Yêu cầu không được chấp nhận từ nguồn này.'));
    }
    next();
  };
}

// Checks the declared media type directly: req.is() returns null for bodyless requests (e.g. a logout POST).
export const requireJson: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const mediaType = (req.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Yêu cầu phải dùng Content-Type application/json.'));
  }
  next();
};
