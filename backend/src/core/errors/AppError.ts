// An error whose status, code and message are safe to return to the client.
export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}
