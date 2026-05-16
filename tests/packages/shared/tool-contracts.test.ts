import { describe, expect, it } from 'vitest';
import {
  TOOL_CAPABILITIES,
  TOOL_CALL_STATUSES,
  ToolDefinitionSchema,
  ToolCallSchema,
  ToolObservationSchema,
  ToolPolicyDecisionSchema,
  ApprovalRequestSchema,
  SandboxRequirementSchema,
} from '@megumi/shared/tool-contracts';

describe('tool-contracts', () => {
  it('accepts Claude-compatible snake_case tool definitions with JSON Schema', () => {
    const definition = ToolDefinitionSchema.parse({
      name: 'workspace_read_file',
      title: 'Read file',
      description: 'Read a normal workspace file when it is useful for the current task.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string' },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      capabilities: ['workspace_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      availability: { status: 'available' },
    });

    expect(definition.name).toBe('workspace_read_file');
    expect(definition.inputSchema.type).toBe('object');
  });

  it('rejects dotted tool names', () => {
    expect(() => ToolDefinitionSchema.parse({
      name: 'workspace.file.read',
      description: 'Invalid dotted name.',
      inputSchema: { type: 'object' },
      capabilities: ['workspace_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      availability: { status: 'available' },
    })).toThrow(/Tool name/);
  });

  it('defines tool lifecycle contracts without recoverable errors', () => {
    expect(TOOL_CAPABILITIES).toContain('workspace_read');
    expect(TOOL_CALL_STATUSES).toContain('waiting_for_approval');

    const call = ToolCallSchema.parse({
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      stepId: 'step-1',
      actionId: 'action-1',
      toolName: 'workspace_read_file',
      input: { path: 'src/index.ts' },
      inputPreview: {
        summary: 'Read src/index.ts',
        targets: [{ kind: 'file', label: 'src/index.ts', sensitivity: 'normal' }],
        redactionState: 'none',
      },
      capabilities: ['workspace_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      status: 'requested',
      requestedAt: '2026-05-16T00:00:00.000Z',
    });

    expect(call.toolName).toBe('workspace_read_file');

    const observation = ToolObservationSchema.parse({
      observationId: 'observation-1',
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      stepId: 'step-1',
      status: 'failed',
      summary: 'Tool failed.',
      error: {
        code: 'tool_execution_failed',
        message: 'Tool failed.',
        severity: 'error',
        retryable: false,
        source: 'tool',
      },
      createdAt: '2026-05-16T00:00:01.000Z',
    });

    expect(observation.error).not.toHaveProperty('recoverable');
  });

  it('parses policy, approval, and sandbox records', () => {
    expect(ToolPolicyDecisionSchema.parse({
      decision: 'ask',
      reason: 'Workspace write requires approval.',
      effectiveRiskLevel: 'medium',
      requiredApproval: {
        scope: 'once',
        reason: 'User must approve this write.',
      },
      requiredSandbox: {
        level: 'workspace_write',
        allowedRoots: ['C:/all/work/study/megumi'],
        networkPolicy: 'deny',
      },
      evaluatedAt: '2026-05-16T00:00:00.000Z',
    }).decision).toBe('ask');

    expect(ApprovalRequestSchema.parse({
      approvalRequestId: 'approval-1',
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      stepId: 'step-1',
      actionKind: 'call_tool',
      toolName: 'workspace_write_file',
      capabilities: ['workspace_write'],
      riskLevel: 'medium',
      title: 'Approve workspace write',
      summary: 'Write file in workspace.',
      preview: {
        action: 'Write file',
        targets: [{ kind: 'file', label: 'src/index.ts', sensitivity: 'normal' }],
      },
      requestedScope: 'once',
      status: 'pending',
      createdAt: '2026-05-16T00:00:00.000Z',
    }).status).toBe('pending');

    expect(SandboxRequirementSchema.parse({
      level: 'restricted_command',
      allowedRoots: ['C:/all/work/study/megumi'],
      deniedCommands: ['rm -rf'],
      networkPolicy: 'deny',
      timeoutMs: 120000,
    }).level).toBe('restricted_command');
  });
});
