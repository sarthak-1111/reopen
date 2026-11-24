import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        smoke: resolve(import.meta.dirname, 'smoke/index.html'),
      },
    },
  },
});
