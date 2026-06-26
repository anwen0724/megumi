// Lists workspace files as run context sources from the local filesystem.
// This is the product's default workspace source provider: it materializes file
// metadata (not contents) under a workspace root and marks secret-like files as
// blocked so they are redacted before any context materialization.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { RunContextSource } from '@megumi/shared/run';
import type { WorkspaceSourceProviderPort } from '../../../run/context/resources/run-context-service';

const BLOCKED_FILE_NAMES = new Set(['.env', '.env.local', '.env.production']);

function isBlockedFileName(name: string): boolean {
  return BLOCKED_FILE_NAMES.has(name) || name.endsWith('.key');
}

export function createLocalWorkspaceSourceProvider(): WorkspaceSourceProviderPort {
  return {
    listWorkspaceSources(input): RunContextSource[] {
      const root = path.resolve(input.workspacePath);
      const entries = readdirSync(root, { withFileTypes: true });

      return entries
        .filter((entry) => entry.isFile())
        .map((entry): RunContextSource => {
          const relativePath = entry.name;
          const fullPath = path.join(root, relativePath);
          const stat = statSync(fullPath);
          const blocked = isBlockedFileName(entry.name);

          return {
            sourceId: `source:${input.runId}:${relativePath}`,
            sourceKind: 'workspace_file',
            sourceUri: `workspace://${input.workspaceId}/${relativePath}`,
            workspaceId: input.workspaceId,
            workspacePath: root,
            relativePath,
            mtime: stat.mtime.toISOString(),
            loadedAt: input.loadedAt,
            freshness: 'fresh',
            redactionState: blocked ? 'blocked' : 'none',
            selectionReason: blocked ? 'context_policy' : 'agent_requested',
            metadata: {
              runId: input.runId,
              sizeBytes: stat.size,
              contentLoaded: false,
            },
          };
        });
    },
  };
}
