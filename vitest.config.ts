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
      '@megumi/home': path.resolve(__dirname, 'packages/home'),
      '@megumi/coding-agent': path.resolve(__dirname, 'packages/coding-agent'),
      '@megumi/ai': path.resolve(__dirname, 'packages/ai'),
    },
  },
});
