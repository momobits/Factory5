// @ts-check
import { defineConfig } from 'astro/config';

// Pinned by ADR 0025.
//   server.port = 4321: operator browses to http://localhost:4321/app/ in dev.
//   vite.server.proxy rewrites /api/v1/* → factoryd on 127.0.0.1:25295, so
//   dev-mode fetches reach factoryd without CORS. Prod serves the built bundle
//   under /app/ on 25295 directly — no proxy needed.
export default defineConfig({
  output: 'static',
  base: '/app',
  server: {
    port: 4321,
    host: '127.0.0.1',
  },
  vite: {
    server: {
      proxy: {
        '/api/v1': {
          target: 'http://127.0.0.1:25295',
          changeOrigin: true,
        },
      },
    },
  },
});
