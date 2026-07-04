import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '../../../..');

function exists(relativePath: string): boolean {
  return existsSync(join(repoRoot, relativePath));
}

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('session module boundary v2', () => {
  it('uses the target module structure', () => {
    expect(exists('packages/coding-agent/session/contracts/session-contracts.ts')).toBe(true);
    expect(exists('packages/coding-agent/session/services/session-service.ts')).toBe(true);
    expect(exists('packages/coding-agent/session/repositories/session-repository.ts')).toBe(true);
    expect(exists('packages/coding-agent/session/core/session-path.ts')).toBe(true);

    expect(exists('packages/coding-agent/session/session-service.ts')).toBe(false);
    expect(exists('packages/coding-agent/session/session-messages.ts')).toBe(false);
    expect(exists('packages/coding-agent/session/session-branch-service.ts')).toBe(false);
    expect(exists('packages/coding-agent/session/session-context-input.ts')).toBe(false);
  });

  it('keeps the public index limited to contracts and services', () => {
    const source = read('packages/coding-agent/session/index.ts');

    expect(source).toContain("export * from './contracts/session-contracts'");
    expect(source).toContain("from './services/session-service'");
    expect(source).toContain('createSessionService');
    expect(source).not.toContain('DefaultSessionService');
    expect(source).not.toContain('./core/');
    expect(source).not.toContain('./repositories/');
  });

  it('keeps Session independent from raw input, command, prompt, tool, runtime event, and desktop ownership', () => {
    const files = [
      'packages/coding-agent/session/contracts/session-contracts.ts',
      'packages/coding-agent/session/services/session-service.ts',
      'packages/coding-agent/session/repositories/session-repository.ts',
      'packages/coding-agent/session/core/session-path.ts',
      'packages/coding-agent/session/index.ts',
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).not.toContain(['@megumi/shared', 'session'].join('/'));
      expect(source).not.toContain('../input');
      expect(source).not.toContain('../commands');
      expect(source).not.toContain('../tools');
      expect(source).not.toContain('../agent-loop');
      expect(source).not.toContain('Prompt');
      expect(source).not.toContain('RuntimeEvent');
      expect(source).not.toContain('apps/desktop');
    }
  });

  it('keeps Session business SQL inside the Session repository', () => {
    const sessionRepository = read('packages/coding-agent/session/repositories/session-repository.ts');
    expect(sessionRepository).toContain('session_messages');
    expect(sessionRepository).toContain('session_entries');
    expect(sessionRepository).toContain('session_message_attachments');
    expect(sessionRepository).toContain('session_compactions');

    expect(read('packages/coding-agent/session/services/session-service.ts')).not.toContain(['persistence/repos', 'session.repo'].join('/'));
    expect(read('packages/coding-agent/session/repositories/session-repository.ts')).not.toContain(['persistence/repos', 'session.repo'].join('/'));
    expect(exists(['packages/coding-agent/persistence/repos', 'session.repo.ts'].join('/'))).toBe(true);
  });
});
