/* Protects one-way Evaluation dependencies and isolated artifact ownership. */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Evaluation architecture boundary', () => {
  it('does not introduce production imports from evals', async () => {
    const tsconfig = await readFile('tsconfig.json', 'utf8');
    expect(tsconfig).not.toContain('"@megumi/evaluation"');
    const composition = await readFile('packages/agent/composition/src/index.ts', 'utf8');
    expect(composition).not.toContain('evals/');
  });

  it('keeps candidate and Grader credentials out of the Run manifest', async () => {
    const source = await readFile('evals/agent/runtime/evaluation-runner.ts', 'utf8');
    expect(source).not.toContain('apiKey: model');
    expect(source).toContain('apiKeyEnv');
  });
});

