import { describe, expect, it } from 'vitest';
import { evaluateToolPolicy } from '@megumi/security/tool-policy';
import type { JsonObject } from '@megumi/shared/json';
import type { ToolCall, ToolDefinition } from '@megumi/shared/tool-contracts';

const readDefinition: ToolDefinition = {
  name: 'workspace_read_file',
  description: 'Read a normal workspace file.',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  annotations: { readOnlyHint: true },
  capabilities: ['workspace_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
};

const writeDefinition: ToolDefinition = {
  name: 'workspace_write_file',
  description: 'Write a workspace file.',
  inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  annotations: { destructiveHint: true },
  capabilities: ['workspace_write'],
  riskLevel: 'medium',
  sideEffect: 'write_workspace',
  availability: { status: 'available' },
};

function callFor(definition: ToolDefinition, input: JsonObject = { path: 'src/index.ts' }): ToolCall {
  return {
    toolCallId: 'tool-call-1',
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
  it('allows low-risk workspace reads with read-only sandbox', () => {
    const decision = evaluateToolPolicy({
      definition: readDefinition,
      toolCall: callFor(readDefinition),
      permissionMode: 'default',
      workspaceRoot: 'C:/all/work/study/megumi',
      evaluatedAt: '2026-05-16T00:00:00.000Z',
    });

    expect(decision).toMatchObject({
      decision: 'allow',
      effectiveRiskLevel: 'low',
      requiredSandbox: {
        level: 'read_only_workspace',
        networkPolicy: 'deny',
      },
    });
  });

  it('asks for workspace writes in default mode', () => {
    const decision = evaluateToolPolicy({
      definition: writeDefinition,
      toolCall: callFor(writeDefinition, { path: 'src/index.ts', content: 'hello' }),
      permissionMode: 'default',
      workspaceRoot: 'C:/all/work/study/megumi',
      evaluatedAt: '2026-05-16T00:00:00.000Z',
    });

    expect(decision.decision).toBe('ask');
    expect(decision.requiredApproval).toMatchObject({ scope: 'once' });
    expect(decision.requiredSandbox?.level).toBe('workspace_write');
  });

  it('denies workspace writes in plan mode', () => {
    const decision = evaluateToolPolicy({
      definition: writeDefinition,
      toolCall: callFor(writeDefinition, { path: 'src/index.ts', content: 'hello' }),
      permissionMode: 'plan',
      workspaceRoot: 'C:/all/work/study/megumi',
      evaluatedAt: '2026-05-16T00:00:00.000Z',
    });

    expect(decision.decision).toBe('deny');
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
    expect(decision.effectiveRiskLevel).toBe('critical');
  });
});
