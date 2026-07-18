/*
 * Guards the Agent package against Product Host and Desktop implementation dependencies.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const agentDir = join(process.cwd(), 'packages/agent');

function readTypeScriptTree(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return [readTypeScriptTree(path)];
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) return [];
      return [readFileSync(path, 'utf8')];
    })
    .join('\n');
}

describe('agent tool core boundary', () => {
  const source = readTypeScriptTree(agentDir);

  it('does not import Product Host modules from packages/agent', () => {
    expect(source).not.toMatch(/from ['"]@megumi\/product(?:\/|['"])/);
    expect(source).not.toMatch(/from ['"][^'"]*packages\/product(?:\/|['"])/);
  });

  it('does not import concrete Desktop implementations from packages/agent', () => {
    expect(source).not.toMatch(/from ['"]@megumi\/desktop(?:\/|['"])/);
    expect(source).not.toMatch(/from ['"]electron(?:\/|['"])/);
    expect(source).not.toContain('apps/desktop/src/main');
  });
});
