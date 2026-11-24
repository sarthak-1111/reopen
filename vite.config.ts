import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';

const BUILD_ID = Date.now().toString(36);

/** Files the service worker should cache: every emitted asset except source maps, plus the shell. */
export function precacheList(bundleFiles: readonly string[]): string[] {
  const files = bundleFiles
    .filter((file) => !file.endsWith('.map') && !file.endsWith('.html') && file !== 'precache-manifest.json')
    .map((file) => `/${file}`);
  return ['/', '/manifest.webmanifest', '/icon.svg', ...files.sort()];
}

/** Emits precache-manifest.json for public/sw.js (which is copied unchanged). */
function precacheManifest(): Plugin {
  return {
    name: 'reopen-precache-manifest',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const smokeAssets = new Set(
        Object.values(bundle)
          .filter((chunk) => chunk.type === 'chunk' && chunk.facadeModuleId?.replace(/\\/g, '/').includes('/smoke/'))
          .map((chunk) => chunk.fileName),
      );
      const files = Object.keys(bundle).filter((file) => !smokeAssets.has(file));
      this.emitFile({
        type: 'asset',
        fileName: 'precache-manifest.json',
        source: JSON.stringify({ version: BUILD_ID, files: precacheList(files) }, null, 2),
      });
    },
  };
}

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  worker: {
    // The core lazily imports SheetJS code-page tables, which needs code splitting.
    format: 'es',
  },
  plugins: [precacheManifest()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        smoke: resolve(import.meta.dirname, 'smoke/index.html'),
      },
    },
  },
});
