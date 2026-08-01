/*
 * Keeps local Megumi Workspace Packages on source paths during Vite development and builds.
 */
import path from 'node:path';
import type { AliasOptions } from 'vite';

export const megumiPackageAliases: AliasOptions = [
  { find: '@megumi/database/schema', replacement: path.resolve(__dirname, 'packages/database/src/database-schema.ts') },
  { find: '@megumi/session/attachment-store', replacement: path.resolve(__dirname, 'packages/session/src/session-attachment.ts') },
  { find: '@megumi/session/store', replacement: path.resolve(__dirname, 'packages/session/src/session-store.ts') },
  { find: '@megumi/settings/store', replacement: path.resolve(__dirname, 'packages/settings/src/settings-store.ts') },
  { find: '@megumi/workspace/node', replacement: path.resolve(__dirname, 'packages/workspace/src/node-workspace-file-system.ts') },
  { find: '@megumi/workspace/store', replacement: path.resolve(__dirname, 'packages/workspace/src/workspace-store.ts') },
  { find: '@megumi/ai', replacement: path.resolve(__dirname, 'packages/ai/src') },
  { find: '@megumi/commands', replacement: path.resolve(__dirname, 'packages/commands/src') },
  { find: '@megumi/context', replacement: path.resolve(__dirname, 'packages/context/src') },
  { find: '@megumi/database', replacement: path.resolve(__dirname, 'packages/database/src') },
  { find: '@megumi/engine', replacement: path.resolve(__dirname, 'packages/engine/src') },
  { find: '@megumi/events', replacement: path.resolve(__dirname, 'packages/events/src') },
  { find: '@megumi/input', replacement: path.resolve(__dirname, 'packages/input/src') },
  { find: '@megumi/instructions', replacement: path.resolve(__dirname, 'packages/instructions/src') },
  { find: '@megumi/observability', replacement: path.resolve(__dirname, 'packages/observability/src') },
  { find: '@megumi/permissions', replacement: path.resolve(__dirname, 'packages/permissions/src') },
  { find: '@megumi/product', replacement: path.resolve(__dirname, 'packages/product/src') },
  { find: '@megumi/projections', replacement: path.resolve(__dirname, 'packages/projections/src') },
  { find: '@megumi/session', replacement: path.resolve(__dirname, 'packages/session/src') },
  { find: '@megumi/settings', replacement: path.resolve(__dirname, 'packages/settings/src') },
  { find: '@megumi/skills', replacement: path.resolve(__dirname, 'packages/skills/src') },
  { find: '@megumi/tools', replacement: path.resolve(__dirname, 'packages/tools/src') },
  { find: '@megumi/workspace', replacement: path.resolve(__dirname, 'packages/workspace/src') },
];
