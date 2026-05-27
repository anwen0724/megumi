import { describe, expect, it } from 'vitest';
import { buildModelStepInputContextFromSources, createModelStepInputContextId } from '@megumi/context-management';
import type { RunContext } from '@megumi/shared/run-context-contracts';
import type { SessionMessage } from '@megumi/shared/session-run-contracts';
import type { ModelStepProviderState } from '@megumi/shared/model-step-contracts';
import type { ToolResult, ToolUse } from '@megumi/shared/tool-contracts';

const builtAt = '2026-05-27T00:00:00.000Z';

function message(overrides: Partial<SessionMessage>): SessionMessage {
  return {
    messageId: 'message:1',
    sessionId: 'session:1',
    runId: 'run:1',
    role: 'user',
    content: 'Current request.',
    status: 'completed',
    createdAt: builtAt,
    completedAt: builtAt,
    ...overrides,
  };
}

function runContext(): RunContext {
  return {
    contextId: 'run-context:1',
    runId: 'run:1',
    workspaceBoundary: {
      workspaceId: 'workspace:1',
      rootPath: 'C:/all/work/study/megumi',
      symlinkPolicy: 'deny_outside_workspace',
      outsideWorkspacePolicy: 'deny',
      secretPolicySummary: 'No secrets.',
      createdAt: builtAt,
    },
    goal: 'Review context management.',
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
      restrictedResources: [],
      approvalSummary: 'Approval required for writes.',
      sandboxSummary: 'Workspace sandbox.',
    },
    modelCapabilitySummary: {
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      modelContextWindow: 8192,
      reservedOutputTokens: 1024,
      availableInputTokens: 7168,
    },
    budget: {
      modelContextWindow: 8192,
      reservedOutputTokens: 1024,
      availableInputTokens: 7168,
      budgetPolicy: 'balanced',
      packingStrategy: 'priority_then_recent',
      truncationRecords: [],
    },
    buildMetadata: {
      buildReason: 'run_baseline',
      builtAt,
      selectionRecordIds: [],
      redactionRecordIds: [],
      truncationRecordIds: [],
    },
    createdAt: builtAt,
  };
}

function toolUse(): ToolUse {
  return {
    toolUseId: 'tool-use:1',
    runId: 'run:1',
    modelStepId: 'model-step:1',
    providerToolUseId: 'provider-tool-use:1',
    toolName: 'read_file',
    input: { path: 'package.json' },
    inputPreview: {
      summary: 'read_file package.json',
      targets: [],
      redactionState: 'none',
    },
    status: 'created',
    createdAt: builtAt,
  };
}

function toolResult(): ToolResult {
  return {
    toolResultId: 'tool-result:1',
    toolUseId: 'tool-use:1',
    runId: 'run:1',
    kind: 'success',
    textContent: '{"name":"megumi"}',
    redactionState: 'none',
    createdAt: builtAt,
  };
}

function providerState(): ModelStepProviderState {
  return {
    modelStepId: 'model-step:1',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    blocks: [{
      type: 'reasoning_content',
      text: 'Need to read package.json before answering.',
    }],
  };
}

describe('buildModelStepInputContextFromSources', () => {
  it('creates schema-safe context ids from long step ids', () => {
    const contextId = createModelStepInputContextId({
      stepId: `step:${'a'.repeat(124)}`,
      contextKind: 'approval-resume',
    });

    expect(contextId.length).toBeLessThanOrEqual(128);
    expect(contextId).toMatch(/^model-input-context:/);
    expect(contextId).toMatch(/:approval-resume$/);
  });

  it('builds current turn, session, runtime constraint, and tool continuation parts from explicit sources', () => {
    const context = buildModelStepInputContextFromSources({
      contextId: 'model-input-context:1',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:2',
      buildReason: 'tool_continuation',
      builtAt,
      currentMessage: message({
        messageId: 'message:current',
        content: 'Summarize what changed.',
      }),
      historyMessages: [
        message({
          messageId: 'message:history-user',
          content: 'Read package.json.',
        }),
        message({
          messageId: 'message:history-assistant',
          role: 'assistant',
          content: 'I will inspect package.json.',
        }),
      ],
      runContext: runContext(),
      modeSnapshot: {
        permissionMode: 'plan',
        source: 'user',
        createdAt: builtAt,
      },
      modeSnapshotRef: 'mode-snapshot:1',
      toolUses: [toolUse()],
      toolResults: [toolResult()],
      providerStates: [providerState()],
    });

    expect(context.parts.map((part) => part.kind)).toEqual([
      'session',
      'session',
      'runtime_constraint',
      'runtime_constraint',
      'tool_continuation',
      'tool_continuation',
      'tool_continuation',
      'current_turn',
    ]);
    expect(context.parts.at(-1)).toMatchObject({
      kind: 'current_turn',
      role: 'user',
      text: 'Summarize what changed.',
    });
    expect(JSON.stringify(context.parts)).toContain('Permission mode is plan.');
    expect(JSON.stringify(context.parts)).toContain('Project root: C:/all/work/study/megumi');
    expect(JSON.stringify(context.parts)).toContain('Tool result tool-result:1 for tool-use:1');
    expect(JSON.stringify(context.parts)).toContain('Need to read package.json before answering.');
    expect(context.trace.selectedSources.map((source) => source.sourceId)).toEqual(expect.arrayContaining([
      'session-message:message:history-user',
      'run-context:run-context:1:project-boundary',
      'permission-mode:mode-snapshot:1',
      'tool-use:tool-use:1',
      'tool-result:tool-result:1',
      'provider-state:model-step:1:0',
      'session-message:message:current',
    ]));
  });

  it('does not include raw runtime trace metadata as model-visible text', () => {
    const context = buildModelStepInputContextFromSources({
      contextId: 'model-input-context:2',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
      buildReason: 'initial_model_step',
      builtAt,
      currentMessage: message({ messageId: 'message:current' }),
    });

    const serialized = JSON.stringify(context.parts);
    expect(serialized).toContain('Current request.');
    expect(serialized).not.toContain('traceId');
    expect(serialized).not.toContain('debugId');
    expect(serialized).not.toContain('raw provider body');
  });

  it('stores provider-native tool replay fields in tool continuation parts', () => {
    const context = buildModelStepInputContextFromSources({
      contextId: 'model-input-context:tool-replay',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:2',
      buildReason: 'tool_continuation',
      builtAt,
      toolUses: [toolUse()],
      toolResults: [toolResult()],
      providerStates: [providerState()],
    });

    expect(context.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool_continuation',
        toolUseId: 'tool-use:1',
        providerToolUseId: 'provider-tool-use:1',
        modelStepId: 'model-step:1',
        toolName: 'read_file',
        toolInput: { path: 'package.json' },
      }),
      expect.objectContaining({
        kind: 'tool_continuation',
        toolUseId: 'tool-use:1',
        toolResultId: 'tool-result:1',
        toolResultContent: '{"name":"megumi"}',
      }),
      expect.objectContaining({
        kind: 'tool_continuation',
        modelStepId: 'model-step:1',
        providerStateText: 'Need to read package.json before answering.',
      }),
    ]));
  });
});
