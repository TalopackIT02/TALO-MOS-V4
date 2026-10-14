import type { Response } from 'express';

// Single error envelope for every API error: { error: { code, message, requestId } }.
export function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message, requestId: res.locals.requestId } });
}
