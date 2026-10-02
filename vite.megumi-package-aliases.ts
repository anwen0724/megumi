/* Resolves the three source workspace packages during development and builds. */
import path from 'node:path';
import type { AliasOptions } from 'vite';

export const megumiPackageAliases: AliasOptions = [
  { find: '@megumi/ai', replacement: path.resolve(__dirname, 'packages/ai/src') },
  { find: '@megumi/agent-runtime', replacement: path.resolve(__dirname, 'packages/agent-runtime/src') },
  { find: '@megumi/application', replacement: path.resolve(__dirname, 'packages/application/src') },
];
