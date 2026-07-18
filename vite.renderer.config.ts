import { defineConfig } from 'vite';
import path from 'path';

// Tailwind CSS v4 is configured via postcss.config.js (PostCSS plugin)
// rather than @tailwindcss/vite, to avoid ESM loading issues with Electron Forge.
export default defineConfig({
  resolve: {
    alias: {
      '@megumi/desktop': path.resolve(__dirname, 'apps/desktop/src'),
      '@megumi/product': path.resolve(__dirname, 'packages/product'),
      '@megumi/agent': path.resolve(__dirname, 'packages/agent'),
      '@megumi/ai': path.resolve(__dirname, 'packages/ai'),
      '@megumi/observability': path.resolve(__dirname, 'packages/observability'),
    },
  },
  root: 'apps/desktop/src/renderer',
  build: { outDir: '../../../../.vite/renderer/main_window' },
});
