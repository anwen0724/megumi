import { describe, expect, it } from 'vitest';
import { classifyCommand } from '@megumi/security/command-classifier';

describe('classifyCommand', () => {
  it('classifies read-only, verification, and git read commands', () => {
    expect(classifyCommand('pwd').label).toBe('read_only');
    expect(classifyCommand('npm test').label).toBe('verification');
    expect(classifyCommand('npx tsc --noEmit').label).toBe('verification');
    expect(classifyCommand('git status').label).toBe('git_read');
    expect(classifyCommand('rg PermissionPolicy packages').label).toBe('search_or_list');
  });

  it('classifies high risk commands conservatively', () => {
    expect(classifyCommand('npm install lodash').label).toBe('dependency_install');
    expect(classifyCommand('git commit -m test').label).toBe('git_mutation');
    expect(classifyCommand('curl https://example.com').label).toBe('network');
    expect(classifyCommand('rm -rf dist').label).toBe('destructive');
    expect(classifyCommand('unknown-tool --flag').label).toBe('unknown');
  });

  it('does not auto-allow commands with shell redirection or control operators', () => {
    for (const command of [
      'cat package.json > out.txt',
      'rg TODO > hits.txt',
      'npm test > test.log',
      'npm test && rm -rf dist',
      'rg TODO | tee hits.txt',
    ]) {
      expect(classifyCommand(command).label).not.toBe('read_only');
      expect(classifyCommand(command).label).not.toBe('search_or_list');
      expect(classifyCommand(command).label).not.toBe('verification');
    }
  });
});
