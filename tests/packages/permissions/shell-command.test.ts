// @vitest-environment node
/* Verifies shell-aware conservative parsing without making the parser public API. */
import { describe, expect, it } from 'vitest';
import { classifyShellCommand } from '../../../packages/permissions/src/shell-command';

describe('Shell Command classification', () => {
  it('does not treat operators inside quotes as shell control flow', () => {
    expect(classifyShellCommand({
      command: "Get-Content 'a|b.txt'",
      shellKind: 'powershell',
    })).toMatchObject({ classification: 'read_only', hasControlOperator: false });
  });

  it('classifies every segment and raises the highest risk', () => {
    expect(classifyShellCommand({
      command: 'git status && npm install',
      shellKind: 'posix_shell',
    })).toMatchObject({ classification: 'dependency_install', hasControlOperator: true });
    expect(classifyShellCommand({
      command: 'dir & del important.txt',
      shellKind: 'cmd',
    })).toMatchObject({ classification: 'destructive', hasControlOperator: true });
  });

  it('fails closed for nested shells and an unknown shell kind', () => {
    expect(classifyShellCommand({
      command: 'powershell -Command "Remove-Item x"',
      shellKind: 'powershell',
    })).toMatchObject({ classification: 'destructive' });
    expect(classifyShellCommand({
      command: 'echo hello',
      shellKind: 'unknown',
    })).toMatchObject({ classification: 'unknown_shell' });
  });
});
