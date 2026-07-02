// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { evaluatePermissionPolicy } from '@megumi/coding-agent/permissions/tool-policy';
import { ToolRegistryService } from '@megumi/coding-agent/tools';
import type { ToolDefinition, ToolExecution } from '@megumi/shared/tool';

const registry = new ToolRegistryService();
const projectRoot = 'C:/all/work/study/megumi';

function toolExecution(input: Partial<ToolExecution> & Pick<ToolExecution, 'toolName' | 'input'>): ToolExecution {
  return {
    toolExecutionId: input.toolExecutionId ?? `tool-execution-${input.toolName}`,
    toolCallId: input.toolCallId ?? `tool-call-${input.toolName}`,
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
    status: 'running',
    requestedAt: '2026-05-20T00:00:00.000Z',
  };
}

function definition(name: string): ToolDefinition {
  const result = registry.getRegisteredTool({ toolName: name });
  if (result.type !== 'found') throw new Error(`Missing tool definition: ${name}`);
  return result.tool.definition as unknown as ToolDefinition;
}

describe('agent action permission tools v1 acceptance', () => {
  it('allows read tools in default mode', () => {
    const decision = evaluatePermissionPolicy({
      definition: definition('read_file'),
      toolExecution: toolExecution({ toolName: 'read_file', input: { path: 'README.md' } }),
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
      toolExecution: toolExecution({
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
      toolExecution: toolExecution({
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
      toolExecution: toolExecution({
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
      toolExecution: toolExecution({
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
      toolExecution: toolExecution({
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
      toolExecution: toolExecution({
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
      toolExecution: toolExecution({
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
      toolExecution: toolExecution({
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

