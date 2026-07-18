import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const moduleRoot = path.join(repoRoot, 'packages/agent/agent-run');

function readFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? readFiles(fullPath) : [fullPath];
  });
}

describe('agent-run module boundary', () => {
  it('exists and exposes only public module API from index.ts', async () => {
    const indexPath = path.join(moduleRoot, 'index.ts');

    expect(fs.existsSync(indexPath)).toBe(true);

    const source = fs.readFileSync(indexPath, 'utf8');
    expect(source).toContain("contracts/agent-run-contracts");
    expect(source).toContain("contracts/model-call-contracts");
    expect(source).not.toContain('/core/');
    expect(source).not.toContain('/repositories/');
    expect(source).not.toContain('/adapters/');

    const publicApi = await import('@megumi/agent/agent-run');
    expect(publicApi).toHaveProperty('createAgentRunService');
    expect(publicApi).toHaveProperty('createModelCallService');
  });

  it('does not depend on legacy run modules or shared runtime contracts', () => {
    const files = readFiles(moduleRoot).filter((file) => file.endsWith('.ts'));

    expect(files.length).toBeGreaterThan(0);

    const forbidden = [
      '@megumi/agent/artifacts/legacy-contracts/plan-artifact-contracts',
      '@megumi/agent/tools',
      '@megumi/agent/memory/legacy-contracts/memory-external-contracts',
      ['@megumi', 'shared', 'session'].join('/'),
      ['@megumi', 'shared', 'run'].join('/'),
      'packages/agent/agent-loop',
      '@megumi/agent/agent-loop',
      'packages/agent/state',
      '@megumi/agent/state',
    ];

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        expect(source, `${path.relative(repoRoot, file)} must not import ${pattern}`).not.toContain(pattern);
      }
    }
  });

  it('does not import other modules internals', () => {
    const files = readFiles(moduleRoot).filter((file) => file.endsWith('.ts'));

    for (const file of files) {
      const relative = path.relative(moduleRoot, file).replaceAll(path.sep, '/');
      const source = fs.readFileSync(file, 'utf8');
      const imports = source.matchAll(/from\s+['"]([^'"]+)['"]/g);

      for (const [, specifier] of imports) {
        if (relative.startsWith('contracts/')) {
          expect(specifier).not.toMatch(/\/(core|repositories|adapters)(\/|$)/);
        }
        if (!specifier.startsWith('../') && !specifier.startsWith('./')) {
          expect(specifier).not.toMatch(/\/(core|repositories|adapters)(\/|$)/);
        }
      }
    }
  });
});
