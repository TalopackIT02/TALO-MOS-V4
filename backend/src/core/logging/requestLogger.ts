import type { RequestHandler } from 'express';
import type { Logger } from './logger.js';

// Access log: method, path (query string dropped — it may carry tokens), status and duration only.
export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      logger.info('request', {
        requestId: res.locals.requestId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
      });
    });
    next();
  };
}
