import { describe, expect, it } from 'vitest';
import { evaluateToolPolicy, type EvaluateToolPolicyInput } from '@megumi/security/tool-policy';
import type { JsonObject } from '@megumi/shared/json';
import { ACTIVE_PERMISSION_MODES } from '@megumi/shared/permission-mode-contracts';
import type { ToolCall, ToolDefinition } from '@megumi/shared/tool-contracts';

const readDefinition: ToolDefinition = {
  name: 'project_read_file',
  description: 'Read a normal project file.',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  annotations: { readOnlyHint: true },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
};

const writeDefinition: ToolDefinition = {
  name: 'project_write_file',
  description: 'Write a project file.',
  inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  annotations: { destructiveHint: true },
  capabilities: ['project_write'],
  riskLevel: 'medium',
  sideEffect: 'project_file_operation',
  availability: { status: 'available' },
};

function callFor(definition: ToolDefinition, input: JsonObject = { path: 'src/index.ts' }): ToolCall {
  return {
    toolCallId: 'tool-call-1',
    toolUseId: 'tool-use-1',
    runId: 'run-1',
    stepId: 'step-1',
    actionId: 'action-1',
    toolName: definition.name,
    input,
    inputPreview: {
      summary: definition.description,
      targets: [{ kind: 'file', label: String(input.path ?? 'src/index.ts'), sensitivity: 'normal' }],
      redactionState: 'none',
    },
    capabilities: definition.capabilities,
    riskLevel: definition.riskLevel,
    sideEffect: definition.sideEffect,
    status: 'requested',
    requestedAt: '2026-05-16T00:00:00.000Z',
  };
}

describe('evaluateToolPolicy', () => {
  it('rejects legacy read_only as a permission mode at compile time', () => {
    const input = {
      definition: readDefinition,
      toolCall: callFor(readDefinition),
      // @ts-expect-error read_only is a classifier label, not a target permission mode.
      permissionMode: 'read_only',
      evaluatedAt: '2026-05-16T00:00:00.000Z',
    } satisfies EvaluateToolPolicyInput;

    expect(input.permissionMode).toBe('read_only');
  });

  it('allows low-risk project reads with read-only sandbox and audit fields', () => {
    const decision = evaluateToolPolicy({
      definition: readDefinition,
      toolCall: callFor(readDefinition),
      permissionMode: 'default',
      workspaceRoot: 'C:/all/work/study/megumi',
      evaluatedAt: '2026-05-16T00:00:00.000Z',
    });

    expect(decision).toMatchObject({
      permissionDecisionId: 'tool-call-1:policy',
      toolUseId: 'tool-use-1',
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      decision: 'allow',
      source: 'system_default',
      mode: 'default',
      capability: 'project_read',
      sideEffect: 'none',
      effectiveRiskLevel: 'low',
      requiredSandbox: {
        level: 'read_only_project',
        networkPolicy: 'deny',
      },
      evaluatedAt: '2026-05-16T00:00:00.000Z',
    });
  });

  it('records each target permission mode without fallback normalization', () => {
    for (const permissionMode of ACTIVE_PERMISSION_MODES) {
      const decision = evaluateToolPolicy({
        definition: readDefinition,
        toolCall: callFor(readDefinition),
        permissionMode,
        evaluatedAt: '2026-05-16T00:00:00.000Z',
      });

      expect(decision.mode).toBe(permissionMode);
    }
  });

  it('asks for project writes in default mode', () => {
    const decision = evaluateToolPolicy({
      definition: writeDefinition,
      toolCall: callFor(writeDefinition, { path: 'src/index.ts', content: 'hello' }),
      permissionMode: 'default',
      workspaceRoot: 'C:/all/work/study/megumi',
      evaluatedAt: '2026-05-16T00:00:00.000Z',
    });

    expect(decision.decision).toBe('ask');
    expect(decision.source).toBe('system_default');
    expect(decision.capability).toBe('project_write');
    expect(decision.sideEffect).toBe('project_file_operation');
    expect(decision.requiredApproval).toMatchObject({ scope: 'once' });
    expect(decision.requiredSandbox?.level).toBe('project_write');
  });

  it('denies project writes in plan mode', () => {
    const decision = evaluateToolPolicy({
      definition: writeDefinition,
      toolCall: callFor(writeDefinition, { path: 'src/index.ts', content: 'hello' }),
      permissionMode: 'plan',
      workspaceRoot: 'C:/all/work/study/megumi',
      evaluatedAt: '2026-05-16T00:00:00.000Z',
    });

    expect(decision.decision).toBe('deny');
    expect(decision.source).toBe('permission_mode');
    expect(decision.mode).toBe('plan');
    expect(decision.reason).toContain('plan');
  });

  it('denies protected or secret targets', () => {
    const decision = evaluateToolPolicy({
      definition: readDefinition,
      toolCall: callFor(readDefinition, { path: '.env' }),
      permissionMode: 'default',
      workspaceRoot: 'C:/all/work/study/megumi',
      protectedPathHints: ['.env'],
      evaluatedAt: '2026-05-16T00:00:00.000Z',
    });

    expect(decision.decision).toBe('deny');
    expect(decision.source).toBe('system_default');
    expect(decision.effectiveRiskLevel).toBe('critical');
  });
});
