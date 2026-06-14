import { describe, expect, it } from 'vitest';
import { RuntimeEventSchema } from '@megumi/shared/runtime';
import {
  APPROVAL_SCOPES,
  COMMAND_CLASSIFIER_LABELS,
  PERMISSION_DECISION_SOURCES,
  PERMISSION_RULE_SCOPES,
  SANDBOX_LEVELS,
  TOOL_CAPABILITIES,
  TOOL_CALL_STATUSES,
  TOOL_EXECUTION_MODES,
  TOOL_EXECUTION_STATUSES,
  TOOL_POLICY_DECISIONS,
  TOOL_REGISTRY_SNAPSHOT_ENTRY_STATUSES,
  TOOL_RESULT_KINDS,
  TOOL_SIDE_EFFECTS,
  TOOL_SOURCE_AVAILABILITY_STATUSES,
  TOOL_SOURCE_KINDS,
  ApprovalRequestSchema,
  PermissionDecisionSchema,
  SandboxRequirementSchema,
  SnapshotToolEntrySchema,
  ToolCallSchema,
  ToolDefinitionSchema,
  ToolExecutionSchema,
  ToolObservationSchema,
  ToolRegistrationSchema,
  ToolRegistrySnapshotSchema,
  ToolResultSchema,
  ToolSourceIdentitySchema,
  ToolSourceSchema,
} from '@megumi/shared/tool';

const inputPreview = {
  summary: 'Read src/index.ts',
  targets: [{ kind: 'file' as const, label: 'src/index.ts', sensitivity: 'normal' as const }],
  redactionState: 'none' as const,
};

const toolDefinition = {
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
} as const;

const builtInSource = {
  sourceId: 'built_in',
  sourceKind: 'built_in',
  namespace: 'megumi',
  displayName: 'Built-in tools',
  configured: true,
  enabled: true,
  availabilityStatus: 'available',
  healthCheckedAt: '2026-06-14T00:00:00.000Z',
  config: {},
  createdAt: '2026-06-14T00:00:00.000Z',
  updatedAt: '2026-06-14T00:00:00.000Z',
} as const;

