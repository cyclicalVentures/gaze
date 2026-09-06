import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '/gaze';
export default defineConfig({
  base: `${basePath}/`,
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  define: { 'process.env.NEXT_PUBLIC_BASE_PATH': JSON.stringify(basePath) },
  css: { postcss: { plugins: [tailwindcss()] } },
  worker: { format: 'es' },
  build: { outDir: 'dist/pages', emptyOutDir: true, target: 'es2022' },
});
