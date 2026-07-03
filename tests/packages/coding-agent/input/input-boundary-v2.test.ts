import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '../../../..');
const inputRoot = join(repoRoot, 'packages/coding-agent/input');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('input module boundary v2', () => {
  it('uses the target contracts/services/core structure only', () => {
    expect(existsSync(join(inputRoot, 'contracts/input-contracts.ts'))).toBe(true);
    expect(existsSync(join(inputRoot, 'services/input-service.ts'))).toBe(true);
    expect(existsSync(join(inputRoot, 'core/raw-input-normalizer.ts'))).toBe(true);
    expect(existsSync(join(inputRoot, 'core/user-input-parser.ts'))).toBe(true);

    expect(existsSync(join(inputRoot, 'input-service.ts'))).toBe(false);
    expect(existsSync(join(inputRoot, 'raw-input.ts'))).toBe(false);
    expect(existsSync(join(inputRoot, 'parsed-input.ts'))).toBe(false);
    expect(existsSync(join(inputRoot, 'session-message.ts'))).toBe(false);
    expect(existsSync(join(inputRoot, 'facts'))).toBe(false);
    expect(existsSync(join(inputRoot, 'preprocessing'))).toBe(false);
  });

  it('does not import command, old input shared contracts, session, run, state, events, persistence, or desktop', () => {
    const files = [
      'packages/coding-agent/input/contracts/input-contracts.ts',
      'packages/coding-agent/input/services/input-service.ts',
      'packages/coding-agent/input/core/raw-input-normalizer.ts',
      'packages/coding-agent/input/core/user-input-parser.ts',
      'packages/coding-agent/input/index.ts',
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).not.toContain('@megumi/shared');
      expect(source).not.toContain('../commands');
      expect(source).not.toContain('@megumi/shared/ipc');
      expect(source).not.toContain('@megumi/shared/prompt-template');
      expect(source).not.toContain('@megumi/shared/skill');
      expect(source).not.toContain('../session');
      expect(source).not.toContain('../agent-loop');
      expect(source).not.toContain('../state');
      expect(source).not.toContain('../events');
      expect(source).not.toContain('../persistence');
      expect(source).not.toContain('apps/desktop');
      expect(source).not.toContain('CommandService');
      expect(source).not.toContain('handleCommandInput');
    }
  });

  it('does not export core implementation from the public index', () => {
    const index = read('packages/coding-agent/input/index.ts');
    expect(index).toContain("export * from './contracts/input-contracts'");
    expect(index).toContain("from './services/input-service'");
    expect(index).not.toContain('./core/');
  });
});