const toolSourceIdentity = {
  registrySnapshotId: 'tool-registry-snapshot-1',
  snapshotEntryId: 'snapshot-entry-read-file',
  modelVisibleName: 'read_file',
  canonicalToolId: 'built_in:megumi:read_file',
  sourceId: 'built_in',
  namespace: 'megumi',
  sourceToolName: 'read_file',
} as const;

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

  it('defines ToolCall and ToolExecution lifecycle and permission audit constants', () => {
    expect(TOOL_CALL_STATUSES).toEqual([
      'created',
      'validated',
      'queued_for_execution',
      'completed',
      'denied',
      'failed',
    ]);
    expect(TOOL_EXECUTION_STATUSES).toEqual([
      'pending_approval',
      'running',
      'completed',
      'failed',
      'denied',
      'cancelled',
    ]);
    expect(PERMISSION_DECISION_SOURCES).toEqual([
      'rule',
      'protected_path',
      'sensitive_policy',
      'project_boundary',
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
      'search_or_list',
      'project_file_operation',
      'dependency_install',
      'git_read',
      'git_mutation',
      'network',
      'destructive',
      'infrastructure_or_deploy',
      'secret_or_env',
      'unknown',
    ]);
    expect(TOOL_RESULT_KINDS).toEqual([
      'success',
      'tool_error',
      'policy_denied',
      'user_rejected',
      'redacted',
      'invalid_tool_call',
      'invalid_tool_input',
    ]);
    expect(TOOL_POLICY_DECISIONS).toEqual(['allow', 'ask', 'deny']);
  });

  it('accepts Claude-compatible snake_case tool definitions with JSON Schema', () => {
    const definition = ToolDefinitionSchema.parse(toolDefinition);

    expect(definition.name).toBe('read_file');
  });

  it('separates tool definition from source identity', () => {
    const definition = ToolDefinitionSchema.parse({
      ...toolDefinition,
      executionMode: 'sequential',
      permissionMetadata: { defaultDecision: 'allow' },
      modelFacingDescription: 'Read project files for context.',
    });

    expect(definition.executionMode).toBe('sequential');
    expect(definition.permissionMetadata).toEqual({ defaultDecision: 'allow' });
    expect(definition.modelFacingDescription).toBe('Read project files for context.');
    expect(TOOL_EXECUTION_MODES).toEqual(['sequential', 'parallel_eligible', 'exclusive']);
    expect(() => ToolDefinitionSchema.parse({ ...toolDefinition, sourceId: 'built_in' })).toThrow();
    expect(() => ToolDefinitionSchema.parse({
      ...toolDefinition,
      canonicalToolId: 'built_in:megumi:read_file',
    })).toThrow();
  });

  it('parses tool sources with enablement and availability state', () => {
    expect(TOOL_SOURCE_KINDS).toEqual(['built_in', 'external_test', 'mcp', 'plugin', 'project_local']);
    expect(TOOL_SOURCE_AVAILABILITY_STATUSES).toEqual(['available', 'unavailable', 'unknown']);

    expect(ToolSourceSchema.parse(builtInSource)).toEqual(builtInSource);
  });

  it('parses tool registrations without changing the tool definition identity', () => {
    const registration = ToolRegistrationSchema.parse({
      registrationId: 'registration-built-in-read-file',
      sourceId: 'built_in',
      namespace: 'megumi',
      sourceToolName: 'read_file',
      definition: toolDefinition,
      enabled: true,
      availability: { status: 'available' },
      executorBinding: { kind: 'built_in' },
      registrationMetadata: {},
    });

    expect(registration.sourceId).toBe('built_in');
    expect(registration.definition.name).toBe('read_file');
    expect(registration.definition).not.toHaveProperty('sourceId');
    expect(registration.definition).not.toHaveProperty('canonicalToolId');
  });

  it('parses run-level tool registry snapshots and snapshot entries', () => {
    const entry = SnapshotToolEntrySchema.parse({
      snapshotEntryId: 'snapshot-entry-read-file',
      snapshotId: 'tool-registry-snapshot-1',
      registrationId: 'registration-built-in-read-file',
      canonicalToolId: 'built_in:megumi:read_file',
      modelVisibleName: 'read_file',
      sourceId: 'built_in',
      namespace: 'megumi',
      sourceToolName: 'read_file',
      definition: toolDefinition,
      effectiveStatus: 'available',
      exposedToModel: true,
      executionMode: 'sequential',
      createdAt: '2026-06-14T00:00:00.000Z',
    });
    const snapshot = ToolRegistrySnapshotSchema.parse({
      snapshotId: 'tool-registry-snapshot-1',
      runId: 'run-1',
      projectId: 'project-1',
      permissionMode: 'default',
      modelId: 'gpt-5',
      createdAt: '2026-06-14T00:00:00.000Z',
      registryVersion: 1,
      sourceVersionHash: 'source-version-hash-1',
      sourceEntries: [{
        sourceId: builtInSource.sourceId,
        sourceKind: builtInSource.sourceKind,
        namespace: builtInSource.namespace,
        displayName: builtInSource.displayName,
        configured: builtInSource.configured,
        enabled: builtInSource.enabled,
        availabilityStatus: builtInSource.availabilityStatus,
        healthCheckedAt: builtInSource.healthCheckedAt,
      }],
      entries: [entry],
    });

    expect(TOOL_REGISTRY_SNAPSHOT_ENTRY_STATUSES).toEqual(['available', 'disabled', 'unavailable', 'conflicted']);
    expect(snapshot.entries[0]).toMatchObject({
      canonicalToolId: 'built_in:megumi:read_file',
      modelVisibleName: 'read_file',
      sourceId: 'built_in',
      namespace: 'megumi',
      sourceToolName: 'read_file',
      effectiveStatus: 'available',
      exposedToModel: true,
      executionMode: 'sequential',
    });
  });

  it('parses source identity fields on tool lifecycle records', () => {
    expect(ToolSourceIdentitySchema.parse(toolSourceIdentity)).toEqual(toolSourceIdentity);
    expect(ToolCallSchema.parse({
      toolCallId: 'tool-call-identity',
      runId: 'run-1',
      modelStepId: 'model-step-1',
      providerToolCallId: 'provider-tool-call-identity',
      toolName: 'read_file',
      ...toolSourceIdentity,
      input: { path: 'src/index.ts' },
      inputPreview,
      status: 'created',
      createdAt: '2026-06-14T00:00:00.000Z',
    })).toMatchObject(toolSourceIdentity);
    expect(ToolExecutionSchema.parse({
      toolExecutionId: 'tool-execution-identity',
      toolCallId: 'tool-call-identity',
      runId: 'run-1',
      stepId: 'step-1',
      toolName: 'read_file',
      ...toolSourceIdentity,
      input: { path: 'src/index.ts' },
      inputPreview,
      capabilities: ['project_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      status: 'running',
      requestedAt: '2026-06-14T00:00:00.000Z',
    })).toMatchObject(toolSourceIdentity);
    expect(PermissionDecisionSchema.parse({
      permissionDecisionId: 'permission-decision-identity',
      toolCallId: 'tool-call-identity',
      toolExecutionId: 'tool-execution-identity',
      runId: 'run-1',
      ...toolSourceIdentity,
      decision: 'allow',
      source: 'permission_mode',
      reason: 'Low-risk read.',
      mode: 'default',
      classifierLabel: 'read_only',
      target: 'src/index.ts',
      capability: 'project_read',
      sideEffect: 'none',
      effectiveRiskLevel: 'low',
      evaluatedAt: '2026-06-14T00:00:00.000Z',
    })).toMatchObject(toolSourceIdentity);
    expect(ApprovalRequestSchema.parse({
      approvalRequestId: 'approval-request-identity',
      toolCallId: 'tool-call-identity',
      toolExecutionId: 'tool-execution-identity',
      permissionDecisionId: 'permission-decision-identity',
      runId: 'run-1',
      stepId: 'step-1',
      toolName: 'read_file',
      ...toolSourceIdentity,
      capabilities: ['project_read'],
      riskLevel: 'low',
      title: 'Approve read_file',
      summary: 'Read src/index.ts',
      preview: { action: 'Read file', targets: [{ kind: 'file', label: 'src/index.ts' }] },
      requestedScope: 'once',
      status: 'pending',
      createdAt: '2026-06-14T00:00:00.000Z',
    })).toMatchObject(toolSourceIdentity);
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

  it('parses ToolCall as the model-originated request', () => {
    const toolCall = ToolCallSchema.parse({
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      modelStepId: 'model-step-1',
      providerToolCallId: 'call-provider-1',
      toolName: 'read_file',
      input: { path: 'src/index.ts' },
      inputPreview,
      status: 'created',
      createdAt: '2026-05-20T00:00:00.000Z',
    });

    expect(toolCall).toMatchObject({
      toolCallId: 'tool-call-1',
      providerToolCallId: 'call-provider-1',
      modelStepId: 'model-step-1',
    });
  });

  it('parses ToolExecution as the host execution record', () => {
    const execution = ToolExecutionSchema.parse({
      toolExecutionId: 'tool-execution-1',
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      stepId: 'step-1',
      toolName: 'read_file',
      input: { path: 'src/index.ts' },
      inputPreview,
      capabilities: ['project_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      status: 'pending_approval',
      requestedAt: '2026-05-20T00:00:01.000Z',
    });

    expect(execution).toMatchObject({
      toolExecutionId: 'tool-execution-1',
      toolCallId: 'tool-call-1',
      stepId: 'step-1',
    });
    expect(execution).not.toHaveProperty('toolUseId');
    expect(() => ToolExecutionSchema.parse({
      ...execution,
      status: 'requested',
    })).toThrow();
  });

  it('parses permission decisions with tool call and optional execution audit fields', () => {
    const decision = PermissionDecisionSchema.parse({
      permissionDecisionId: 'permission-decision-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
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

    expect(decision.toolCallId).toBe('tool-call-1');
    expect(decision.toolExecutionId).toBe('tool-execution-1');
  });

  it('persists all Plan 3 command classifier labels in permission decisions', () => {
    for (const classifierLabel of [
      'read_only',
      'verification',
      'search_or_list',
      'project_file_operation',
      'dependency_install',
      'git_read',
      'git_mutation',
      'network',
      'destructive',
      'infrastructure_or_deploy',
      'secret_or_env',
      'unknown',
    ] as const) {
      expect(PermissionDecisionSchema.parse({
        permissionDecisionId: `permission-decision-${classifierLabel}`,
        toolCallId: 'tool-call-1',
        runId: 'run-1',
        decision: 'allow',
        source: 'classifier',
        reason: `Classifier accepted ${classifierLabel}.`,
        mode: 'auto',
        classifierLabel,
        target: 'src/index.ts',
        capability: 'command_run',
        sideEffect: 'execute_command',
        effectiveRiskLevel: 'low',
        evaluatedAt: '2026-05-20T00:00:02.000Z',
      }).classifierLabel).toBe(classifierLabel);
    }
  });

  it('persists permission classifier guard labels in permission decisions', () => {
    for (const classifierLabel of ['project_boundary', 'sensitive_policy'] as const) {
      expect(PermissionDecisionSchema.parse({
        permissionDecisionId: `permission-decision-${classifierLabel}`,
        toolCallId: 'tool-call-1',
        runId: 'run-1',
        decision: 'ask',
        source: 'classifier',
        reason: `Classifier recorded ${classifierLabel}.`,
        mode: 'auto',
        classifierLabel,
        target: 'src/index.ts',
        capability: 'project_write',
        sideEffect: 'project_file_operation',
        effectiveRiskLevel: 'medium',
        evaluatedAt: '2026-05-20T00:00:02.000Z',
      }).classifierLabel).toBe(classifierLabel);
    }
  });

  it('parses ToolResult with toolCallId and optional toolExecutionId', () => {
    expect(ToolResultSchema.parse({
      toolResultId: 'tool-result-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      runId: 'run-1',
      kind: 'success',
      structuredContent: { content: 'export {}' },
      textContent: 'export {}',
      redactionState: 'none',
      createdAt: '2026-05-20T00:00:03.000Z',
    })).toMatchObject({
      kind: 'success',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
    });

    expect(ToolResultSchema.parse({
      toolResultId: 'tool-result-2',
      toolCallId: 'tool-call-2',
      runId: 'run-1',
      kind: 'policy_denied',
      textContent: 'The tool request was denied by policy.',
      denialReason: 'Plan mode blocks write_file.',
      redactionState: 'none',
      createdAt: '2026-05-20T00:00:04.000Z',
    }).toolExecutionId).toBeUndefined();
  });

  it('accepts recoverable invalid tool result kinds', () => {
    expect(ToolResultSchema.parse({
      toolResultId: 'tool-result-invalid-tool',
      toolCallId: 'tool-call-invalid-tool',
      runId: 'run-1',
      kind: 'invalid_tool_call',
      textContent: 'Tool missing_tool is not available.',
      redactionState: 'none',
      createdAt: '2026-06-14T00:00:00.000Z',
    }).kind).toBe('invalid_tool_call');

    expect(ToolResultSchema.parse({
      toolResultId: 'tool-result-invalid-input',
      toolCallId: 'tool-call-invalid-input',
      runId: 'run-1',
      kind: 'invalid_tool_input',
      textContent: 'Tool input did not match schema.',
      redactionState: 'none',
      createdAt: '2026-06-14T00:00:00.000Z',
    }).kind).toBe('invalid_tool_input');
  });

  it('accepts recoverable invalid tool result kinds in runtime event schemas', () => {
    const invalidToolCallEvent = RuntimeEventSchema.parse({
      eventId: 'event-invalid-tool-result',
      schemaVersion: 1,
      eventType: 'tool.result.created',
      runId: 'run-1',
      sequence: 1,
      createdAt: '2026-06-14T00:00:00.000Z',
      source: 'tool',
      visibility: 'user',
      persist: 'required',
      payload: {
        toolResultId: 'tool-result-invalid-tool',
        toolCallId: 'tool-call-invalid-tool',
        kind: 'invalid_tool_call',
        summary: 'Tool missing_tool is not available.',
      },
    });
    if (invalidToolCallEvent.eventType !== 'tool.result.created') {
      throw new Error('Expected tool.result.created event.');
    }
    expect(invalidToolCallEvent.payload.kind).toBe('invalid_tool_call');

    const invalidToolInputEvent = RuntimeEventSchema.parse({
      eventId: 'event-invalid-input-result',
      schemaVersion: 1,
      eventType: 'tool.result.created',
      runId: 'run-1',
      sequence: 2,
      createdAt: '2026-06-14T00:00:00.000Z',
      source: 'tool',
      visibility: 'user',
      persist: 'required',
      payload: {
        toolResultId: 'tool-result-invalid-input',
        toolCallId: 'tool-call-invalid-input',
        kind: 'invalid_tool_input',
        summary: 'Tool input did not match schema.',
      },
    });
    if (invalidToolInputEvent.eventType !== 'tool.result.created') {
      throw new Error('Expected tool.result.created event.');
    }
    expect(invalidToolInputEvent.payload.kind).toBe('invalid_tool_input');
  });

  it('parses approval requests with both toolCallId and toolExecutionId', () => {
    expect(ApprovalRequestSchema.parse({
      approvalRequestId: 'approval-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
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
    })).toMatchObject({
      status: 'pending',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
    });

    expect(APPROVAL_SCOPES).toEqual(['once', 'run', 'project', 'local']);
    expect(SandboxRequirementSchema.parse({
      level: 'project_write',
      allowedRoots: ['C:/all/work/study/megumi'],
      networkPolicy: 'deny',
    }).level).toBe('project_write');
  });

  it('parses ToolObservation with toolExecutionId', () => {
    const observation = ToolObservationSchema.parse({
      observationId: 'observation-1',
      toolExecutionId: 'tool-execution-1',
      runId: 'run-1',
      stepId: 'step-1',
      status: 'succeeded',
      summary: 'Read file.',
      structuredContent: { content: 'export {}' },
      textPreview: 'export {}',
      createdAt: '2026-05-20T00:00:07.000Z',
    });

    expect(observation.toolExecutionId).toBe('tool-execution-1');
    expect(observation).not.toHaveProperty('toolCallId');
  });

  it('rejects legacy actionKind and workspace sandbox values', () => {
    expect(() => ApprovalRequestSchema.parse({
      approvalRequestId: 'approval-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
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

