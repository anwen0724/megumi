import { describe, expect, it } from 'vitest';
import { buildModelStepInputContextFromSources, createModelStepInputContextId } from '@megumi/context-management';
import type { RunContext } from '@megumi/shared/run-context-contracts';
import type { SessionContextInput } from '@megumi/shared/session-context-contracts';
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

function sessionSourceRef(sourceId: string) {
  return {
    sourceId,
    sourceKind: 'session_message' as const,
    sourceUri: `session-message://${sourceId}`,
    loadedAt: builtAt,
  };
}

function sessionContextInput(): SessionContextInput {
  return {
    historyEntries: [
      {
        entryId: 'history:user-goal',
        role: 'user',
        text: '07.03 should focus on Session Context.',
        status: 'completed',
        sourceRef: sessionSourceRef('session-message:user-goal'),
        createdAt: builtAt,
        completedAt: builtAt,
      },
      {
        entryId: 'history:assistant-old-wrong',
        role: 'assistant',
        text: 'We can implement long-term memory now.',
        status: 'completed',
        sourceRef: sessionSourceRef('session-message:assistant-old-wrong'),
        createdAt: builtAt,
        completedAt: builtAt,
      },
      {
        entryId: 'history:user-correction',
        role: 'user',
        text: 'Do not implement long-term memory in this phase.',
        status: 'completed',
        sourceRef: sessionSourceRef('session-message:user-correction'),
        createdAt: builtAt,
        completedAt: builtAt,
      },
      {
        entryId: 'history:assistant-failed',
        role: 'assistant',
        text: 'Partial failed answer must not appear.',
        status: 'failed',
        sourceRef: sessionSourceRef('session-message:assistant-failed'),
        createdAt: builtAt,
      },
    ],
    runtimeFacts: [
      {
        factId: 'fact:run-failed',
        factKind: 'run_failed',
        text: 'Previous run failed before final answer.',
        sourceRef: {
          sourceId: 'session-run:failed',
          sourceKind: 'session_run',
          sourceUri: 'session-run://failed',
          loadedAt: builtAt,
        },
        severity: 'error',
        createdAt: builtAt,
      },
      {
        factId: 'fact:tool-result',
        factKind: 'tool_result',
        text: 'Focused tests passed: 46 tests.',
        sourceRef: {
          sourceId: 'tool-result:focused-tests',
          sourceKind: 'tool_result',
          sourceUri: 'tool-result://focused-tests',
          loadedAt: builtAt,
        },
        severity: 'info',
        createdAt: builtAt,
      },
    ],
    summaryEntries: [
      {
        summaryId: 'summary:explicit',
        summaryKind: 'explicit',
        text: 'Earlier discussion selected short-term context quality as the stage goal.',
        sourceRef: {
          sourceId: 'session-summary:explicit',
          sourceKind: 'session_summary',
          sourceUri: 'session-summary://explicit',
          loadedAt: builtAt,
        },
        createdAt: builtAt,
      },
    ],
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
      'runtime_constraint',
      'runtime_constraint',
      'session',
      'session',
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
    expect(context.parts.filter((part) => part.kind === 'session').map((part) => part.sessionKind)).toEqual([
      'session_history',
      'session_history',
    ]);
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

  it('keeps legacy historyMessages shim limited to user and assistant chat history', () => {
    const context = buildModelStepInputContextFromSources({
      contextId: 'model-input-context:legacy-history-chat-only',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
      buildReason: 'initial_model_step',
      builtAt,
      historyMessages: [
        message({
          messageId: 'message:legacy-user',
          content: 'Keep the compatibility history narrow.',
        }),
        message({
          messageId: 'message:legacy-assistant',
          role: 'assistant',
          content: 'Only normal assistant text should remain.',
        }),
        message({
          messageId: 'message:legacy-host-tool-result',
          role: 'host',
          content: 'Tool result tool-result:legacy should not become session history.',
        }),
      ],
    });

    const sessionParts = context.parts.filter((part) => part.kind === 'session');

    expect(sessionParts.map((part) => part.text)).toEqual([
      '[user] Keep the compatibility history narrow.',
      '[assistant] Only normal assistant text should remain.',
    ]);
    expect(JSON.stringify(context.parts)).not.toContain(
      'Tool result tool-result:legacy should not become session history.',
    );
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

  it('builds semantic session parts from SessionContextInput before tool continuation and current turn', () => {
    const context = buildModelStepInputContextFromSources({
      contextId: 'model-input-context:session-context',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
      buildReason: 'initial_model_step',
      builtAt,
      runContext: runContext(),
      sessionContext: sessionContextInput(),
      toolUses: [toolUse()],
      toolResults: [toolResult()],
      providerStates: [providerState()],
      currentMessage: message({
        messageId: 'message:current',
        content: 'Continue with 07.03.',
      }),
    });

    expect(context.parts.map((part) => part.kind)).toEqual([
      'runtime_constraint',
      'session',
      'session',
      'session',
      'session',
      'session',
      'session',
      'tool_continuation',
      'tool_continuation',
      'tool_continuation',
      'current_turn',
    ]);
    expect(context.parts.filter((part) => part.kind === 'session').map((part) => part.sessionKind)).toEqual([
      'session_summary',
      'session_history',
      'session_history',
      'session_history',
      'session_runtime_fact',
      'session_runtime_fact',
    ]);
    expect(JSON.stringify(context.parts)).toContain('[user] Do not implement long-term memory in this phase.');
    expect(JSON.stringify(context.parts)).toContain('[run_failed] Previous run failed before final answer.');
    expect(JSON.stringify(context.parts)).toContain('[tool_result] Focused tests passed: 46 tests.');
    expect(JSON.stringify(context.parts)).not.toContain('Partial failed answer must not appear.');
    expect(context.trace.excludedSources).toContainEqual({
      sourceRef: sessionSourceRef('session-message:assistant-failed'),
      reason: 'session_history_status_failed',
    });
  });

  it('keeps tool continuation as provider-native replay parts when session context is present', () => {
    const context = buildModelStepInputContextFromSources({
      contextId: 'model-input-context:session-context-tool-replay',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:2',
      buildReason: 'tool_continuation',
      builtAt,
      sessionContext: sessionContextInput(),
      toolUses: [toolUse()],
      toolResults: [toolResult()],
      providerStates: [providerState()],
    });

    expect(context.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool_continuation',
        toolUseId: 'tool-use:1',
        providerToolUseId: 'provider-tool-use:1',
        toolName: 'read_file',
        toolInput: { path: 'package.json' },
      }),
      expect.objectContaining({
        kind: 'tool_continuation',
        toolUseId: 'tool-use:1',
        toolResultId: 'tool-result:1',
        toolResultContent: '{"name":"megumi"}',
      }),
    ]));
    expect(context.parts.some((part) => (
      part.kind === 'session'
      && part.text.includes('Tool result tool-result:1 for tool-use:1')
    ))).toBe(false);
  });

  it('places project instruction before runtime, session, tool, and current turn parts', () => {
    const context = buildModelStepInputContextFromSources({
      contextId: 'model-input-context:project-instruction',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
      buildReason: 'initial_model_step',
      builtAt,
      instructionSources: [{
        sourceId: 'project-instruction:AGENTS.md',
        sourceKind: 'project_instruction',
        status: 'included',
        sourceUri: 'project://AGENTS.md',
        relativePath: 'AGENTS.md',
        text: '# Project Rules\nUse tests.',
        loadedAt: builtAt,
        sizeBytes: 26,
        includedBytes: 26,
        hardCapBytes: 65536,
        truncated: false,
      }],
      runContext: runContext(),
      historyMessages: [message({ messageId: 'message:history', content: 'Earlier task.' })],
      currentMessage: message({ messageId: 'message:current', content: 'Continue.' }),
      toolUses: [toolUse()],
      toolResults: [toolResult()],
      providerStates: [providerState()],
    });

    expect(context.parts.map((part) => part.kind)).toEqual([
      'instruction',
      'runtime_constraint',
      'session',
      'tool_continuation',
      'tool_continuation',
      'tool_continuation',
      'current_turn',
    ]);
    expect(context.parts[0]).toMatchObject({
      kind: 'instruction',
      instructionKind: 'project',
      priority: 100,
      budgetStatus: 'included_full',
      sourceRefs: [{
        sourceId: 'project-instruction:AGENTS.md',
        sourceKind: 'project_instruction',
        sourceUri: 'project://AGENTS.md',
        loadedAt: builtAt,
        metadata: {
          relativePath: 'AGENTS.md',
          status: 'included',
          sizeBytes: 26,
          includedBytes: 26,
          hardCapBytes: 65536,
          truncated: false,
        },
      }],
    });
    expect(context.parts[0]?.text).toBe([
      'Follow these agent instructions:',
      '',
      '# Project Rules\nUse tests.',
    ].join('\n'));
    expect(context.trace.selectedSources).toContainEqual({
      sourceId: 'project-instruction:AGENTS.md',
      reason: 'instruction',
    });
  });

  it('marks truncated project instruction parts with truncation metadata', () => {
    const context = buildModelStepInputContextFromSources({
      contextId: 'model-input-context:project-instruction-truncated',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
      buildReason: 'initial_model_step',
      builtAt,
      instructionSources: [{
        sourceId: 'project-instruction:AGENTS.md',
        sourceKind: 'project_instruction',
        status: 'included_truncated',
        sourceUri: 'project://AGENTS.md',
        relativePath: 'AGENTS.md',
        text: 'a'.repeat(65536),
        loadedAt: builtAt,
        sizeBytes: 70000,
        includedBytes: 65536,
        hardCapBytes: 65536,
        truncated: true,
        reason: 'project_instruction_hard_cap_exceeded',
      }],
      currentMessage: message({ messageId: 'message:current' }),
    });

    expect(context.parts[0]).toMatchObject({
      kind: 'instruction',
      budgetStatus: 'included_truncated',
      truncation: {
        reason: 'project_instruction_hard_cap_exceeded',
      },
    });
    expect(context.parts[0]?.sourceRefs[0]?.metadata).toMatchObject({
      status: 'included_truncated',
      sizeBytes: 70000,
      includedBytes: 65536,
      hardCapBytes: 65536,
      truncated: true,
    });
    expect(context.trace.selectedSources).toContainEqual({
      sourceId: 'project-instruction:AGENTS.md',
      reason: 'project_instruction_hard_cap_exceeded',
    });
  });

  it('keeps included empty project instructions model-visible and traceable', () => {
    const context = buildModelStepInputContextFromSources({
      contextId: 'model-input-context:project-instruction-empty',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
      buildReason: 'initial_model_step',
      builtAt,
      instructionSources: [{
        sourceId: 'project-instruction:AGENTS.md',
        sourceKind: 'project_instruction',
        status: 'included',
        sourceUri: 'project://AGENTS.md',
        relativePath: 'AGENTS.md',
        text: '',
        loadedAt: builtAt,
        sizeBytes: 0,
        includedBytes: 0,
        hardCapBytes: 65536,
        truncated: false,
      }],
    });

    expect(context.parts).toHaveLength(1);
    expect(context.parts[0]).toMatchObject({
      kind: 'instruction',
      instructionKind: 'project',
      text: [
        'Follow these agent instructions:',
        '',
        '',
      ].join('\n'),
      sourceRefs: [{
        sourceId: 'project-instruction:AGENTS.md',
        sourceKind: 'project_instruction',
        sourceUri: 'project://AGENTS.md',
        loadedAt: builtAt,
        metadata: {
          relativePath: 'AGENTS.md',
          status: 'included',
          sizeBytes: 0,
          includedBytes: 0,
          hardCapBytes: 65536,
          truncated: false,
        },
      }],
    });
    expect(context.trace.selectedSources).toContainEqual({
      sourceId: 'project-instruction:AGENTS.md',
      reason: 'instruction',
    });
  });

  it('records missing, unavailable, and read-failed instruction sources as excluded trace only', () => {
    const context = buildModelStepInputContextFromSources({
      contextId: 'model-input-context:project-instruction-excluded',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
      buildReason: 'initial_model_step',
      builtAt,
      instructionSources: [
        {
          sourceId: 'project-instruction:no-project-root',
          sourceKind: 'project_instruction',
          status: 'unavailable',
          loadedAt: builtAt,
          reason: 'agent_instruction_no_project_root',
        },
        {
          sourceId: 'project-instruction:AGENTS.md',
          sourceKind: 'project_instruction',
          status: 'missing',
          sourceUri: 'project://AGENTS.md',
          relativePath: 'AGENTS.md',
          loadedAt: builtAt,
          reason: 'agent_instruction_missing',
        },
        {
          sourceId: 'project-instruction:AGENTS.md:read-failed',
          sourceKind: 'project_instruction',
          status: 'read_failed',
          sourceUri: 'project://AGENTS.md',
          relativePath: 'AGENTS.md',
          loadedAt: builtAt,
          reason: 'agent_instruction_read_failed',
        },
      ],
      currentMessage: message({ messageId: 'message:current' }),
    });

    expect(context.parts.map((part) => part.kind)).toEqual(['current_turn']);
    expect(context.trace.excludedSources).toEqual([
      {
        sourceRef: {
          sourceId: 'project-instruction:no-project-root',
          sourceKind: 'project_instruction',
          loadedAt: builtAt,
          metadata: {
            status: 'unavailable',
          },
        },
        reason: 'agent_instruction_no_project_root',
      },
      {
        sourceRef: {
          sourceId: 'project-instruction:AGENTS.md',
          sourceKind: 'project_instruction',
          sourceUri: 'project://AGENTS.md',
          loadedAt: builtAt,
          metadata: {
            relativePath: 'AGENTS.md',
            status: 'missing',
          },
        },
        reason: 'agent_instruction_missing',
      },
      {
        sourceRef: {
          sourceId: 'project-instruction:AGENTS.md:read-failed',
          sourceKind: 'project_instruction',
          sourceUri: 'project://AGENTS.md',
          loadedAt: builtAt,
          metadata: {
            relativePath: 'AGENTS.md',
            status: 'read_failed',
          },
        },
        reason: 'agent_instruction_read_failed',
      },
    ]);
    expect(JSON.stringify(context)).not.toContain('raw-stack');
  });

  it('refreshes project instruction parts when rebuilding from a base input context', () => {
    const baseInputContext = buildModelStepInputContextFromSources({
      contextId: 'model-input-context:project-instruction-base',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
      buildReason: 'initial_model_step',
      builtAt,
      instructionSources: [{
        sourceId: 'project-instruction:AGENTS.md',
        sourceKind: 'project_instruction',
        status: 'included',
        sourceUri: 'project://AGENTS.md',
        relativePath: 'AGENTS.md',
        text: '# Old rules',
        loadedAt: builtAt,
        sizeBytes: 11,
        includedBytes: 11,
        hardCapBytes: 65536,
        truncated: false,
      }],
      currentMessage: message({ messageId: 'message:current' }),
    });

    const context = buildModelStepInputContextFromSources({
      baseInputContext,
      contextId: 'model-input-context:project-instruction-continuation',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:2',
      buildReason: 'tool_continuation',
      builtAt,
      instructionSources: [{
        sourceId: 'project-instruction:AGENTS.md',
        sourceKind: 'project_instruction',
        status: 'included',
        sourceUri: 'project://AGENTS.md',
        relativePath: 'AGENTS.md',
        text: '# New rules',
        loadedAt: '2026-05-27T00:01:00.000Z',
        sizeBytes: 11,
        includedBytes: 11,
        hardCapBytes: 65536,
        truncated: false,
      }],
      toolUses: [toolUse()],
    });

    expect(context.parts.map((part) => part.kind)).toEqual([
      'instruction',
      'current_turn',
      'tool_continuation',
    ]);
    expect(JSON.stringify(context.parts)).toContain('# New rules');
    expect(JSON.stringify(context.parts)).not.toContain('# Old rules');
  });
});
