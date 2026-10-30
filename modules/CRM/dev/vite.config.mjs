// CRM Module — standalone dev / acceptance build. Uses the Host frontend's installed toolchain (vite, @vitejs/plugin-react,
// react, react-dom from ../../../frontend/node_modules): no dependency is added to the project.
// Run (from the repository root):
//   node frontend/node_modules/vite/bin/vite.js --config modules/CRM/dev/vite.config.mjs          (dev server)
//   node frontend/node_modules/vite/bin/vite.js build --config modules/CRM/dev/vite.config.mjs    (build)
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const hostModules = resolve(repo, 'frontend/node_modules');
const require = createRequire(resolve(hostModules, 'vite/package.json'));
const react = (await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href)).default;
const outDir = process.env.CRM_DEV_OUT ?? resolve(repo, '..', 'TALO-MOS-V4_exports', 'crm-frontend-dev-build');

export default {
  root: here,
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      react: resolve(hostModules, 'react'),
      'react-dom': resolve(hostModules, 'react-dom'),
      'react/jsx-runtime': resolve(hostModules, 'react/jsx-runtime.js'),
      'react/jsx-dev-runtime': resolve(hostModules, 'react/jsx-dev-runtime.js'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: { host: '127.0.0.1', port: 5181, strictPort: true, fs: { allow: [repo] } },
  preview: { host: '127.0.0.1', port: 5182, strictPort: true },
  build: { outDir, emptyOutDir: true, sourcemap: true },
};
