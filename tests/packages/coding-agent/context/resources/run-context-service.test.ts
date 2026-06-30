// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createBaselineContextForSession,
  RunContextService,
  type RunContextSourceStorePort,
  type WorkspaceSourceProviderPort,
} from '@megumi/coding-agent/context/resources';
import type { RunContext, RunContextSource } from '@megumi/shared/run';

function createInMemoryRepository(): RunContextSourceStorePort {
  const baselines = new Map<string, RunContext>();
  const sourceRefs: Array<RunContextSource & { runId: string }> = [];

  return {
    saveBaseline(context) { baselines.set(context.contextId, context); return context; },
    getBaseline(contextId) { return baselines.get(contextId); },
    saveSourceRef(source) { sourceRefs.push(source); return source; },
  };
}

function createService(
  rootPath: string,
  workspaceSourceProvider?: WorkspaceSourceProviderPort,
) {
  const repository = createInMemoryRepository();

  const service = new RunContextService({
    contextRepository: repository,
    clock: { now: () => '2026-05-15T00:00:02.000Z' },
    ...(workspaceSourceProvider ? { workspaceSourceProvider } : {}),
  });

  return { service, repository };
}

describe('RunContextService', () => {
  it('creates baseline context for a workspace-backed session through the context owner helper', () => {
    const { service } = createService('C:/all/work/study/megumi');

    const context = createBaselineContextForSession({
      contextService: service,
      runId: 'run-1',
      goal: 'Read context',
      session: {
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        workspacePath: 'C:/all/work/study/megumi',
      },
    });

    expect(context?.runId).toBe('run-1');
    expect(context?.goal).toBe('Read context');
    expect(context?.workspaceBoundary).toMatchObject({
      workspaceId: 'workspace-1',
      rootPath: 'C:/all/work/study/megumi',
    });
  });

  it('skips baseline context for sessions without a workspace path', () => {
    const { service } = createService('C:/all/work/study/megumi');

    expect(createBaselineContextForSession({
      contextService: service,
      runId: 'run-1',
      goal: 'Read context',
      session: {
        sessionId: 'session-1',
      },
    })).toBeUndefined();
    expect(createBaselineContextForSession({
      runId: 'run-1',
      goal: 'Read context',
      session: {
        sessionId: 'session-1',
        workspacePath: 'C:/all/work/study/megumi',
      },
    })).toBeUndefined();
  });

  it('creates baseline context with safe workspace boundary', () => {
    const { service } = createService('C:/all/work/study/megumi');

    const context = service.createBaselineContext({
      runId: 'run-1',
      goal: 'Read context',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/all/work/study/megumi',
      modelCapabilitySummary: {
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        modelContextWindow: 64000,
      },
      contextBudgetPolicy: {
        modelContextWindow: 64000,
        reservedOutputTokens: 4096,
        keepRecentTokens: 59904,
      },
    });

    expect(context.workspaceBoundary).toMatchObject({
      workspaceId: 'workspace-1',
      rootPath: 'C:/all/work/study/megumi',
      outsideWorkspacePolicy: 'deny',
    });
    expect(context.contextBudgetPolicy).toEqual({
      modelContextWindow: 64000,
      reservedOutputTokens: 4096,
      keepRecentTokens: 59904,
    });
    expect(context).not.toHaveProperty('budget');
    expect(JSON.stringify(context)).not.toContain('sk-test');
  });

  it('lists workspace sources from provider without returning raw file content', () => {
    const fakeSourceProvider: WorkspaceSourceProviderPort = {
      listWorkspaceSources(_input) {
        return [
          {
            sourceId: 'source:run-1:README.md',
            sourceKind: 'workspace_file',
            sourceUri: 'workspace://workspace-1/README.md',
            workspaceId: 'workspace-1',
            workspacePath: _input.workspacePath,
            relativePath: 'README.md',
            mtime: '2026-05-15T00:00:00.000Z',
            loadedAt: _input.loadedAt,
            freshness: 'fresh',
            redactionState: 'none',
            selectionReason: 'agent_requested',
            metadata: { runId: 'run-1', sizeBytes: 100, contentLoaded: false },
          },
          {
            sourceId: 'source:run-1:.env',
            sourceKind: 'workspace_file',
            sourceUri: 'workspace://workspace-1/.env',
            workspaceId: 'workspace-1',
            workspacePath: _input.workspacePath,
            relativePath: '.env',
            mtime: '2026-05-15T00:00:00.000Z',
            loadedAt: _input.loadedAt,
            freshness: 'fresh',
            redactionState: 'blocked',
            selectionReason: 'context_policy',
            metadata: { runId: 'run-1', sizeBytes: 50, contentLoaded: false },
          },
        ];
      },
    };

    const { service } = createService('C:/all/work/study/megumi', fakeSourceProvider);

    service.createBaselineContext({
      runId: 'run-1',
      goal: 'Read context',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/all/work/study/megumi',
      modelCapabilitySummary: {
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        modelContextWindow: 64000,
      },
      contextBudgetPolicy: {
        modelContextWindow: 64000,
        reservedOutputTokens: 4096,
        keepRecentTokens: 59904,
      },
    });

    const sources = service.listWorkspaceSources({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/all/work/study/megumi',
    });

    expect(sources.map((source) => source.relativePath)).toContain('README.md');
    expect(sources.find((source) => source.relativePath === '.env')?.redactionState).toBe('blocked');
    expect(JSON.stringify(sources)).not.toContain('sk-test-1234567890abcdef');
  });
});
