/* Protects strict Case/Suite loading and the checked-in initial Evaluation catalog. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EvaluationCaseSchema } from '../../evals/agent/catalog/evaluation-case';
import { loadEvaluationCatalog } from '../../evals/agent/catalog/evaluation-catalog';

describe('Agent Evaluation catalog', () => {
  it('loads all approved Cases and Suites with resolvable references', async () => {
    const catalog = await loadEvaluationCatalog(path.resolve('evals/agent'));
    expect(catalog.cases.size).toBe(17);
    expect(catalog.suites.size).toBe(4);
    expect(catalog.resolveSuite('controlled-core').cases.length).toBeGreaterThan(5);
  });

  it('rejects capability field mismatches and unknown fields at the boundary', () => {
    expect(() => EvaluationCaseSchema.parse({
      caseId: 'invalid', revision: 1, fixtureVersion: 1, title: 'Invalid', objective: 'Invalid',
      profiles: ['controlled'], tags: [], capability: 'candidate_supply', setup: { fixtureId: 'x' },
      trigger: { kind: 'send_user_input', text: 'wrong capability' },
      completion: { kind: 'candidate_supply_terminal', timeoutMs: 1 },
      requiredEvidence: ['completion'], grading: { hardGates: [], dimensions: [], surprise: true },
    })).toThrow();
  });
});

