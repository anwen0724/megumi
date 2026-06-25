import { describe, expect, it } from 'vitest';
import { matchPermissionRule } from '@megumi/coding-agent/run/permissions/permission-rule-matcher';

describe('matchPermissionRule', () => {
  it('matches command and path patterns against normalized tool input', () => {
    expect(matchPermissionRule('run_command(npm test)', {
      toolName: 'run_command',
      input: { command: 'npm test' },
    })).toMatchObject({ matched: true, argument: 'npm test' });

    expect(matchPermissionRule('read_file(src/**)', {
      toolName: 'read_file',
      input: { path: 'src/index.ts' },
    }).matched).toBe(true);
  });

  it('does not match another tool name or unrelated argument', () => {
    expect(matchPermissionRule('read_file(README.md)', {
      toolName: 'run_command',
      input: { command: 'README.md' },
    }).matched).toBe(false);

    expect(matchPermissionRule('run_command(npm test)', {
      toolName: 'run_command',
      input: { command: 'npm install' },
    }).matched).toBe(false);
  });
});
