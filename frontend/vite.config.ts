import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/** True for a host that is only reachable from the developer's own machine. */
function isLocalHostUrl(value: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(value.trim());
}

/**
 * Decide the API base that gets compiled into the bundle.
 *
 * - `VITE_API_BASE_URL` (shell) or the env file, in that order.
 * - A localhost value is honoured ONLY in a development build.
 * - Otherwise, and whenever nothing is set, the app uses a same-origin
 *   `/api/v1` path, which is what a reverse-proxied deployment serves.
 */
function resolveApiBase(mode: string, root: string): string {
  const configured =
    process.env.VITE_API_BASE_URL ?? loadEnv(mode, root, 'VITE_').VITE_API_BASE_URL ?? '';

  if (!configured.trim()) {
    return '';
  }
  if (mode !== 'development' && isLocalHostUrl(configured)) {
    return '';
  }
  return configured;
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // `envDir` is pinned to this config file's own directory.
  //
  // Without it Vite resolves .env relative to the process CWD, so starting the
  // dev server from anywhere else (a monorepo script, an IDE task, a background
  // shell) silently drops VITE_API_BASE_URL and the app starts calling its own
  // origin for /api/v1 requests. Pinning it makes the API base deterministic.
  const root = fileURLToPath(new URL('.', import.meta.url));

  return {
    root,
    envDir: root,
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
    },
    define: {
      // The value baked into the bundle.
      //
      // The `.env` file carries a localhost API base for local development, and
      // that must never end up in a production build — a shipped bundle pointing
      // at localhost is broken for every real student. Rule: a localhost base is
      // accepted only when this build is a development build. Anything else
      // falls back to the same-origin `/api/v1` path used behind a reverse proxy.
      __MENTORA_API_BASE__: JSON.stringify(resolveApiBase(mode, root)),
    },
  };
});
