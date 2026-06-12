// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ModelStepInputBuildService } from '@megumi/desktop/main/services/session/model-step-input-build.service';
import type { AgentInstructionSourceSnapshot } from '@megumi/shared/model';
import type { PermissionModeSnapshot } from '@megumi/shared/permission';
import type { SessionContextInput, SessionMessage } from '@megumi/shared/session';
import type { ToolDefinition } from '@megumi/shared/tool';

const builtAt = '2026-06-12T00:00:00.000Z';

describe('ModelStepInputBuildService', () => {
  it('builds a ModelInputContext through ModelInputContextBuildRequest with effective cwd and capability summary', async () => {
    const instructionSources: AgentInstructionSourceSnapshot[] = [{
      sourceId: 'project-instruction:AGENTS.md',
      sourceKind: 'project_instruction',
      status: 'included',
      sourceUri: 'project-instruction://AGENTS.md',
      relativePath: 'AGENTS.md',
      text: '# Rules\nUse tests.',
      loadedAt: builtAt,
      sizeBytes: 18,
      includedBytes: 18,
      hardCapBytes: 65536,
      truncated: false,
    }];
    const loadInstructionSources = vi.fn(async () => instructionSources);
    const toolDefinitions = [toolDefinition('read_file', ['project_read']), toolDefinition('run_command', ['command_run'])];
    const service = new ModelStepInputBuildService({
      instructionSourceService: { loadInstructionSources },
      idFactory: {
        buildRequestId: () => 'model-input-build:test',
        traceId: () => 'trace:model-input:test',
      },
    });

    const result = await service.buildModelStepInput({
      requestId: 'request:1',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
      contextKind: 'initial',
      providerId: 'openai-compatible',
      modelId: 'deepseek-chat',
      modelContextWindow: 8192,
      projectId: 'project:1',
      projectRoot: 'C:/all/work/study/megumi',
      requestedCwd: 'packages/context-management',
      permissionMode: 'default',
      permissionSnapshot: permissionSnapshot(),
      permissionSnapshotRef: 'permission-snapshot:1',
      currentMessage: userMessage(),
      sessionContext: sessionContext(),
      toolDefinitions,
      builtAt,
    });

    expect(loadInstructionSources).toHaveBeenCalledWith({
      projectRoot: 'C:/all/work/study/megumi',
      effectiveCwd: expect.stringContaining('packages'),
      loadedAt: builtAt,
    });
    expect(result.buildRequest).toMatchObject({
      requestId: 'model-input-build:test',
      contextId: 'model-input-context:step:1:initial',
      sessionId: 'session:1',
      runId: 'run:1',
      modelStepId: 'step:1',
      projectId: 'project:1',
      projectRoot: 'C:/all/work/study/megumi',
      permissionMode: 'default',
      permissionSnapshotRef: 'permission-snapshot:1',
      availableToolsRef: 'tool-definitions:run:1',
      traceId: 'trace:model-input:test',
    });
    expect(result.buildRequest.effectiveCwd).toContain('packages');
    expect(result.buildRequest.availableCapabilitySummary).toBe(
      'Available tools: read_file (project_read), run_command (command_run).',
    );
    expect(result.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'instruction',
        instructionKind: 'project',
        text: expect.stringContaining('# Rules'),
      }),
      expect.objectContaining({
        kind: 'runtime_constraint',
        constraintKind: 'available_capability_summary',
        text: 'Available tools: read_file (project_read), run_command (command_run).',
      }),
      expect.objectContaining({
        kind: 'current_turn',
        text: 'Review this package.',
      }),
    ]));
    expect(result.toolDefinitions).toEqual(toolDefinitions);
  });

  it('does not let tool-local cwd change run-level effective cwd', async () => {
    const service = new ModelStepInputBuildService({
      instructionSourceService: { loadInstructionSources: vi.fn(async () => []) },
      idFactory: {
        buildRequestId: () => 'model-input-build:cwd',
        traceId: () => 'trace:model-input:cwd',
      },
    });

    const result = await service.buildModelStepInput({
      requestId: 'request:1',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
      contextKind: 'tool-continuation',
      providerId: 'openai-compatible',
      modelId: 'deepseek-chat',
      projectRoot: 'C:/all/work/study/megumi',
      requestedCwd: 'packages/core',
      permissionMode: 'default',
      sessionContext: {},
      toolDefinitions: [],
      toolCalls: [{
        toolCallId: 'tool-call:1',
        runId: 'run:1',
        modelStepId: 'step:previous',
        providerToolCallId: 'call_1',
        toolName: 'run_command',
        input: { command: 'pwd', cwd: 'packages/ai' },
        inputPreview: {
          summary: 'run_command pwd',
          targets: [],
          redactionState: 'none',
        },
        status: 'completed',
        createdAt: builtAt,
      }],
      builtAt,
    });

    expect(result.effectiveCwd?.projectRelativePath).toBe('packages/core');
    expect(result.buildRequest.effectiveCwd).toContain('packages');
    expect(result.buildRequest.effectiveCwd).not.toContain('packages/ai');
  });

  it('rejects requested cwd outside the project before loading instructions', async () => {
    const loadInstructionSources = vi.fn(async () => []);
    const service = new ModelStepInputBuildService({
      instructionSourceService: { loadInstructionSources },
    });

    await expect(service.buildModelStepInput({
      requestId: 'request:1',
      sessionId: 'session:1',
      runId: 'run:1',
      stepId: 'step:1',
      contextKind: 'initial',
      providerId: 'openai-compatible',
      modelId: 'deepseek-chat',
      projectRoot: 'C:/all/work/study/megumi',
      requestedCwd: '../outside',
      permissionMode: 'default',
      sessionContext: {},
      toolDefinitions: [],
      builtAt,
    })).rejects.toThrow(/Effective cwd is outside the project/);
    expect(loadInstructionSources).not.toHaveBeenCalled();
  });
});

function userMessage(): SessionMessage {
  return {
    messageId: 'message:1',
    sessionId: 'session:1',
    runId: 'run:1',
    role: 'user',
    content: 'Review this package.',
    status: 'completed',
    createdAt: builtAt,
    completedAt: builtAt,
  };
}

function sessionContext(): SessionContextInput {
  return {
    historyEntries: [],
    runtimeFacts: [],
    summaryEntries: [],
    maxHistoryEntries: 24,
  };
}

function permissionSnapshot(): PermissionModeSnapshot {
  return {
    permissionMode: 'default',
    source: 'user',
    createdAt: builtAt,
  };
}

function toolDefinition(name: string, capabilities: ToolDefinition['capabilities']): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    capabilities,
    riskLevel: 'low',
    sideEffect: 'none',
    availability: { status: 'available' },
  };
}
