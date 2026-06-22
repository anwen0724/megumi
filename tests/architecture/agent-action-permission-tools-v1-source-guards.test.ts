// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function readProjectFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('agent action permission tools v1 source guards', () => {
  it('keeps permission mode contracts on the v1 target posture set without legacy task taxonomy', () => {
    const source = readProjectFile('packages/shared/permission/mode-contracts.ts');

    expect(source).toContain("['default', 'accept_edits', 'plan', 'auto']");
    expect(source).not.toContain('TaskIntent');
    expect(source).not.toContain('OutputExpectation');
    expect(source).not.toContain('bypassPermissions');
    expect(source).not.toContain('bypass_permissions');
    expect(source).not.toContain('dontAsk');
    expect(source).not.toContain("'read_only'");
    expect(source).not.toContain("'chat'");
    expect(source).not.toContain("'execute'");
    expect(source).not.toContain("'review'");
  });

  it('keeps tool executions linked to model-side ToolCall with optional Host maintenance action ids', () => {
    const source = readProjectFile('packages/shared/tool/contracts.ts');

    expect(source).toContain('toolCallId: ToolCallId | string');
    expect(source).toContain('toolExecutionId: ToolExecutionId | string');
    expect(source).toContain('actionId?: RunActionId | string');
    expect(source).not.toContain('actionKind: RunActionKindSchema');
    expect(source).not.toContain('bypassPermissions');
    expect(source).not.toContain('dontAsk');
    expect(source).not.toContain("'workspace_write'");
    expect(source).not.toContain("'workspace_read'");
  });

  it('keeps permission decision persistence markers in schema and repository code', () => {
    const migrations = readProjectFile('packages/coding-agent/persistence/schema/migrations.ts');
    const repository = readProjectFile('packages/coding-agent/persistence/repos/tool.repo.ts');
    const persistenceSources = `${migrations}\n${repository}`;

    expect(migrations).toContain('CREATE TABLE IF NOT EXISTS permission_decisions');
    expect(migrations).toContain('classifier_label TEXT');
    expect(migrations).toContain('side_effect TEXT NOT NULL');
    expect(repository).toContain('savePermissionDecision');
    expect(repository).toContain('listPermissionDecisionsByToolCall');

    for (const marker of [
      'CREATE TABLE IF NOT EXISTS permission_decisions',
      'classifier_label TEXT',
      'side_effect TEXT NOT NULL',
      'savePermissionDecision',
      'listPermissionDecisionsByToolCall',
    ]) {
      expect(persistenceSources).toContain(marker);
    }
  });
});
