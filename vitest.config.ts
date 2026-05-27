import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./apps/desktop/src/renderer/test/setup.ts'],
  },
  resolve: {
    alias: {
      '@megumi/desktop': path.resolve(__dirname, 'apps/desktop/src'),
      '@megumi/core': path.resolve(__dirname, 'packages/core'),
      '@megumi/context-management': path.resolve(__dirname, 'packages/context-management'),
      '@megumi/ai': path.resolve(__dirname, 'packages/ai'),
      '@megumi/tools': path.resolve(__dirname, 'packages/tools'),
      '@megumi/memory': path.resolve(__dirname, 'packages/memory'),
      '@megumi/db': path.resolve(__dirname, 'packages/db'),
      '@megumi/security': path.resolve(__dirname, 'packages/security'),
      '@megumi/shared': path.resolve(__dirname, 'packages/shared'),
    },
  },
});
