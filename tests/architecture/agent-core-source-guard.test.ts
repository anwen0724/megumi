/* Guards the Agent Core's physical shape, dependency direction, and private implementation surface. */
// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const agentRoot = join(root, 'packages/agent-core');

describe('Agent Core architecture boundaries', () => {
  it('keeps the approved six-file source shape', () => {
    expect(readdirSync(join(agentRoot, 'src')).sort()).toEqual([
      'agent-loop.ts',
      'agent.ts',
      'index.ts',
      'model-call.ts',
      'tool-call.ts',
      'types.ts',
    ]);
  });

  it('does not export internal execution modules from the package index', () => {
    const index = read('src/index.ts');
    expect(index).not.toMatch(/runAgentLoop|runModelCall|runToolCallBatch/u);
    expect(index).not.toMatch(/from ['"]\.\/(?:agent-loop|model-call|tool-call)['"]/u);
  });

  it('depends and references only the provider-neutral AI package', () => {
    const manifest = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>;
    };
    const tsconfig = JSON.parse(read('tsconfig.json')) as {
      references?: Array<{ path: string }>;
    };
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['@megumi/ai']);
    expect(tsconfig.references).toEqual([{ path: '../ai' }]);
  });

  it('does not import product or Harness owners into Agent Core', () => {
    const source = readdirSync(join(agentRoot, 'src'))
      .filter((file) => file.endsWith('.ts'))
      .map((file) => readFileSync(join(agentRoot, 'src', file), 'utf8'))
      .join('\n');
    const forbiddenImports = [
      '@megumi/engine',
      '@megumi/context',
      '@megumi/session',
      '@megumi/tools',
      '@megumi/permissions',
      '@megumi/events',
      '@megumi/observability',
      '@megumi/product-host',
      '@megumi/database',
      '@megumi/discovery',
      'electron',
    ];
    expect(forbiddenImports.filter((term) => source.includes(`from '${term}`))).toEqual([]);
    expect(source).not.toMatch(/\b(?:Run|Session|Workspace|Permission|Approval|Sandbox|Product)\b/u);
  });
});

function read(relativePath: string): string {
  return readFileSync(join(agentRoot, relativePath), 'utf8');
}
