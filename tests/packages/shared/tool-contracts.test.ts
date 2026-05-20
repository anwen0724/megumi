import { describe, expect, it } from 'vitest';
import {
  APPROVAL_SCOPES,
  COMMAND_CLASSIFIER_LABELS,
  PERMISSION_DECISION_SOURCES,
  PERMISSION_RULE_SCOPES,
  SANDBOX_LEVELS,
  TOOL_CAPABILITIES,
  TOOL_CALL_STATUSES,
  TOOL_POLICY_DECISIONS,
  TOOL_RESULT_KINDS,
  TOOL_SIDE_EFFECTS,
  TOOL_USE_STATUSES,
  ApprovalRequestSchema,
  PermissionDecisionSchema,
  SandboxRequirementSchema,
  ToolCallSchema,
  ToolDefinitionSchema,
  ToolResultSchema,
  ToolUseSchema,
} from '@megumi/shared/tool-contracts';

describe('tool-contracts', () => {
  it('defines 05 target capabilities and side effects with project terminology', () => {
    expect(TOOL_CAPABILITIES).toEqual([
      'project_read',
      'project_write',
      'command_run',
      'network_access',
      'browser_access',
      'mcp_tool',
      'secret_read',
      'system_integration',
      'external_app',
    ]);
    expect(TOOL_SIDE_EFFECTS).toEqual([
      'none',
      'read_external',
      'project_file_operation',
      'execute_command',
      'access_network',
      'access_secret',
      'modify_external',
      'system_change',
    ]);
    expect(SANDBOX_LEVELS).toEqual([
      'none',
      'read_only_project',
      'project_write',
      'restricted_command',
      'network_restricted',
      'host_restricted',
    ]);
  });

  it('defines full ToolUse lifecycle and permission audit constants', () => {
    expect(TOOL_USE_STATUSES).toEqual([
      'created',
      'validated',
      'queued_for_execution',
      'completed',
      'denied',
      'failed',
    ]);
    expect(PERMISSION_DECISION_SOURCES).toEqual([
      'user_rule',
      'project_rule',
      'local_rule',
      'permission_mode',
      'classifier',
      'hard_guard',
      'system_default',
    ]);
    expect(PERMISSION_RULE_SCOPES).toEqual(['user', 'project', 'local', 'system']);
    expect(COMMAND_CLASSIFIER_LABELS).toEqual([
      'read_only',
      'verification',
      'project_write',
      'project_file_operation',
      'dependency_install',
      'network',
      'git_mutation',
      'destructive',
      'unknown',
    ]);
    expect(TOOL_RESULT_KINDS).toEqual(['success', 'tool_error', 'policy_denied', 'user_rejected', 'redacted']);
    expect(TOOL_POLICY_DECISIONS).toEqual(['allow', 'ask', 'deny']);
  });

  it('accepts Claude-compatible snake_case tool definitions with JSON Schema', () => {
    const definition = ToolDefinitionSchema.parse({
      name: 'read_file',
      title: 'Read file',
      description: 'Read a normal project file when it is useful for the current task.',
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
      capabilities: ['project_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      availability: { status: 'available' },
    });

    expect(definition.name).toBe('read_file');
  });

  it('rejects dotted, uppercase, and hyphenated tool names', () => {
    const base = {
      description: 'Invalid name.',
      inputSchema: { type: 'object' },
      capabilities: ['project_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      availability: { status: 'available' },
    } as const;

    expect(() => ToolDefinitionSchema.parse({ ...base, name: 'workspace.file.read' })).toThrow(/lowercase snake_case/);
    expect(() => ToolDefinitionSchema.parse({ ...base, name: 'ReadFile' })).toThrow(/lowercase snake_case/);
    expect(() => ToolDefinitionSchema.parse({ ...base, name: 'read-file' })).toThrow(/lowercase snake_case/);
  });

  it('parses ToolUse as the model-originated request', () => {
    const toolUse = ToolUseSchema.parse({
      toolUseId: 'tool-use-1',
      runId: 'run-1',
      modelStepId: 'model-step-1',
      providerToolUseId: 'call-provider-1',
      toolName: 'read_file',
      input: { path: 'src/index.ts' },
      inputPreview: {
        summary: 'Read src/index.ts',
        targets: [{ kind: 'file', label: 'src/index.ts', sensitivity: 'normal' }],
        redactionState: 'none',
      },
      status: 'created',
      createdAt: '2026-05-20T00:00:00.000Z',
    });

    expect(toolUse.providerToolUseId).toBe('call-provider-1');
  });

  it('rejects ToolUse without providerToolUseId', () => {
    expect(() => ToolUseSchema.parse({
      toolUseId: 'tool-use-1',
      runId: 'run-1',
      modelStepId: 'model-step-1',
      toolName: 'read_file',
      input: { path: 'src/index.ts' },
      inputPreview: {
        summary: 'Read src/index.ts',
        targets: [{ kind: 'file', label: 'src/index.ts', sensitivity: 'normal' }],
        redactionState: 'none',
      },
      status: 'created',
      createdAt: '2026-05-20T00:00:00.000Z',
    })).toThrow();
  });

  it('parses ToolCall without requiring RunActionId', () => {
    expect(TOOL_CALL_STATUSES).toContain('waiting_for_approval');

    const call = ToolCallSchema.parse({
      toolCallId: 'tool-call-1',
      toolUseId: 'tool-use-1',
      runId: 'run-1',
      stepId: 'step-1',
      toolName: 'read_file',
      input: { path: 'src/index.ts' },
      inputPreview: {
        summary: 'Read src/index.ts',
        targets: [{ kind: 'file', label: 'src/index.ts', sensitivity: 'normal' }],
        redactionState: 'none',
      },
      capabilities: ['project_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      status: 'requested',
      requestedAt: '2026-05-20T00:00:01.000Z',
    });

    expect(call.toolUseId).toBe('tool-use-1');
    expect(call).not.toHaveProperty('actionId');
  });

  it('rejects ToolCall without toolUseId', () => {
    expect(() => ToolCallSchema.parse({
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      stepId: 'step-1',
      toolName: 'read_file',
      input: { path: 'src/index.ts' },
      inputPreview: {
        summary: 'Read src/index.ts',
        targets: [{ kind: 'file', label: 'src/index.ts', sensitivity: 'normal' }],
        redactionState: 'none',
      },
      capabilities: ['project_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      status: 'requested',
      requestedAt: '2026-05-20T00:00:01.000Z',
    })).toThrow();
  });

  it('parses permission decisions with audit fields', () => {
    const decision = PermissionDecisionSchema.parse({
      permissionDecisionId: 'permission-decision-1',
      toolUseId: 'tool-use-1',
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      decision: 'allow',
      source: 'permission_mode',
      reason: 'Low-risk read in default mode.',
      mode: 'default',
      matchedRule: {
        scope: 'system',
        pattern: 'read_file',
        decision: 'allow',
      },
      classifierLabel: 'read_only',
      target: 'src/index.ts',
      capability: 'project_read',
      sideEffect: 'none',
      effectiveRiskLevel: 'low',
      evaluatedAt: '2026-05-20T00:00:02.000Z',
    });

    expect(decision.mode).toBe('default');
  });

  it('parses ToolResult success, policy deny, and user rejection', () => {
    expect(ToolResultSchema.parse({
      toolResultId: 'tool-result-1',
      toolUseId: 'tool-use-1',
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      kind: 'success',
      structuredContent: { content: 'export {}' },
      textContent: 'export {}',
      redactionState: 'none',
      createdAt: '2026-05-20T00:00:03.000Z',
    }).kind).toBe('success');

    expect(ToolResultSchema.parse({
      toolResultId: 'tool-result-2',
      toolUseId: 'tool-use-2',
      runId: 'run-1',
      kind: 'policy_denied',
      textContent: 'The tool request was denied by policy.',
      denialReason: 'plan mode blocks write_file.',
      redactionState: 'none',
      createdAt: '2026-05-20T00:00:04.000Z',
    }).kind).toBe('policy_denied');

    expect(ToolResultSchema.parse({
      toolResultId: 'tool-result-3',
      toolUseId: 'tool-use-3',
      toolCallId: 'tool-call-3',
      runId: 'run-1',
      kind: 'user_rejected',
      textContent: 'The user rejected this tool request.',
      denialReason: 'User denied approval.',
      redactionState: 'none',
      createdAt: '2026-05-20T00:00:05.000Z',
    }).kind).toBe('user_rejected');
  });

  it('parses approval and sandbox records without actionKind as core subject', () => {
    expect(ApprovalRequestSchema.parse({
      approvalRequestId: 'approval-1',
      toolUseId: 'tool-use-1',
      toolCallId: 'tool-call-1',
      permissionDecisionId: 'permission-decision-1',
      runId: 'run-1',
      stepId: 'step-1',
      toolName: 'write_file',
      capabilities: ['project_write'],
      riskLevel: 'medium',
      title: 'Approve write_file',
      summary: 'Write src/index.ts',
      preview: {
        action: 'Write file',
        targets: [{ kind: 'file', label: 'src/index.ts', sensitivity: 'normal' }],
      },
      requestedScope: 'once',
      status: 'pending',
      createdAt: '2026-05-20T00:00:06.000Z',
    }).status).toBe('pending');

    expect(APPROVAL_SCOPES).toEqual(['once', 'run', 'project', 'local']);
    expect(SandboxRequirementSchema.parse({
      level: 'project_write',
      allowedRoots: ['C:/all/work/study/megumi'],
      networkPolicy: 'deny',
    }).level).toBe('project_write');
  });

  it('rejects legacy actionKind and workspace sandbox values', () => {
    expect(() => ApprovalRequestSchema.parse({
      approvalRequestId: 'approval-1',
      toolUseId: 'tool-use-1',
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      stepId: 'step-1',
      actionKind: 'call_tool',
      toolName: 'write_file',
      capabilities: ['project_write'],
      riskLevel: 'medium',
      title: 'Approve write_file',
      summary: 'Write src/index.ts',
      preview: {
        action: 'Write file',
        targets: [{ kind: 'file', label: 'src/index.ts', sensitivity: 'normal' }],
      },
      requestedScope: 'once',
      status: 'pending',
      createdAt: '2026-05-20T00:00:06.000Z',
    })).toThrow();

    expect(() => SandboxRequirementSchema.parse({ level: 'workspace_read' })).toThrow();
    expect(() => SandboxRequirementSchema.parse({ level: 'workspace_write' })).toThrow();
    expect(() => SandboxRequirementSchema.parse({ level: 'workspace_write', networkPolicy: 'deny' })).toThrow();
  });
});
