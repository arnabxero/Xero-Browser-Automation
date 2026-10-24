import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The dev server injects an inline React Refresh preamble, which the strict CSP would block.
const devCsp = {
  name: 'dev-csp',
  apply: 'serve' as const,
  transformIndexHtml: (html: string) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
};

export default defineConfig({
  root: r('./src/renderer'),
  base: './',
  plugins: [react(), tailwindcss(), devCsp],
  resolve: {
    alias: {
      '@shared': r('./src/shared'),
      '@': r('./src/renderer/src'),
    },
  },
  build: {
    outDir: r('./out/renderer'),
    emptyOutDir: true,
    target: 'chrome130',
    chunkSizeWarningLimit: 4000,
  },
  server: { port: 5199, strictPort: false },
});
