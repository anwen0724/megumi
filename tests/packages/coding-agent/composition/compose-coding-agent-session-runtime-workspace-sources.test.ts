// @vitest-environment node
// Verifies the composed session runtime wires a default workspace source provider
// so runContextService.listWorkspaceSources returns real files without any UI shell
// injecting a provider (the latent empty-sourcesList gap).
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { composeCodingAgentPersistence, composeCodingAgentSessionRuntime } from '@megumi/coding-agent/composition';
import { composeCodingAgentToolRegistryService } from '@megumi/coding-agent/composition';

function noopMemoryRuntime() {
  return {
    recallService: undefined,
    captureService: undefined,
    memorySettingsProvider: { isMemoryEnabled: () => false },
    markdownSyncService: undefined,
  } as never;
}

describe('composed session runtime workspace sources', () => {
  let home: string | undefined;

  afterEach(async () => {
    if (home) {
      await rm(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  it('lists workspace files through the default product workspace source provider', async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'megumi-session-workspace-'));
    await writeFile(path.join(home, 'notes.md'), 'notes', 'utf8');

    const persistence = composeCodingAgentPersistence({ sqlitePath: home });
    try {
      const agentLoopRepository = persistence.agentLoopRepository as any;
      const sessionRepository = persistence.sessionRepository as any;
      const workspace = persistence.workspaceRepository.upsertFromRepoPath({
        repoPath: home,
        now: '2026-06-24T00:00:00.000Z',
      });
      const runtime = composeCodingAgentSessionRuntime({
        homePaths: { homePath: home, sqlitePath: home, settingsPath: path.join(home, 'settings.json') },
        runtimeLogger: { warn: () => undefined },
        artifactRepository: persistence.artifactRepository,
        agentLoopRepository,
        sessionRepository,
        toolCallRepository: persistence.toolCallRepository,
        workspaceChangeRepository: persistence.workspaceChangeRepository,
        toolRegistry: composeCodingAgentToolRegistryService(),
        modelCallProviderService: {
          streamModelCall: async function* () {},
          completeModelCall: async () => ({ ok: true, text: '' }),
          cancelModelCall: () => false,
        } as never,
        toolRuntimeFactory: (() => undefined) as never,
        memoryRuntime: noopMemoryRuntime(),
      });

      const session = sessionRepository.saveSession({
        sessionId: 'session-1',
        title: 'Session',
        workspaceId: workspace.projectId,
        workspacePath: home,
        status: 'active',
        createdAt: '2026-06-24T00:00:00.000Z',
        updatedAt: '2026-06-24T00:00:00.000Z',
      });
      agentLoopRepository.saveRun({
        runId: 'run-1',
        sessionId: String(session.sessionId),
        mode: 'default',
        goal: 'list sources',
        status: 'running',
        createdAt: '2026-06-24T00:00:00.000Z',
        startedAt: '2026-06-24T00:00:00.000Z',
      });

      const sources = runtime.runContextService.listWorkspaceSources({
        runId: 'run-1',
        workspaceId: workspace.projectId,
        workspacePath: home,
      });

      expect(sources.length).toBeGreaterThan(0);
      expect(sources.some((source) => source.relativePath === 'notes.md')).toBe(true);
    } finally {
      persistence.database.close();
    }
  });
});
