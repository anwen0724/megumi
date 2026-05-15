// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentContext, ContextSourceRef } from '@megumi/shared/agent-context-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { useAgentContextStore } from '@megumi/desktop/renderer/entities/agent-context/store';

const createdAt = '2026-05-15T00:00:00.000Z';

function context(): AgentContext {
  return {
    contextId: 'context-1',
    runId: 'run-1',
    workspaceBoundary: {
      workspaceId: 'workspace-1',
      rootPath: 'C:/all/work/study/megumi',
      symlinkPolicy: 'deny_outside_workspace',
      outsideWorkspacePolicy: 'deny',
      secretPolicySummary: 'Secret files are blocked.',
      createdAt,
    },
    goal: 'Use context',
    constraints: [],
    inlineContents: [],
    resourceRefs: [],
    conversationRefs: [],
    messageSummaries: [],
    workspaceSources: [],
    toolObservationRefs: [],
    memoryRecallRefs: [],
    policySummary: {
      workspaceAccess: 'workspace-read',
      restrictedResources: ['.env'],
      approvalSummary: 'No approval implied.',
      sandboxSummary: 'Read-only.',
    },
    modelCapabilitySummary: {
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      modelContextWindow: 64000,
      reservedOutputTokens: 4096,
      availableInputTokens: 59904,
    },
    budget: {
      modelContextWindow: 64000,
      reservedOutputTokens: 4096,
      availableInputTokens: 59904,
      budgetPolicy: 'balanced',
      packingStrategy: 'priority_then_recent',
      truncationRecords: [],
    },
    buildMetadata: {
      buildReason: 'run_baseline',
      builtAt: createdAt,
      selectionRecordIds: [],
      redactionRecordIds: [],
      truncationRecordIds: [],
    },
    createdAt,
  };
}

const source: ContextSourceRef = {
  sourceId: 'source-1',
  sourceKind: 'workspace_file',
  sourceUri: 'workspace://workspace-1/README.md',
  workspaceId: 'workspace-1',
  relativePath: 'README.md',
  loadedAt: createdAt,
  freshness: 'fresh',
  redactionState: 'none',
  selectionReason: 'agent_requested',
};

describe('useAgentContextStore', () => {
  beforeEach(() => {
    useAgentContextStore.getState().clearContext();
  });

  it('stores baseline context and source refs by run', () => {
    useAgentContextStore.getState().setBaseline('run-1', context());
    useAgentContextStore.getState().setSources('run-1', [source]);

    expect(useAgentContextStore.getState().baselineByRun['run-1']?.contextId).toBe('context-1');
    expect(useAgentContextStore.getState().sourcesByRun['run-1'][0]?.relativePath).toBe('README.md');
  });

  it('records context runtime events without raw prompt content', () => {
    const event: RuntimeEvent = {
      eventId: 'event-1',
      schemaVersion: 1,
      eventType: 'context.effective.updated',
      runId: 'run-1',
      sequence: 1,
      createdAt,
      source: 'core',
      visibility: 'debug',
      persist: 'required',
      payload: {
        contextId: 'context-1',
        effectiveContextBuildId: 'build-1',
        sourceCount: 1,
        redactionCount: 0,
        truncationCount: 0,
      },
    };

    useAgentContextStore.getState().applyRuntimeEvent(event);

    expect(useAgentContextStore.getState().contextEventsByRun['run-1']).toEqual([event]);
    expect(JSON.stringify(useAgentContextStore.getState())).not.toContain('raw full prompt');
  });
});
