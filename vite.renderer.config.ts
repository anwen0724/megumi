import { defineConfig } from 'vite';
import path from 'path';

// Tailwind CSS v4 is configured via postcss.config.js (PostCSS plugin)
// rather than @tailwindcss/vite, to avoid ESM loading issues with Electron Forge.
export default defineConfig({
  resolve: {
    alias: {
      '@megumi/desktop': path.resolve(__dirname, 'apps/desktop/src'),
      '@megumi/agent': path.resolve(__dirname, 'packages/agent'),
      '@megumi/coding-agent': path.resolve(__dirname, 'packages/coding-agent'),
      '@megumi/core': path.resolve(__dirname, 'packages/core'),
      '@megumi/context-management': path.resolve(__dirname, 'packages/context-management'),
      '@megumi/ai': path.resolve(__dirname, 'packages/ai'),
      '@megumi/command': path.resolve(__dirname, 'packages/command'),
      '@megumi/input': path.resolve(__dirname, 'packages/input'),
      '@megumi/tools': path.resolve(__dirname, 'packages/tools'),
      '@megumi/memory': path.resolve(__dirname, 'packages/memory'),
      '@megumi/db': path.resolve(__dirname, 'packages/db'),
      '@megumi/security': path.resolve(__dirname, 'packages/security'),
      '@megumi/shared': path.resolve(__dirname, 'packages/shared'),
    },
  },
  root: 'apps/desktop/src/renderer',
  build: { outDir: '../../../../.vite/renderer/main_window' },
});
