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

  it('keeps credential resolution at the model-source boundary instead of the Run manifest', async () => {
    const execution = await readFile('evals/agent/execution/run-evaluation.ts', 'utf8');
    const modelSource = await readFile('evals/agent/adapters/evaluation-model-source.ts', 'utf8');
    const grader = await readFile('evals/agent/grading/model-grader.ts', 'utf8');
    expect(execution).not.toContain('apiKeyEnv');
    expect(execution).not.toContain('apiKey:');
    expect(modelSource).toContain('createSettingsCredentialStore');
    expect(grader).not.toContain('readonly apiKey: string');
  });
});
