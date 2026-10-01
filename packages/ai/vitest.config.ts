/* Runs the vendored AI package tests independently of Megumi's deferred caller migration. */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  test: {
    environment: 'node',
    include: ['packages/ai/test/**/*.test.ts', 'tests/packages/ai/**/*.test.ts'],
  },
  resolve: {
    alias: { '@megumi/ai': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
