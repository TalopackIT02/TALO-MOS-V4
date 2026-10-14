import { describe, expect, it } from 'vitest';
import { createLogger, redactSecrets } from '../../src/core/logging/logger.js';

describe('redactSecrets', () => {
  it('masks credentials embedded in URLs', () => {
    expect(redactSecrets('connect postgresql://admin:Secret1@127.0.0.1:5433/db failed')).toBe('connect postgresql://***@127.0.0.1:5433/db failed');
    expect(redactSecrets('https://user@example.com/x')).toBe('https://***@example.com/x');
    expect(redactSecrets('no credentials https://example.com/x')).toBe('no credentials https://example.com/x');
  });
});

describe('createLogger', () => {
  it('writes JSON lines, filters by level and redacts string fields', () => {
    const lines: string[] = [];
    const logger = createLogger({ level: 'info', sink: (line) => lines.push(line) });
    logger.debug('hidden');
    logger.info('visible', { url: 'postgresql://a:Secret2@h/db', count: 2, skipped: undefined });
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? '{}');
    expect(entry).toMatchObject({ level: 'info', msg: 'visible', url: 'postgresql://***@h/db', count: 2 });
    expect(entry).not.toHaveProperty('skipped');
    expect(lines[0]).not.toContain('Secret2');
  });
});
