import { defineConfig } from 'vite';

export default defineConfig({
  // Test için özel konfigürasyon
  test: {
    // Bu config sadece test için kullanılacak
  },
  // PostCSS'i devre dışı bırak
  css: {
    postcss: {
      plugins: [],
    },
  },
});
