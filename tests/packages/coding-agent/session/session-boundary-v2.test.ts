import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '../../../..');
const exists = (path: string) => existsSync(join(repoRoot, path));
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

describe('session module architecture', () => {
  it('uses the confirmed domain, service, repository, and config structure', () => {
    for (const path of [
      'packages/coding-agent/session/domain/model/session.ts',
      'packages/coding-agent/session/domain/model/session-message.ts',
      'packages/coding-agent/session/domain/model/session-entry.ts',
      'packages/coding-agent/session/domain/model/session-attachment.ts',
      'packages/coding-agent/session/domain/dto/agent-run/session-agent-run-request.ts',
      'packages/coding-agent/session/domain/dto/context/session-context-request.ts',
      'packages/coding-agent/session/service/session-service.ts',
      'packages/coding-agent/session/service/session-service-impl.ts',
      'packages/coding-agent/session/service/session-service-types.ts',
      'packages/coding-agent/session/service/session-branch-service.ts',
      'packages/coding-agent/session/service/internal/session-path.ts',
      'packages/coding-agent/session/repository/session-repository.ts',
      'packages/coding-agent/session/config/compose-coding-agent-session.ts',
    ]) expect(exists(path)).toBe(true);

    expect(exists('packages/coding-agent/session/contracts/session-contracts.ts')).toBe(false);
    expect(exists('packages/coding-agent/session/core/session-path.ts')).toBe(false);
    expect(exists('packages/coding-agent/session/services/session-service.ts')).toBe(false);
    expect(exists('packages/coding-agent/session/repositories/session-repository.ts')).toBe(false);
  });

  it('keeps repository and implementation details out of the public index', () => {
    const source = read('packages/coding-agent/session/index.ts');
    expect(source).toContain("./service/session-service");
    expect(source).toContain("./config/compose-coding-agent-session");
    expect(source).not.toContain('session-service-impl');
    expect(source).not.toContain('./repository/');
    expect(source).not.toContain('/internal/');
  });

  it('keeps Session SQL in its repository and avoids a second attachment service', () => {
    const repository = read('packages/coding-agent/session/repository/session-repository.ts');
    for (const table of ['session_messages', 'session_entries', 'session_message_attachments', 'session_compactions']) {
      expect(repository).toContain(table);
    }
    expect(exists('packages/coding-agent/session/service/session-attachment-content-service.ts')).toBe(false);
    expect(exists('packages/coding-agent/session/domain/session-attachment-content-contracts.ts')).toBe(false);
  });
});
