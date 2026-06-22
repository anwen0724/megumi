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
    const definitions = read('packages/coding-agent/tools/built-ins/index.ts');

    expect(definitions).toContain("'run_command'");
    expect(definitions).not.toContain("'powershell'");
    expect(definitions).not.toContain("'shell_run_command'");
    expect(definitions).toContain("'read_file'");
    expect(definitions).not.toContain("'workspace_read_file'");
  });

  it('keeps real filesystem and shell execution out of coding-agent tools', () => {
    const source = [
      ...listSourceFiles('packages/coding-agent/tools'),
    ]
      .map(read)
      .join('\n');

    expect(source).not.toContain("from 'node:fs'");
    expect(source).not.toContain("from 'fs-extra'");
    expect(source).not.toContain("from 'node:child_process'");
    expect(source).not.toContain('spawn(');
  });

  it('keeps Host execution behind PermissionPolicy', () => {
    const orchestrator = read('packages/coding-agent/tools/tool-orchestrator.ts');
    const applyDecision = functionSection(orchestrator, 'applyDecision', 'advanceExecutionWindows');
    const runRecord = functionSection(orchestrator, 'runRecord', 'budgetProfileForRecord');

    expect(applyDecision).toContain('permissionDecisionForRecord');
    expect(applyDecision).toContain('decisionEvaluator.evaluate');
    expect(applyDecision).toContain("decision.outcome === 'requireApproval'");
    expect(applyDecision).toContain("decision.outcome === 'reject'");
    expect(runRecord).toContain('toolExecutionRouter.executeToolExecution');
  });

  it('keeps approval resume behind a persisted approved ApprovalRequest', () => {
    const orchestrator = read('packages/coding-agent/tools/tool-orchestrator.ts');
    const resumeToolApproval = functionSection(orchestrator, 'resumeToolApproval', 'prepareRecords');
    const getApprovalIndex = resumeToolApproval.indexOf('repository.getApprovalRequest');
    const getToolExecutionIndex = resumeToolApproval.indexOf('repository.getToolExecution(approval.toolExecutionId)');
    const deniedBranchIndex = resumeToolApproval.indexOf("input.decision === 'denied'");
    const rejectionObservationIndex = resumeToolApproval.indexOf('createRejectionObservation');
    const approvedQueueIndex = resumeToolApproval.indexOf("status: 'queued'");
    const advanceIndex = resumeToolApproval.indexOf('advanceExecutionWindows');
    const saveApprovalIndex = resumeToolApproval.indexOf('repository.saveApprovalRequest');

    expect(getApprovalIndex).toBeGreaterThan(-1);
    expect(getToolExecutionIndex).toBeGreaterThan(getApprovalIndex);
    expect(saveApprovalIndex).toBeGreaterThan(getToolExecutionIndex);
    expect(deniedBranchIndex).toBeGreaterThan(saveApprovalIndex);
    expect(rejectionObservationIndex).toBeGreaterThan(deniedBranchIndex);
    expect(approvedQueueIndex).toBeGreaterThan(saveApprovalIndex);
    expect(advanceIndex).toBeGreaterThan(approvedQueueIndex);
    expect(resumeToolApproval).not.toContain('decisionEvaluator.evaluate');
  });

  it('does not introduce MCP, bypass permissions, or TaskIntent into built-in execution', () => {
    const combined = [
      ...listSourceFiles('packages/coding-agent/tools/built-ins'),
      'packages/coding-agent/tools/tool-orchestrator.ts',
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
