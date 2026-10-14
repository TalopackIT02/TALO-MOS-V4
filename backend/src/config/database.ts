// Safe, credential-free description of the configured database, for startup logs and diagnostics.

export interface DatabaseTarget {
  readonly host: string;
  readonly port: string;
  readonly database: string;
}

export function describeDatabaseUrl(databaseUrl: string): DatabaseTarget | undefined {
  try {
    const url = new URL(databaseUrl);
    return {
      host: url.hostname,
      port: url.port || '5432',
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    };
  } catch {
    return undefined;
  }
}
