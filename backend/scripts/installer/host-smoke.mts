// FMI-02 P4 / P6 — fixed preflight entrypoint (never chosen by a request): run by the Foundation preflight engine in a
// child process (tsx, scrubbed environment, time limit) as
//   tsx host-smoke.mts <staged package dir>
// It imports the STAGED backend entry of a candidate (never the running Host), checks the Host handshake
// (TALO-MODULE-HOST-1, capabilities, createModule), creates the module with STUB capabilities (no database, no session:
// every session is refused), compares the routes the router really mounts with MIC-05, then calls every MIC-05
// endpoint over HTTP without a session: each one must answer 401 with the JSON error envelope (mounted, behind the
// Host session) — never 404 / 2xx / 5xx. Prints one JSON object on stdout; exit code 0 = ran (results inside).
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import type { Request, Response, Router } from 'express';

const HOST_PROTOCOL = 'TALO-MODULE-HOST-1';
const HOST_CAPABILITIES = ['session', 'authorize', 'evaluate', 'lifecycle', 'readOnly', 'menuRoutes', 'inspectManifest', 'sqlstate', 'regressionResults', 'logger'];

const dir = process.argv[2] ?? '';
const manifest = JSON.parse(readFileSync(join(dir, 'module.json'), 'utf8')) as { moduleKey: string; backendEntry: string; requiredCapabilities: string[] };
const mic = JSON.parse(readFileSync(join(dir, 'mic', 'module.mic.json'), 'utf8')) as { mic05Api: { method: string; path: string }[] };
const out: Record<string, unknown> = { moduleKey: manifest.moduleKey };
const logs: string[] = [];

const refused = (_req: Request, res: Response) => {
  res.status(401).json({ error: { code: 'SESSION_INVALID', message: 'preflight: no session', requestId: 'preflight' } });
};
const host = {
  protocol: HOST_PROTOCOL,
  moduleKey: manifest.moduleKey,
  logger: { info: (m: string) => logs.push(`info ${m}`), warn: (m: string) => logs.push(`warn ${m}`), error: (m: string) => logs.push(`error ${m}`) },
  session: () => refused,
  authorize: async () => { throw new Error('preflight stub: no actor'); },
  evaluate: async () => ({ allowed: false as const, reason: 'PREFLIGHT_STUB' }),
  lifecycle: async () => null,
  readOnly: async () => { throw new Error('preflight stub: no database'); },
  menuRoutes: async () => [],
  inspectManifest: () => ({ intact: false, micValid: false }),
  sqlstate: () => undefined,
  regressionResults: async () => null,
};

// Routes of a router, sub-routers mounted with router.use() included (Express 5 layers: route / handle.stack).
type Layer = { route?: { path: string; methods: Record<string, boolean> }; handle?: { stack?: Layer[] } };
function mounted(router: Router): string[] {
  const walk = (stack: Layer[]): string[] => stack.flatMap((l) => (l.route
    ? Object.keys(l.route.methods).filter((m) => m !== '_all').map((m) => `${m.toUpperCase()} ${l.route?.path ?? ''}`)
    : Array.isArray(l.handle?.stack) ? walk(l.handle.stack) : []));
  return [...new Set(walk((router as unknown as { stack: Layer[] }).stack))];
}
// MIC-05 "/api/x/{key}" → Express "/x/:key" (the Host mounts module routers under /api).
const toExpress = (p: string) => p.replace(/^\/api/, '').replace(/\{([A-Za-z0-9_]+)\}/g, ':$1');
const sample = (p: string) => p.replace(/\{[A-Za-z0-9_]+\}/g, 'x');
// One request without keep-alive (agent: false), so that the process ends by itself once the server is closed.
const call = (port: number, method: string, path: string) => new Promise<{ status: number; body: string }>((resolveCall, reject) => {
  const req = request({ host: '127.0.0.1', port, method, path, agent: false, headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (c: string) => { body += c; });
    res.on('end', () => resolveCall({ status: res.statusCode ?? 0, body }));
  });
  req.on('error', reject);
  req.end(method === 'GET' ? undefined : '{}');
});

try {
  const entry = await import(pathToFileURL(join(dir, manifest.backendEntry)).href) as {
    HOST_PROTOCOL?: string; REQUIRED_CAPABILITIES?: string[]; createModule?: (h: typeof host) => { router: Router };
  };
  const problems: string[] = [];
  if (entry.HOST_PROTOCOL !== HOST_PROTOCOL) problems.push('host protocol');
  for (const c of new Set([...(manifest.requiredCapabilities ?? []), ...(entry.REQUIRED_CAPABILITIES ?? [])])) if (!HOST_CAPABILITIES.includes(c)) problems.push(`capability ${c}`);
  if (typeof entry.createModule !== 'function') problems.push('createModule');
  out['handshake'] = problems;
  if (problems.length === 0 && entry.createModule) {
    const { router } = entry.createModule(host);
    const routes = mounted(router);
    const declared = mic.mic05Api.map((a) => `${a.method.toUpperCase()} ${toExpress(a.path)}`);
    out['routes'] = { mounted: routes, declared, missing: declared.filter((d) => !routes.includes(d)), undeclared: routes.filter((r) => !declared.includes(r)) };
    const app = express();
    app.use('/api', express.json({ limit: '10kb' }), router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const port = (server.address() as AddressInfo).port;
    const smoke = [];
    for (const a of mic.mic05Api) {
      const method = a.method.toUpperCase();
      const res = await call(port, method, sample(a.path));
      let code: string | null = null;
      try {
        const body = JSON.parse(res.body) as { error?: { code?: unknown } };
        code = typeof body.error?.code === 'string' ? body.error.code : null;
      } catch {
        code = null;
      }
      smoke.push({ method, path: a.path, status: res.status, code });
    }
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    out['smoke'] = smoke;
  }
} catch (error) {
  out['error'] = error instanceof Error ? `${error.name}: ${error.message}` : 'import failed';
}
out['logs'] = logs.slice(0, 50);
process.stdout.write(`${JSON.stringify(out)}\n`);
