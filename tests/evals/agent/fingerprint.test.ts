/* Verifies canonical, sensitive-safe fingerprints for comparable Evaluation executions. */
import { describe, expect, it } from 'vitest';
import { canonicalDigest, createEvaluationFingerprint } from '../../../evals/agent/runner/evaluation-fingerprint';

describe('Evaluation fingerprint', () => {
  it('is stable across object key order and changes with meaningful content', () => {
    expect(canonicalDigest({ a: 1, b: { x: true, y: 'v' } })).toBe(
      canonicalDigest({ b: { y: 'v', x: true }, a: 1 }),
    );
    expect(canonicalDigest({ a: 1 })).not.toBe(canonicalDigest({ a: 2 }));
  });

  it('provides every comparability dimension without exposing credentials', () => {
    const fingerprint = createEvaluationFingerprint({
      sourceRevision: 'abc123',
      sourceDirty: true,
      evaluationCase: { caseId: 'case', request: { text: 'secret prompt' } },
      fixture: { files: ['a.txt'] },
      suite: { suiteId: 'suite' },
      target: { targetId: 'target', providerId: 'provider', modelId: 'model' },
      executionProfile: { profileId: 'profile' },
      relevantSettings: { apiKey: 'sk-secret', nested: { credential: 'hidden', value: 1 } },
      toolCatalog: [{ name: 'read_file' }],
      skillCatalog: [{ name: 'Explain Problem', skillPath: 'skills/explain/SKILL.md' }],
      instructionSources: [{ path: 'AGENTS.md', digest: 'source-hash' }],
      graderConfig: [{ graderId: 'file' }],
    });

    expect(fingerprint).toMatchObject({
      sourceRevision: 'abc123', sourceDirty: true,
      caseDigest: expect.any(String), fixtureDigest: expect.any(String), suiteDigest: expect.any(String),
      targetDigest: expect.any(String), executionProfileDigest: expect.any(String),
      relevantSettingsDigest: expect.any(String), toolCatalogDigest: expect.any(String),
      skillCatalogDigest: expect.any(String), instructionSourcesDigest: expect.any(String),
      graderConfigDigest: expect.any(String),
    });
    expect(JSON.stringify(fingerprint)).not.toContain('sk-secret');
    expect(JSON.stringify(fingerprint)).not.toContain('secret prompt');
  });
});
