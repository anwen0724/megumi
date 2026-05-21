// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { evaluatePermissionPolicy } from '@megumi/security/tool-policy';
import { createBuiltInToolRegistry } from '@megumi/tools/built-ins';
import type { ToolCall } from '@megumi/shared/tool-contracts';

const registry = createBuiltInToolRegistry();
const projectRoot = 'C:/all/work/study/megumi';

function toolCall(input: Partial<ToolCall> & Pick<ToolCall, 'toolName' | 'input'>): ToolCall {
  return {
    toolCallId: input.toolCallId ?? `tool-call-${input.toolName}`,
    toolUseId: input.toolUseId ?? `tool-use-${input.toolName}`,
    runId: 'run-1',
    stepId: 'step-1',
    toolName: input.toolName,
    input: input.input,
    inputPreview: input.inputPreview ?? {
      summary: `Use ${input.toolName}`,
      targets: [],
      redactionState: 'none',
    },
    capabilities: input.capabilities ?? ['project_read'],
    riskLevel: input.riskLevel ?? 'low',
    sideEffect: input.sideEffect ?? 'none',
    status: 'requested',
    requestedAt: '2026-05-20T00:00:00.000Z',
  };
}

function definition(name: string) {
  const item = registry.getDefinition(name, {
    runId: 'run-1',
    projectId: 'project-1',
    permissionMode: 'default',
    providerCapabilitySummary: { supportsToolUse: true },
  });
  if (!item) throw new Error(`Missing tool definition: ${name}`);
  return item;
}

describe('agent action permission tools v1 acceptance', () => {
  it('allows read tools in default mode', () => {
    const decision = evaluatePermissionPolicy({
      definition: definition('read_file'),
      toolCall: toolCall({ toolName: 'read_file', input: { path: 'README.md' } }),
      permissionMode: 'default',
      projectRoot,
      settings: { allow: [], ask: [], deny: [] },
      evaluatedAt: '2026-05-20T00:00:00.000Z',
    });

    expect(decision.decision).toBe('allow');
  });

  it('asks before ordinary writes in default mode', () => {
    const decision = evaluatePermissionPolicy({
      definition: definition('edit_file'),
      toolCall: toolCall({
        toolName: 'edit_file',
        input: { path: 'src/index.ts', oldText: 'a', newText: 'b' },
        capabilities: ['project_write'],
        riskLevel: 'medium',
        sideEffect: 'project_file_operation',
      }),
      permissionMode: 'default',
      projectRoot,
      settings: { allow: [], ask: [], deny: [] },
      evaluatedAt: '2026-05-20T00:00:00.000Z',
    });

    expect(decision.decision).toBe('ask');
  });

  it('denies writes and unknown commands in plan mode while asking for verification commands', () => {
    const writeDecision = evaluatePermissionPolicy({
      definition: definition('write_file'),
      toolCall: toolCall({
        toolName: 'write_file',
        input: { path: 'src/index.ts', content: 'export {}' },
        capabilities: ['project_write'],
        riskLevel: 'medium',
        sideEffect: 'project_file_operation',
      }),
      permissionMode: 'plan',
      projectRoot,
      settings: { allow: [], ask: [], deny: [] },
      evaluatedAt: '2026-05-20T00:00:00.000Z',
    });

    const verificationDecision = evaluatePermissionPolicy({
      definition: definition('run_command'),
      toolCall: toolCall({
        toolName: 'run_command',
        input: { command: 'npm test' },
        capabilities: ['command_run'],
        riskLevel: 'medium',
        sideEffect: 'execute_command',
      }),
      permissionMode: 'plan',
      projectRoot,
      settings: { allow: [], ask: [], deny: [] },
      evaluatedAt: '2026-05-20T00:00:00.000Z',
    });

    const unknownDecision = evaluatePermissionPolicy({
      definition: definition('run_command'),
      toolCall: toolCall({
        toolName: 'run_command',
        input: { command: 'custom-mutator --apply' },
        capabilities: ['command_run'],
        riskLevel: 'medium',
        sideEffect: 'execute_command',
      }),
      permissionMode: 'plan',
      projectRoot,
      settings: { allow: [], ask: [], deny: [] },
      evaluatedAt: '2026-05-20T00:00:00.000Z',
    });

    expect(writeDecision.decision).toBe('deny');
    expect(verificationDecision.decision).toBe('ask');
    expect(unknownDecision.decision).toBe('deny');
  });

  it('allows ordinary project edits and verification commands in accept_edits mode', () => {
    const editDecision = evaluatePermissionPolicy({
      definition: definition('edit_file'),
      toolCall: toolCall({
        toolName: 'edit_file',
        input: { path: 'src/index.ts', oldText: 'a', newText: 'b' },
        capabilities: ['project_write'],
        riskLevel: 'medium',
        sideEffect: 'project_file_operation',
      }),
      permissionMode: 'accept_edits',
      projectRoot,
      settings: { allow: [], ask: [], deny: [] },
      evaluatedAt: '2026-05-20T00:00:00.000Z',
    });

    const testDecision = evaluatePermissionPolicy({
      definition: definition('run_command'),
      toolCall: toolCall({
        toolName: 'run_command',
        input: { command: 'npm test' },
        capabilities: ['command_run'],
        riskLevel: 'medium',
        sideEffect: 'execute_command',
      }),
      permissionMode: 'accept_edits',
      projectRoot,
      settings: { allow: [], ask: [], deny: [] },
      evaluatedAt: '2026-05-20T00:00:00.000Z',
    });

    expect(editDecision.decision).toBe('allow');
    expect(testDecision.decision).toBe('allow');
  });

  it('keeps auto auditable and denies protected path writes', () => {
    const autoEditDecision = evaluatePermissionPolicy({
      definition: definition('edit_file'),
      toolCall: toolCall({
        toolName: 'edit_file',
        input: { path: 'src/index.ts', oldText: 'a', newText: 'b' },
        capabilities: ['project_write'],
        riskLevel: 'medium',
        sideEffect: 'project_file_operation',
      }),
      permissionMode: 'auto',
      projectRoot,
      settings: { allow: [], ask: [], deny: [] },
      evaluatedAt: '2026-05-20T00:00:00.000Z',
    });

    const protectedPathDecision = evaluatePermissionPolicy({
      definition: definition('write_file'),
      toolCall: toolCall({
        toolName: 'write_file',
        input: { path: '.git/config', content: '[core]' },
        capabilities: ['project_write'],
        riskLevel: 'medium',
        sideEffect: 'project_file_operation',
      }),
      permissionMode: 'auto',
      projectRoot,
      settings: { allow: [], ask: [], deny: [] },
      evaluatedAt: '2026-05-20T00:00:00.000Z',
    });

    expect(autoEditDecision.decision).toBe('allow');
    expect(autoEditDecision.source).toBe('classifier');
    expect(autoEditDecision.mode).toBe('auto');
    expect(autoEditDecision.reason).toEqual(expect.any(String));
    expect(autoEditDecision.reason.length).toBeGreaterThan(0);
    expect(protectedPathDecision.decision).toBe('deny');
    expect(protectedPathDecision.reason).toMatch(/Protected path|protected/i);
  });
});
