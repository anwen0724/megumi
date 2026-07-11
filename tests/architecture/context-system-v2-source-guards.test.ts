/*
 * Guards the Context v2 package structure and stable public surface.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function exists(relativePath: string): boolean {
  return fs.existsSync(path.join(root, relativePath));
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('Context system v2 source guards', () => {
  it('provides the target domain and service contract files', () => {
    expect(exists('packages/coding-agent/context/domain/model/active-context.ts')).toBe(true);
    expect(exists('packages/coding-agent/context/domain/model/prompt.ts')).toBe(true);
    expect(exists('packages/coding-agent/context/domain/model/conversation-turn.ts')).toBe(true);
    expect(exists('packages/coding-agent/context/domain/model/context-usage.ts')).toBe(true);
    expect(exists('packages/coding-agent/context/domain/model/compaction.ts')).toBe(true);
    expect(exists('packages/coding-agent/context/service/context-service.ts')).toBe(true);
    expect(exists('packages/coding-agent/context/service/context-service-types.ts')).toBe(true);
  });

  it('exports only the stable public surface', () => {
    const publicIndex = read('packages/coding-agent/context/index.ts');

    expect(publicIndex).not.toContain('/internal/');
    expect(publicIndex).not.toContain('UsageMonitor');
    expect(publicIndex).not.toContain('signalBus');
    expect(publicIndex).not.toContain('./contracts/');
    expect(publicIndex).not.toContain('./core/');
    expect(publicIndex).not.toContain('./services/');
  });

  it('does not create repository or ports layers', () => {
    expect(exists('packages/coding-agent/context/repository')).toBe(false);
    expect(exists('packages/coding-agent/context/ports')).toBe(false);
  });
});
