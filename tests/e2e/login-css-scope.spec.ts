import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

// Static check: login CSS must not leak to future screens. File-based, so it runs once (react-dev project).

const STYLES_DIR = resolve(__dirname, '../../frontend/src/styles');

function selectorsOf(css: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const preludes = Array.from(withoutComments.matchAll(/([^{}]+)\{/g), (match) => (match[1] ?? '').trim());
  return preludes
    .filter((prelude) => !prelude.startsWith('@'))
    .flatMap((prelude) => prelude.split(',').map((selector) => selector.trim()));
}

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'react-dev', 'static file check runs once');
});

test('every auth-login.css selector is scoped under .auth-login-page', () => {
  const selectors = selectorsOf(readFileSync(resolve(STYLES_DIR, 'auth-login.css'), 'utf8'));
  expect(selectors.length).toBeGreaterThan(0);
  const unscoped = selectors.filter((selector) => selector !== '.auth-login-page' && !selector.startsWith('.auth-login-page '));
  expect(unscoped).toEqual([]);
});

test('every app-shell.css selector is scoped under .app-shell (TASK F1)', () => {
  const selectors = selectorsOf(readFileSync(resolve(STYLES_DIR, 'app-shell.css'), 'utf8'));
  expect(selectors.length).toBeGreaterThan(0);
  const unscoped = selectors.filter((selector) => !/^\.app-shell(?=[ .:]|$)/.test(selector));
  expect(unscoped).toEqual([]);
});

test('base.css only contains the html/body/#root sizing rule', () => {
  const selectors = selectorsOf(readFileSync(resolve(STYLES_DIR, 'base.css'), 'utf8'));
  expect(selectors).toEqual(['html', 'body', '#root']);
});
