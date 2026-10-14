import type { RequestHandler } from 'express';
import { sendError } from './errorResponse.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  sendError(res, 404, 'NOT_FOUND', 'Không tìm thấy tài nguyên.');
};
