import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  define: {
    // In development, use the environment variable. In production, let the
    // runtime fall back to same-origin /api/v1 for reverse proxy deployment.
    __MENTORA_API_BASE__: JSON.stringify(
      process.env.NODE_ENV === 'development'
        ? process.env.VITE_API_BASE_URL
        : undefined
    ),
  },
});
