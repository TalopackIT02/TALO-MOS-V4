import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /api is proxied to the backend so the session cookie stays first-party (same origin, SameSite=Strict).
// The browser's Origin header (http://127.0.0.1:5173) is forwarded unchanged for CSRF X1.
const apiProxy = {
  '/api': { target: process.env.TALO_API_TARGET ?? 'http://127.0.0.1:3000', changeOrigin: false },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: apiProxy,
  },
});
