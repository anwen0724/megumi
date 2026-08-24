/*
 * Keeps local Megumi Workspace Packages on source paths during Vite development and builds.
 */
import path from 'node:path';
import type { AliasOptions } from 'vite';

export const megumiPackageAliases: AliasOptions = [
  { find: '@megumi/database/schema', replacement: path.resolve(__dirname, 'packages/agent/database/src/database-schema.ts') },
  { find: '@megumi/session/attachment-store', replacement: path.resolve(__dirname, 'packages/agent/session/src/session-attachment.ts') },
  { find: '@megumi/session/store', replacement: path.resolve(__dirname, 'packages/agent/session/src/session-store.ts') },
  { find: '@megumi/settings/store', replacement: path.resolve(__dirname, 'packages/agent/settings/src/settings-store.ts') },
  { find: '@megumi/workspace/node', replacement: path.resolve(__dirname, 'packages/agent/workspace/src/node-workspace-file-system.ts') },
  { find: '@megumi/workspace/store', replacement: path.resolve(__dirname, 'packages/agent/workspace/src/workspace-store.ts') },
  { find: '@megumi/agent-core', replacement: path.resolve(__dirname, 'packages/agent-core/src') },
  { find: '@megumi/ai', replacement: path.resolve(__dirname, 'packages/ai/src') },
  { find: '@megumi/commands', replacement: path.resolve(__dirname, 'packages/agent/commands/src') },
  { find: '@megumi/context', replacement: path.resolve(__dirname, 'packages/agent/context/src') },
  { find: '@megumi/database', replacement: path.resolve(__dirname, 'packages/agent/database/src') },
  { find: '@megumi/discovery', replacement: path.resolve(__dirname, 'packages/agent/discovery/src') },
  { find: '@megumi/events', replacement: path.resolve(__dirname, 'packages/agent/events/src') },
  { find: '@megumi/input', replacement: path.resolve(__dirname, 'packages/agent/input/src') },
  { find: '@megumi/instructions', replacement: path.resolve(__dirname, 'packages/agent/instructions/src') },
  { find: '@megumi/observability', replacement: path.resolve(__dirname, 'packages/agent/observability/src') },
  { find: '@megumi/permissions', replacement: path.resolve(__dirname, 'packages/agent/permissions/src') },
  { find: '@megumi/product-host', replacement: path.resolve(__dirname, 'packages/agent/product-host/src') },
  { find: '@megumi/session', replacement: path.resolve(__dirname, 'packages/agent/session/src') },
  { find: '@megumi/settings', replacement: path.resolve(__dirname, 'packages/agent/settings/src') },
  { find: '@megumi/skills', replacement: path.resolve(__dirname, 'packages/agent/skills/src') },
  { find: '@megumi/tools', replacement: path.resolve(__dirname, 'packages/agent/tools/src') },
  { find: '@megumi/workspace', replacement: path.resolve(__dirname, 'packages/agent/workspace/src') },
];
