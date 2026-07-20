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
      '@megumi/product': path.resolve(__dirname, 'packages/product'),
      '@megumi/agent': path.resolve(__dirname, 'packages/agent'),
      '@megumi/skills': path.resolve(__dirname, 'packages/skills'),
      '@megumi/ai': path.resolve(__dirname, 'packages/ai'),
      '@megumi/observability': path.resolve(__dirname, 'packages/observability'),
    },
  },
});
