// Desktop adapter for Coding Agent run context resources.
import { readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { composeDesktopPersistence } from '@megumi/desktop/main/persistence';
import type { RunContextRepository } from '@megumi/desktop/main/persistence/repos/run-context.repo';
import {
  RunContextService,
  type ListWorkspaceSourcesInput,
  type RunContextServiceClock,
  type RunContextServiceOptions,
} from '@megumi/coding-agent/resources';
import type { RunContextSource } from '@megumi/shared/run';
import type { MegumiHomePaths } from '../project/megumi-home.service';

export {
  RunContextService,
};
export type {
  ListWorkspaceSourcesInput,
  RunContextServiceClock,
  RunContextServiceOptions,
};

const BLOCKED_FILE_NAMES = new Set(['.env', '.env.local', '.env.production']);

export function createDefaultRunContextService(
  homePaths: MegumiHomePaths,
  options: { repository?: RunContextRepository } = {},
): RunContextService {
  const contextRepository = options.repository ?? composeDesktopPersistence(homePaths).runContextRepository;

  return new RunContextService({
    contextRepository,
    workspaceSourceProvider: {
      listWorkspaceSources(input) {
        return listDesktopWorkspaceSources(input);
      },
    },
  });
}

function listDesktopWorkspaceSources(input: ListWorkspaceSourcesInput & { loadedAt: string }): RunContextSource[] {
  const root = path.resolve(input.workspacePath);
  const entries = readdirSync(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry): RunContextSource => {
      const relativePath = entry.name;
      const fullPath = path.join(root, relativePath);
      const stat = statSync(fullPath);
      const blocked = BLOCKED_FILE_NAMES.has(entry.name) || entry.name.endsWith('.key');

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
}
