import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function listSourceFiles(relativeDirectory: string): string[] {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      return listSourceFiles(relativePath);
    }
    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [relativePath] : [];
  });
}

function functionSection(source: string, functionName: string, nextFunctionName: string): string {
  const start = source.indexOf(`function ${functionName}`);
  const end = source.indexOf(`function ${nextFunctionName}`, start + 1);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('built-in tools and host adapters source guards', () => {
  it('keeps provider-facing tool names platform neutral', () => {
    const definitions = read('packages/tools/built-ins/index.ts');

    expect(definitions).toContain("'run_command'");
    expect(definitions).not.toContain("'powershell'");
    expect(definitions).not.toContain("'shell_run_command'");
    expect(definitions).toContain("'read_file'");
    expect(definitions).not.toContain("'workspace_read_file'");
  });

  it('keeps real filesystem and shell execution out of packages/tools', () => {
    const source = listSourceFiles('packages/tools')
      .map(read)
      .join('\n');

    expect(source).not.toContain("from 'node:fs'");
    expect(source).not.toContain("from 'fs-extra'");
    expect(source).not.toContain("from 'node:child_process'");
    expect(source).not.toContain('spawn(');
  });

  it('keeps Host execution behind PermissionPolicy', () => {
    const handler = read('apps/desktop/src/main/services/tool/tool-call-handler.service.ts');
    const handleSingleToolCall = functionSection(handler, 'handleSingleToolCall', 'runtimeEventBase');
    const policyIndex = handleSingleToolCall.indexOf('evaluatePermissionPolicy({');
    const executeIndex = handleSingleToolCall.indexOf('toolExecutionRouter.executeToolExecution');

    expect(policyIndex).toBeGreaterThan(-1);
    expect(executeIndex).toBeGreaterThan(-1);
    expect(policyIndex).toBeLessThan(executeIndex);
    expect(handleSingleToolCall).toContain("decision.decision === 'ask'");
    expect(handleSingleToolCall).toContain("decision.decision === 'deny'");
  });

  it('keeps approval resume behind a persisted approved ApprovalRequest', () => {
    const handler = read('apps/desktop/src/main/services/tool/tool-call-handler.service.ts');
    const resumeToolApproval = functionSection(handler, 'resumeToolApproval', 'handleSingleToolCall');
    const getApprovalIndex = resumeToolApproval.indexOf('repository.getApprovalRequest');
    const getToolExecutionIndex = resumeToolApproval.indexOf('repository.getToolExecution(approvalRequest.toolExecutionId)');
    const deniedBranchIndex = resumeToolApproval.indexOf("input.decision === 'denied'");
    const rejectedResultIndex = resumeToolApproval.indexOf("kind: 'user_rejected'");
    const sessionLookupIndex = resumeToolApproval.indexOf('repository.getRunSessionId');
    const approvedSaveApprovalIndex = resumeToolApproval.indexOf(
      'repository.saveApprovalRequest',
      sessionLookupIndex,
    );
    const executeIndex = resumeToolApproval.indexOf('toolExecutionRouter.executeToolExecution');
    const deniedBranch = resumeToolApproval.slice(deniedBranchIndex, sessionLookupIndex);
    const deniedSaveApprovalIndex = deniedBranch.indexOf('repository.saveApprovalRequest');

    expect(getApprovalIndex).toBeGreaterThan(-1);
    expect(getToolExecutionIndex).toBeGreaterThan(getApprovalIndex);
    expect(deniedBranchIndex).toBeGreaterThan(getToolExecutionIndex);
    expect(deniedSaveApprovalIndex).toBeGreaterThan(-1);
    expect(rejectedResultIndex).toBeGreaterThan(deniedBranchIndex);
    expect(sessionLookupIndex).toBeGreaterThan(rejectedResultIndex);
    expect(approvedSaveApprovalIndex).toBeGreaterThan(sessionLookupIndex);
    expect(executeIndex).toBeGreaterThan(approvedSaveApprovalIndex);
    expect(resumeToolApproval).not.toContain('evaluatePermissionPolicy({');
  });

  it('does not introduce MCP, bypass permissions, or TaskIntent into built-in execution', () => {
    const combined = [
      ...listSourceFiles('packages/tools/built-ins'),
      'apps/desktop/src/main/services/tool/tool-call-handler.service.ts',
      'apps/desktop/src/main/services/tool/built-in-tool-source-executor.service.ts',
      'apps/desktop/src/main/services/tool/tool-execution-router.service.ts',
      ...listSourceFiles('apps/desktop/src/main/services/tool/tool-executors'),
    ].map(read).join('\n');

    expect(combined).not.toContain('bypassPermissions');
    expect(combined).not.toContain('dontAsk');
    expect(combined).not.toContain('TaskIntent');
    expect(combined).not.toContain('OutputExpectation');
    expect(combined).not.toContain('Task Mode');
    expect(combined).not.toContain('RunAction.call_tool');
    expect(combined).not.toContain('action-centered');
    expect(combined).not.toContain('mcp_tool_execute');
  });
});
