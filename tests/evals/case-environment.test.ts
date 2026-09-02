/* Verifies that every Evaluation Case runs inside its own real Product environment. */
// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCase } from '../../evals/agent/datasets/dataset-loader';
import { createCaseEnvironment } from '../../evals/agent/run/case-environment';

let temporaryRoot: string | undefined;

afterEach(() => {
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

describe('Case Environment', () => {
  it('creates physically isolated Home, Workspace, database, and Trace roots per Case Run', async () => {
    temporaryRoot = mkdtempSync(path.join(tmpdir(), 'megumi-case-environment-test-'));
    const resolvedCase = await loadCase({
      rootDirectory: path.join(process.cwd(), 'evals', 'agent', 'datasets'),
      identity: 'controlled/conversation.create-workspace-note',
    });
    const first = await createCaseEnvironment({
      repositoryRoot: process.cwd(), resolvedCase, candidateModel: resolvedModel(),
      temporaryParent: temporaryRoot,
    });
    const second = await createCaseEnvironment({
      repositoryRoot: process.cwd(), resolvedCase, candidateModel: resolvedModel(),
      temporaryParent: temporaryRoot,
    });

    try {
      expect(first.paths.root).not.toBe(second.paths.root);
      expect(first.paths.home).not.toBe(second.paths.home);
      expect(first.paths.workspace).not.toBe(second.paths.workspace);
      expect(first.paths.database).not.toBe(second.paths.database);
      expect(first.paths.observability).not.toBe(second.paths.observability);
      expect(first.paths.database).toBe(path.join(first.paths.home, 'sqlite', 'megumi.sqlite'));
      expect(first.paths.observability).toBe(path.join(first.paths.home, 'logs', 'observability'));
      expect(existsSync(first.paths.database)).toBe(true);
      expect(existsSync(path.join(first.paths.workspace, 'source.md'))).toBe(true);
      expect(first.paths.home).not.toBe(process.env.MEGUMI_HOME);
    } finally {
      await first.dispose();
      await second.dispose();
    }

    expect(existsSync(first.paths.root)).toBe(false);
    expect(existsSync(second.paths.root)).toBe(false);
  });
});

function resolvedModel() {
  const credential = { type: 'api_key' as const, key: 'test-key' };
  return {
    source: 'explicit' as const,
    config: {
      providerId: 'test', modelId: 'model', api: 'openai-completions' as const,
      baseUrl: 'https://example.test/v1', displayName: 'Test model',
      contextWindowTokens: 64_000, maxOutputTokens: 2_048,
    },
    credentials: {
      async read(providerId: string) { return providerId === 'test' ? credential : undefined; },
      async list() { return [{ providerId: 'test', type: 'api_key' as const }]; },
      async modify() { throw new Error('read-only'); },
      async delete() { throw new Error('read-only'); },
    },
  };
}
