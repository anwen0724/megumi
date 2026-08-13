import { defineConfig } from 'vite';
import path from 'path';
import { megumiPackageAliases } from './vite.megumi-package-aliases';

// Tailwind CSS v4 is configured via postcss.config.js (PostCSS plugin)
// rather than @tailwindcss/vite, to avoid ESM loading issues with Electron Forge.
export default defineConfig({
  resolve: {
    alias: [
      { find: '@megumi/desktop', replacement: path.resolve(__dirname, 'apps/desktop/src') },
      ...megumiPackageAliases,
    ],
  },
  root: 'apps/desktop/src/renderer',
  // Keep the URL injected by Electron Forge on the same address family as
  // Chromium. On Windows, `localhost` may bind only to ::1 while Electron
  // attempts IPv4 first, leaving BrowserWindow on its background color.
  server: { host: '127.0.0.1' },
  build: { outDir: '../../../../.vite/renderer/main_window' },
});
