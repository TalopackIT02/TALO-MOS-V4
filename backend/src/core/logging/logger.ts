// Minimal structured (JSON lines) logger.
// Callers pass explicit fields only; request bodies, headers, cookies and secrets are never logged.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, string | number | boolean | null | undefined>;
export type LogSink = (line: string) => void;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Masks credentials embedded in URLs, e.g. postgresql://user:pass@host → postgresql://***@host.
export function redactSecrets(text: string): string {
  return text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@');
}

export function createLogger(options: { level: LogLevel; sink?: LogSink }): Logger {
  const minimum = LEVEL_ORDER[options.level];
  const sink: LogSink = options.sink ?? ((line) => process.stdout.write(`${line}\n`));

  function write(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] < minimum) return;
    const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, msg: redactSecrets(message) };
    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        entry[key] = typeof value === 'string' ? redactSecrets(value) : value;
      }
    }
    sink(JSON.stringify(entry));
  }

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
