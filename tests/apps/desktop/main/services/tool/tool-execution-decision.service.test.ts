import { describe, expect, it } from 'vitest';
import { evaluateToolExecutionDecision } from '@megumi/desktop/main/services/tool/tool-execution-decision.service';

describe('evaluateToolExecutionDecision', () => {
  it('allows read-only built-ins as parallel when security policy allows', () => {
    const decision = evaluateToolExecutionDecision({
      toolName: 'read_file',
      parsedArguments: { path: 'README.md' },
      snapshotEntry: {
        modelVisibleName: 'read_file',
        sourceId: 'built_in',
        namespace: 'megumi',
        sourceToolName: 'read_file',
        capabilities: ['project_read'],
        riskLevel: 'low',
        sideEffect: 'none',
        executionMode: 'parallel',
      },
      permissionPosture: 'default',
      permissionDecision: { decision: 'allow', reason: 'Read-only operation.' },
      runtimeCapabilityPolicy: { customToolsEnabled: false, processExecutionEnabled: true },
    });

    expect(decision).toMatchObject({
      outcome: 'allow',
      reasonCode: 'BUILTIN_READ_ALLOWED',
      executionClass: 'readOnly',
      executionMode: 'parallel',
    });
  });

  it('requires approval for workspace mutation when policy asks', () => {
    const decision = evaluateToolExecutionDecision({
      toolName: 'edit_file',
      parsedArguments: { path: 'src/app.ts', edits: [] },
      snapshotEntry: {
        modelVisibleName: 'edit_file',
        sourceId: 'built_in',
        namespace: 'megumi',
        sourceToolName: 'edit_file',
        capabilities: ['project_write'],
        riskLevel: 'high',
        sideEffect: 'project_file_operation',
        executionMode: 'serial',
      },
      permissionPosture: 'default',
      permissionDecision: { decision: 'ask', reason: 'Workspace mutation requires approval.' },
      runtimeCapabilityPolicy: { customToolsEnabled: false, processExecutionEnabled: true },
    });

    expect(decision).toMatchObject({
      outcome: 'requireApproval',
      reasonCode: 'WORKSPACE_MUTATION_REQUIRES_APPROVAL',
      executionClass: 'workspaceMutation',
      executionMode: 'serial',
    });
  });

  it('rejects missing tools with stable reason code', () => {
    const decision = evaluateToolExecutionDecision({
      toolName: 'missing_tool',
      parsedArguments: {},
      snapshotEntry: undefined,
      permissionPosture: 'default',
      permissionDecision: { decision: 'deny', reason: 'Tool was not found.' },
      runtimeCapabilityPolicy: { customToolsEnabled: false, processExecutionEnabled: true },
    });

    expect(decision).toMatchObject({
      outcome: 'reject',
      reasonCode: 'TOOL_NOT_FOUND',
      executionClass: 'unknown',
      executionMode: 'serial',
    });
  });

  it('does not use free text reason as a branch condition', () => {
    const first = evaluateToolExecutionDecision({
      ...firstInputForRunCommandApproval(),
      permissionDecision: { decision: 'ask', reason: 'A' },
    });
    const second = evaluateToolExecutionDecision({
      ...firstInputForRunCommandApproval(),
      permissionDecision: { decision: 'ask', reason: 'B' },
    });

    expect(first.reasonCode).toBe(second.reasonCode);
    expect(first.outcome).toBe(second.outcome);
  });
});

function firstInputForRunCommandApproval() {
  return {
    toolName: 'run_command',
    parsedArguments: { command: 'npm test' },
    snapshotEntry: {
      modelVisibleName: 'run_command',
      sourceId: 'built_in',
      namespace: 'megumi',
      sourceToolName: 'run_command',
      capabilities: ['command_run'],
      riskLevel: 'high',
      sideEffect: 'execute_command',
      executionMode: 'serial',
    },
    permissionPosture: 'default',
    permissionDecision: { decision: 'ask', reason: 'B' },
    runtimeCapabilityPolicy: { customToolsEnabled: false, processExecutionEnabled: true },
  } as const;
}
