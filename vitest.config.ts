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
      '@megumi/product-host': path.resolve(__dirname, 'packages/agent/product-host/src'),
      '@megumi/input': path.resolve(__dirname, 'packages/agent/input/src'),
      '@megumi/commands': path.resolve(__dirname, 'packages/agent/commands/src'),
      '@megumi/instructions': path.resolve(__dirname, 'packages/agent/instructions/src'),
      '@megumi/tools': path.resolve(__dirname, 'packages/agent/tools/src'),
      '@megumi/permissions': path.resolve(__dirname, 'packages/agent/permissions/src'),
      '@megumi/database': path.resolve(__dirname, 'packages/agent/database/src'),
      '@megumi/events': path.resolve(__dirname, 'packages/agent/events/src'),
      '@megumi/session/attachment-store': path.resolve(__dirname, 'packages/agent/session/src/session-attachment.ts'),
      '@megumi/session/store': path.resolve(__dirname, 'packages/agent/session/src/session-store.ts'),
      '@megumi/session': path.resolve(__dirname, 'packages/agent/session/src'),
      '@megumi/context': path.resolve(__dirname, 'packages/agent/context/src'),
      '@megumi/workspace/node': path.resolve(__dirname, 'packages/agent/workspace/src/node-workspace-file-system.ts'),
      '@megumi/workspace/store': path.resolve(__dirname, 'packages/agent/workspace/src/workspace-store.ts'),
      '@megumi/workspace': path.resolve(__dirname, 'packages/agent/workspace/src'),
      '@megumi/settings/store': path.resolve(__dirname, 'packages/agent/settings/src/settings-store.ts'),
      '@megumi/settings': path.resolve(__dirname, 'packages/agent/settings/src'),
      '@megumi/skills': path.resolve(__dirname, 'packages/agent/skills/src'),
      '@megumi/agent-core': path.resolve(__dirname, 'packages/agent-core/src'),
      '@megumi/discovery': path.resolve(__dirname, 'packages/agent/discovery/src'),
      '@megumi/ai': path.resolve(__dirname, 'packages/ai/src'),
      '@megumi/observability': path.resolve(__dirname, 'packages/agent/observability/src'),
      '@megumi/voice': path.resolve(__dirname, 'packages/agent/voice/src'),
    },
  },
});
