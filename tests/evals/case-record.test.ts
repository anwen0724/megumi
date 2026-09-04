/* Verifies independent evidence archives and preservation of facts on storage-boundary failures. */
// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { archiveCaseEvidence } from '../../evals/agent/run/case-record';
import { createRunStorage } from '../../evals/agent/run/run-storage';
import { loadCase } from '../../evals/agent/datasets/dataset-loader';

describe('Case evidence', () => {
  it('keeps business results when an artifact source cannot be archived', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'megumi-evidence-failure-'));
    try {
      const resolved = await loadCase({ rootDirectory: path.resolve('evals/agent/datasets'), identity: 'controlled/recommendation.select-relevant-candidate' });
      const storage = await createRunStorage({ evaluationRoot: root, runId: 'archive.failure' });
      const integrity = { status: 'complete' as const, traceCount: 0, health: {}, targets: [], issues: [] };
      const saved = await storage.writeCaseRecord({
        snapshot: { identity: resolved.identity, environmentKind: resolved.environmentKind, revision: resolved.case.revision, digest: resolved.digest,
          resources: resolved.resources, datasetMemberships: [], case: resolved.case },
        initialState: { status: 'captured', facts: { candidates: ['candidate-1'] } },
        result: { schemaVersion: 2, caseRunId: 'recommendation.failure', caseIdentity: resolved.identity, caseType: 'recommendation',
          recordStatus: 'recorded', startedAt: '2026-01-15T08:00:00.000Z', endedAt: '2026-01-15T08:01:00.000Z', terminalState: 'settled',
          candidateModel: { source: 'explicit', providerId: 'test', modelId: 'test', api: 'openai-completions', baseUrl: 'https://example.test', contextWindowTokens: 1000, maxOutputTokens: 100 },
          environment: {}, businessIds: { recommendationIds: ['published-1'] }, productResult: { status: 'published' },
          finalState: { status: 'captured', facts: { recommendations: ['published-1'] } }, issues: [], traceIntegrity: integrity,
        },
        evidence: { traceIntegrity: integrity, workspaceRoot: path.join(root, 'missing-workspace') },
      });
      expect(saved.result).toMatchObject({ recordStatus: 'infrastructure_failed', terminalState: 'settled', productResult: { status: 'published' },
        finalState: { status: 'captured', facts: { recommendations: ['published-1'] } }, issues: [{ phase: 'archive' }],
      });
      expect(JSON.parse(await readFile(path.join(storage.runDirectory, saved.resultPath), 'utf8'))).toEqual(saved.result);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('keeps initial file contents independently and records changed, added, and deleted files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'megumi-evidence-'));
    try {
      const initial = path.join(root, 'initial');
      const workspace = path.join(root, 'workspace');
      const destination = path.join(root, 'record');
      await mkdir(initial); await mkdir(workspace);
      await writeFile(path.join(initial, 'deleted.txt'), 'old');
      await writeFile(path.join(initial, 'changed.txt'), 'before');
      await writeFile(path.join(initial, 'same.txt'), 'same');
      await writeFile(path.join(workspace, 'changed.txt'), 'after');
      await writeFile(path.join(workspace, 'same.txt'), 'same');
      await writeFile(path.join(workspace, 'new.txt'), 'new');
      const hash = (value: string) => createHash('sha256').update(value).digest('hex');
      const result = await archiveCaseEvidence({ destination, workspaceRoot: workspace, initialWorkspaceRoot: initial,
        initialWorkspaceFiles: { 'deleted.txt': hash('old'), 'changed.txt': hash('before'), 'same.txt': hash('same') },
        traceIntegrity: { status: 'complete', traceCount: 0, health: {}, targets: [], issues: [] },
      });
      expect(result.deletedFiles).toEqual(['deleted.txt']);
      expect(result.files.map(({ path: file }) => file)).toEqual(['workspace/changed.txt', 'workspace/new.txt']);
      expect(result.initialFiles).toHaveLength(3);
      expect(await readFile(path.join(destination, 'artifacts/initial-workspace/deleted.txt'), 'utf8')).toBe('old');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
