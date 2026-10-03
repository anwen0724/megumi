/* Verifies permission precedence and approval scope against resolved operation facts. */
import { expect, it } from 'vitest';
import { readFileTool, writeFileTool, type AgentTool, type PermissionMode } from '@megumi/agent';
import { evaluatePermissionPolicy, resolveApprovalEffect, type ApprovalSubject } from '@megumi/agent/permissions/authorize-tool';
import { resolvePermissionOperations, type EvaluateToolCallRequest, type PermissionSettings, type WorkspacePathPermissionFacts } from '@megumi/agent/permissions/permission-rules';

const inside: WorkspacePathPermissionFacts = {
  absolutePath: 'C:/work/note.md', workspacePath: 'note.md', insideWorkspace: true, protected: false, sensitive: false,
};
const outside: WorkspacePathPermissionFacts = {
  absolutePath: 'C:/outside/note.md', workspacePath: '../outside/note.md', insideWorkspace: false, protected: false, sensitive: false,
};
function evaluate(tool: AgentTool, mode: PermissionMode, facts = inside,
  settings: PermissionSettings = { mode, allow: [], ask: [], deny: [] }) {
  const toolInput = { path: facts.workspacePath, content: 'Hello' };
  const evaluation: EvaluateToolCallRequest = {
    executionId: 'run', sessionId: 'session', workspaceId: 'workspace', toolCallId: 'call',
    evaluatedAt: '2026-10-04T00:00:00.000Z', permissionMode: mode, toolInput,
    operations: tool.operations(toolInput).map(operation => ({ ...operation, context: {
      executionId: 'run', sessionId: 'session', workspaceId: 'workspace',
      toolIdentity: { sourceId: 'built_in', namespace: 'megumi', sourceToolName: tool.name, registeredToolName: tool.name },
    } })),
  };
  return evaluatePermissionPolicy({ evaluation, ...resolvePermissionOperations({ evaluation, workspacePaths: { '0': facts } }), permissionSettings: settings });
}
function approve(result: ReturnType<typeof evaluate>, currentSubject = result.approvalSubject, optionId?: string) {
  if (result.decision.type !== 'requires_approval') throw new Error('Expected approval');
  return resolveApprovalEffect({
    originalPermissionDecision: result.decision, originalSubject: result.approvalSubject, currentSubject,
    decision: { approvalRequestId: 'approval', decision: 'approved', optionId: optionId ?? result.decision.defaultOptionId,
      decidedBy: 'user', decidedAt: '2026-10-04T00:00:01.000Z' },
    sessionId: 'session', appliedAt: '2026-10-04T00:00:01.000Z', permissionMode: 'ask',
  });
}

it('applies deny, ask and allow before the requested permission mode', () => {
  const rule = { source: 'user' as const, target: { kind: 'tool' as const,
    tool_identity: { source_id: 'built_in', namespace: 'megumi', source_tool_name: 'write_file' } } };
  expect(evaluate(writeFileTool, 'full_access', inside, { mode: 'ask', allow: [rule], ask: [rule], deny: [rule] }))
    .toMatchObject({ decision: { type: 'deny', denialCode: 'rule_denied' } });
  expect(evaluate(writeFileTool, 'full_access', inside, { mode: 'ask', allow: [rule], ask: [rule], deny: [] }))
    .toMatchObject({ decision: { type: 'requires_approval' } });
  expect(evaluate(writeFileTool, 'ask', inside, { mode: 'ask', allow: [rule], ask: [], deny: [] }))
    .toMatchObject({ decision: { type: 'allow' } });
});

it('limits ordinary reads to the workspace and requires approval for external writes unless full access is explicit', () => {
  expect(evaluate(readFileTool, 'auto')).toMatchObject({ decision: { type: 'allow' },
    executionAccess: { fileSystem: { mode: 'workspace' }, process: 'sandboxed', network: 'denied' } });
  expect(evaluate(writeFileTool, 'auto', outside)).toMatchObject({ decision: { type: 'requires_approval', safetyAssessment: 'prohibited' } });
  expect(evaluate(writeFileTool, 'full_access', outside)).toMatchObject({ decision: { type: 'allow', safetyAssessment: 'prohibited' },
    executionAccess: { fileSystem: { mode: 'unrestricted' }, process: 'unrestricted', network: 'unrestricted' } });
});

it('grants only the canonical target when an external write is approved', () => {
  expect(approve(evaluate(writeFileTool, 'ask', outside))).toMatchObject({ status: 'applied',
    executionAccess: { fileSystem: { mode: 'workspace_and_paths', readablePaths: [], writablePaths: ['C:/outside/note.md'] },
      process: 'sandboxed', network: 'denied' } });
});

it('rejects changed and forged approval subjects', () => {
  const result = evaluate(writeFileTool, 'ask');
  expect(approve(result)).toMatchObject({ status: 'applied' });
  expect(approve(result, evaluate(writeFileTool, 'ask', outside).approvalSubject))
    .toMatchObject({ status: 'rejected', reason: 'subject_changed' });
  const forged: ApprovalSubject = { ...result.approvalSubject, criticalInput: { path: '../elsewhere' } };
  expect(approve(result, forged)).toMatchObject({ status: 'rejected', reason: 'subject_invalid' });
});

it('offers a session grant for the exact read target but not a mutable file operation', () => {
  const rule = { source: 'user' as const, target: { kind: 'operation' as const, action: 'workspace.read',
    resource: { type: 'workspace.path', matcher: { operator: 'exact' as const, value: 'note.md' } } } };
  const read = evaluate(readFileTool, 'ask', inside, { mode: 'ask', allow: [], ask: [rule], deny: [] });
  if (read.decision.type !== 'requires_approval') throw new Error('Expected approval');
  const option = read.decision.options.find(option => option.scope === 'session');
  expect(option).toBeDefined();
  expect(approve(read, read.approvalSubject, option!.optionId)).toMatchObject({ status: 'applied', effect: {
    type: 'session_tool_grant', rule: { source: 'session', source_id: 'session', target: rule.target },
  } });
  const write = evaluate(writeFileTool, 'ask');
  if (write.decision.type !== 'requires_approval') throw new Error('Expected approval');
  expect(write.decision.options.map(option => option.scope)).toEqual(['once']);
});
