import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '../../../..');
const exists = (path: string) => existsSync(join(repoRoot, path));
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

describe('input module architecture', () => {
  it('uses domain, service, and config without legacy compatibility paths', () => {
    for (const path of [
      'packages/agent/input/domain/model/user-input.ts',
      'packages/agent/input/domain/dto/agent-run/input-agent-run-request.ts',
      'packages/agent/input/domain/dto/agent-run/input-agent-run-response.ts',
      'packages/agent/input/service/input-service.ts',
      'packages/agent/input/service/input-service-impl.ts',
      'packages/agent/input/service/input-service-types.ts',
      'packages/agent/input/service/internal/raw-input-normalizer.ts',
      'packages/agent/input/service/internal/user-input-classifier.ts',
      'packages/agent/input/config/compose-agent-input.ts',
    ]) expect(exists(path)).toBe(true);

    expect(exists('packages/agent/input/contracts/input-contracts.ts')).toBe(false);
    expect(exists('packages/agent/input/core/raw-input-normalizer.ts')).toBe(false);
    expect(exists('packages/agent/input/services/input-service.ts')).toBe(false);
    expect(exists('packages/agent/input/repository')).toBe(false);
  });

  it('keeps the public index free of internal implementation exports', () => {
    const index = read('packages/agent/input/index.ts');
    expect(index).toContain("./domain/model/user-input");
    expect(index).toContain("./service/input-service");
    expect(index).toContain("./config/compose-agent-input");
    expect(index).not.toContain('/internal/');
    expect(index).not.toContain('input-service-impl');
  });

  it('does not let Input own commands, session, persistence, or desktop', () => {
    const source = [
      'packages/agent/input/domain/model/user-input.ts',
      'packages/agent/input/service/input-service.ts',
      'packages/agent/input/service/input-service-impl.ts',
      'packages/agent/input/service/internal/user-input-classifier.ts',
    ].map(read).join('\n');
    for (const forbidden of ['../commands', '../session', '../persistence', 'apps/desktop', 'CommandService']) {
      expect(source).not.toContain(forbidden);
    }
  });
});
