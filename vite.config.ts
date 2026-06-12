import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

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
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
