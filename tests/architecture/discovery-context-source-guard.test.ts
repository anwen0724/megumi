/* Guards Context ownership of every Discovery model-visible Material. */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Discovery Context source ownership', () => {
  it('keeps Runtime run identities free of prebuilt model Material', () => {
    const contextContract = source('packages/agent/context/src/context.ts');
    const execution = source('packages/agent/execution/src/agent-executions.ts');
    const candidateRuntime = source(
      'packages/agent/discovery/src/candidate-supply/candidate-supply-runtime.ts',
    );
    const dailyRuntime = source(
      'packages/agent/discovery/src/daily-recommendation/daily-recommendation-runtime.ts',
    );

    expect(contextContract).not.toMatch(/RunContext[\s\S]{0,500}readonly material:/u);
    expect(execution).not.toContain('readonly material:');
    expect(candidateRuntime).not.toContain('buildMaterial');
    expect(dailyRuntime).not.toContain('contextMaterial');
  });

  it('requires each Discovery Resolver to read its own authoritative Facts', () => {
    for (const file of [
      'packages/agent/context/src/resolvers/candidate-supply-context-resolver.ts',
      'packages/agent/context/src/resolvers/daily-recommendation-context-resolver.ts',
      'packages/agent/context/src/resolvers/preference-learning-context-resolver.ts',
    ]) {
      expect(source(file)).toContain('factsReader');
    }
  });
});

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}
