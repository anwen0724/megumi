/* Verifies stable Evaluation contracts and cross-file configuration resolution. */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EvaluationCaseSchema,
  EvaluationSuiteSchema,
  EvaluationTargetSchema,
  ExecutionProfileSchema,
  loadEvaluationCatalog,
} from '../../../evals/agent';

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Evaluation configuration', () => {
  it('keeps case, suite, target, and profile responsibilities separate', () => {
    const evaluationCase = EvaluationCaseSchema.parse({
      schemaVersion: 1,
      caseId: 'reply-smoke',
      name: 'Reply smoke',
      description: 'Produces a final reply.',
      tags: ['smoke'],
      request: { text: 'Reply with OK.' },
      graders: [{ graderId: 'final-reply', type: 'final_reply', required: true }],
    });
    const suite = EvaluationSuiteSchema.parse({
      schemaVersion: 1,
      suiteId: 'smoke',
      name: 'Smoke',
      description: 'Core path.',
      caseIds: ['reply-smoke'],
      executionProfileId: 'controlled-files',
      policy: {
        repetitions: 1,
        requiredCaseIds: ['reply-smoke'],
        minimumPassRate: 1,
        maximumInvalidExecutionRate: 0,
        needsReview: 'blocks',
      },
    });
    const target = EvaluationTargetSchema.parse({
      targetId: 'deepseek-chat',
      name: 'DeepSeek Chat',
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
    });
    const profile = ExecutionProfileSchema.parse({
      profileId: 'controlled-files',
      name: 'Controlled files',
      environmentKind: 'controlled',
      permissionMode: 'ask',
      enabledTools: ['read_file', 'write_file'],
      networkAccess: 'disabled',
      isolation: 'workspace_only',
      limits: { wallClockMs: 30_000, maxModelCalls: 4, maxToolCalls: 8 },
    });

    expect(evaluationCase).not.toHaveProperty('providerId');
    expect(suite.executionProfileId).toBe(profile.profileId);
    expect(target).not.toHaveProperty('permissionMode');
    expect(profile).not.toHaveProperty('repetitions');
  });

  it('rejects invalid policy thresholds and executable grader paths', () => {
    expect(() => EvaluationSuiteSchema.parse({
      schemaVersion: 1,
      suiteId: 'invalid',
      name: 'Invalid',
      description: 'Invalid thresholds.',
      caseIds: ['case-a'],
      executionProfileId: 'profile-a',
      policy: {
        repetitions: 0,
        requiredCaseIds: [],
        minimumPassRate: 1.1,
        maximumInvalidExecutionRate: -0.1,
        needsReview: 'blocks',
      },
    })).toThrow();

    expect(() => EvaluationCaseSchema.parse({
      schemaVersion: 1,
      caseId: 'unsafe-grader',
      name: 'Unsafe grader',
      description: 'Cannot load arbitrary code.',
      tags: [],
      request: { text: 'Do work.' },
      graders: [{ graderId: 'custom', type: 'custom', modulePath: './grader.js' }],
    })).toThrow();
  });

  it('resolves explicit suite membership and rejects unknown references', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'megumi-eval-config-'));
    roots.push(root);
    for (const directory of ['cases', 'suites', 'config/targets', 'config/profiles']) {
      await mkdir(path.join(root, directory), { recursive: true });
    }
    await writeJson(path.join(root, 'cases/reply.json'), {
      schemaVersion: 1,
      caseId: 'reply',
      name: 'Reply',
      description: 'Reply case.',
      tags: ['smoke'],
      request: { text: 'Reply.' },
      graders: [{ graderId: 'reply', type: 'final_reply', required: true }],
    });
    await writeJson(path.join(root, 'suites/smoke.json'), {
      schemaVersion: 1,
      suiteId: 'smoke',
      name: 'Smoke',
      description: 'Smoke suite.',
      caseIds: ['reply'],
      executionProfileId: 'controlled',
      policy: {
        repetitions: 1,
        requiredCaseIds: ['reply'],
        minimumPassRate: 1,
        maximumInvalidExecutionRate: 0,
        needsReview: 'blocks',
      },
    });
    await writeJson(path.join(root, 'config/targets/test.json'), {
      targetId: 'test', name: 'Test', providerId: 'test', modelId: 'test-model',
    });
    await writeJson(path.join(root, 'config/profiles/controlled.json'), {
      profileId: 'controlled',
      name: 'Controlled',
      environmentKind: 'controlled',
      permissionMode: 'ask',
      enabledTools: [],
      networkAccess: 'disabled',
      isolation: 'workspace_only',
      limits: { wallClockMs: 1_000 },
    });

    const catalog = await loadEvaluationCatalog(root);
    expect(catalog.suites[0]?.caseIds).toEqual(['reply']);

    await writeJson(path.join(root, 'suites/broken.json'), {
      schemaVersion: 1,
      suiteId: 'broken',
      name: 'Broken',
      description: 'Unknown case.',
      caseIds: ['missing'],
      executionProfileId: 'controlled',
      policy: {
        repetitions: 1,
        requiredCaseIds: [],
        minimumPassRate: 1,
        maximumInvalidExecutionRate: 0,
        needsReview: 'blocks',
      },
    });
    await expect(loadEvaluationCatalog(root)).rejects.toThrow(/missing/);
  });
});

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
