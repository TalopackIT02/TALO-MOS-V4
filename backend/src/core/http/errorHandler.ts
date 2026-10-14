import type { ErrorRequestHandler } from 'express';
import { AppError } from '../errors/AppError.js';
import type { Logger } from '../logging/logger.js';
import { sendError } from './errorResponse.js';

// body-parser marks its errors with a `type`; map them to safe client errors.
const BODY_PARSER_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  'entity.too.large': { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Dữ liệu gửi lên vượt quá giới hạn cho phép.' },
  'entity.parse.failed': { status: 400, code: 'INVALID_JSON', message: 'Dữ liệu JSON không hợp lệ.' },
  'encoding.unsupported': { status: 415, code: 'UNSUPPORTED_ENCODING', message: 'Bảng mã của dữ liệu không được hỗ trợ.' },
  'charset.unsupported': { status: 415, code: 'UNSUPPORTED_ENCODING', message: 'Bảng mã của dữ liệu không được hỗ trợ.' },
};

function bodyParserType(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('type' in err)) return undefined;
  const type = err.type;
  return typeof type === 'string' ? type : undefined;
}

function errorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  const code = err.code;
  return typeof code === 'string' ? code : undefined;
}

// Stack traces, driver/Prisma messages and internal details never reach the client.
// Unexpected errors are logged by name/code; the message and stack only outside production,
// and always passed through secret redaction by the logger.
export function errorHandler(logger: Logger, options: { exposeDiagnostics: boolean }): ErrorRequestHandler {
  return (err: unknown, _req, res, next) => {
    if (res.headersSent) return next(err);

    if (err instanceof AppError) {
      sendError(res, err.status, err.code, err.message);
      return;
    }

    const parserType = bodyParserType(err);
    const mapped = parserType ? BODY_PARSER_ERRORS[parserType] : undefined;
    if (mapped) {
      sendError(res, mapped.status, mapped.code, mapped.message);
      return;
    }

    const name = err instanceof Error ? err.name : typeof err;
    logger.error('unhandled error', {
      requestId: res.locals.requestId,
      errorName: name,
      errorCode: errorCode(err),
      errorMessage: options.exposeDiagnostics && err instanceof Error ? err.message : undefined,
      stack: options.exposeDiagnostics && err instanceof Error ? err.stack : undefined,
    });
    sendError(res, 500, 'INTERNAL_ERROR', 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.');
  };
}
