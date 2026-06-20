import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const emitSourceMaps = process.env.LIPI_BUILD_SOURCEMAPS === '1';

// Tauri convention: dev server on 1420, fixed port so the Tauri shell can
// attach predictably. `clearScreen: false` keeps Tauri's `tauri dev`
// output visible. The `@/` path alias mirrors the source layout and keeps
// imports short across the codebase.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  preview: {
    port: 1420,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/shared': path.resolve(__dirname, './src/shared'),
      '@/screens': path.resolve(__dirname, './src/screens'),
      '@/voice': path.resolve(__dirname, './src/voice'),
      '@/dev': path.resolve(__dirname, './src/dev'),
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  // Phase 7: Monaco editor worker bundling.
  // - `optimizeDeps.include` pre-bundles Monaco's ESM entry
  //   so the dev server doesn't choke on its 100+ file
  //   on-demand import graph.
  // - `rollupOptions.output.manualChunks` splits Monaco's
  //   language workers into their own chunk so the TS /
  //   JSON / CSS / HTML workers aren't pulled into the
  //   main index bundle.
  optimizeDeps: {
    include: [
      'monaco-editor/esm/vs/editor/editor.api',
      'monaco-editor/esm/vs/language/typescript/ts.worker',
      'monaco-editor/esm/vs/language/json/json.worker',
      'monaco-editor/esm/vs/language/css/css.worker',
      'monaco-editor/esm/vs/language/html/html.worker',
    ],
  },
  build: {
    target: 'es2022',
    sourcemap: emitSourceMaps,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('monaco-editor/esm/vs/language/typescript/ts.worker')) {
            return 'monaco-ts';
          }
          if (id.includes('monaco-editor/esm/vs/language/json/json.worker')) {
            return 'monaco-json';
          }
          if (id.includes('monaco-editor/esm/vs/language/css/css.worker')) {
            return 'monaco-css';
          }
          if (id.includes('monaco-editor/esm/vs/language/html/html.worker')) {
            return 'monaco-html';
          }
          if (id.includes('monaco-editor')) {
            return 'monaco';
          }
          return undefined;
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
});
