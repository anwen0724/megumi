/* Protects one-way Evaluation dependencies, credential secrecy, and isolated Trace ownership. */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Evaluation architecture boundary', () => {
  it('does not introduce production imports from evals', async () => {
    const tsconfig = await readFile('tsconfig.json', 'utf8');
    expect(tsconfig).not.toContain('"@megumi/evaluation"');
    const composition = await readFile('packages/agent/composition/src/index.ts', 'utf8');
    expect(composition).not.toContain('evals/');
  });

  it('resolves a Candidate credential from an explicit environment variable without recording it', async () => {
    const modelSource = await readFile('evals/agent/adapters/candidate-model.ts', 'utf8');
    const runContract = await readFile('evals/agent/contracts/evaluation-run.ts', 'utf8');
    const storage = await readFile('evals/agent/run/run-storage.ts', 'utf8');
    expect(modelSource).toContain('input.environment[input.config.credentialEnvironmentVariable]');
    expect(modelSource).not.toContain('createSettingsCredentialStore');
    expect(runContract).toContain('credentialEnvironmentVariable');
    expect(runContract).not.toMatch(/CandidateModelRecordSchema[\s\S]*credentialEnvironmentVariable/iu);
    expect(storage).toContain('redactSecrets');
  });

  it('queries Trace through Product Host and archives only the isolated Case Trace store', async () => {
    const record = await readFile('evals/agent/run/case-record.ts', 'utf8');
    const environment = await readFile('evals/agent/run/case-environment.ts', 'utf8');
    expect(record).toContain('runtime.host.observability.flush');
    expect(record).toContain('runtime.host.observability.listTraces');
    expect(record).toContain('runtime.host.observability.getHealth');
    expect(record).not.toContain("from '@megumi/observability'");
    expect(record).not.toContain('TraceJournal');
    expect(environment).toContain("const observability = path.join(home, 'logs', 'observability')");
  });
});
