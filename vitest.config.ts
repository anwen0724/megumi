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
      '@megumi/product': path.resolve(__dirname, 'packages/product/src'),
      '@megumi/engine': path.resolve(__dirname, 'packages/engine/src'),
      '@megumi/input': path.resolve(__dirname, 'packages/input/src'),
      '@megumi/commands': path.resolve(__dirname, 'packages/commands/src'),
      '@megumi/instructions': path.resolve(__dirname, 'packages/instructions/src'),
      '@megumi/tools': path.resolve(__dirname, 'packages/tools/src'),
      '@megumi/permissions': path.resolve(__dirname, 'packages/permissions/src'),
      '@megumi/database': path.resolve(__dirname, 'packages/database/src'),
      '@megumi/events': path.resolve(__dirname, 'packages/events/src'),
      '@megumi/session/attachment-store': path.resolve(__dirname, 'packages/session/src/session-attachment.ts'),
      '@megumi/session/store': path.resolve(__dirname, 'packages/session/src/session-store.ts'),
      '@megumi/session': path.resolve(__dirname, 'packages/session/src'),
      '@megumi/context': path.resolve(__dirname, 'packages/context/src'),
      '@megumi/workspace/node': path.resolve(__dirname, 'packages/workspace/src/node-workspace-file-system.ts'),
      '@megumi/workspace/store': path.resolve(__dirname, 'packages/workspace/src/workspace-store.ts'),
      '@megumi/workspace': path.resolve(__dirname, 'packages/workspace/src'),
      '@megumi/settings/store': path.resolve(__dirname, 'packages/settings/src/settings-store.ts'),
      '@megumi/settings': path.resolve(__dirname, 'packages/settings/src'),
      '@megumi/projections': path.resolve(__dirname, 'packages/projections/src'),
      '@megumi/skills': path.resolve(__dirname, 'packages/skills/src'),
      '@megumi/ai': path.resolve(__dirname, 'packages/ai/src'),
      '@megumi/observability': path.resolve(__dirname, 'packages/observability/src'),
    },
  },
});
