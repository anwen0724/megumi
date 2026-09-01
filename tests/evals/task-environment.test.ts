/* Verifies Task Scenario files and database facts are installed in an isolated Product environment. */
// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EvaluationRunConfigSchema } from '../../evals/agent/contracts/evaluation-run-config';
import { EvaluationTaskSchema } from '../../evals/agent/contracts/evaluation-task';
import { composeEvaluationTask } from '../../evals/agent/runtime/task-environment';

let taskRoot: string | undefined;
afterEach(async () => { if (taskRoot) await rm(taskRoot, { recursive: true, force: true }); taskRoot = undefined; });

describe('Evaluation Task environment', () => {
  it('installs Scenario Workspace files without touching a shared Home', async () => {
    taskRoot = await mkdtemp(path.join(os.tmpdir(), 'megumi-task-environment-'));
    const task = EvaluationTaskSchema.parse({
      taskId: 'conversation.environment', revision: 1, title: 'Environment', objective: 'Install Scenario.',
      difficulty: 'simple', profiles: ['controlled'], tags: [], runner: 'conversation',
      scenario: {
        clock: '2026-01-01T00:00:00.000Z',
        workspace: { files: [{ path: 'materials/source.md', content: '# Source' }] },
        sessions: [], interests: [], candidates: [], recommendations: [], preferences: [],
        controlledSearch: [], permissionDecision: 'allow',
      },
      steps: [{ userInput: 'Read the source.', permissionMode: 'full_access' }],
      completion: { kind: 'conversation_steps_terminal', timeoutMs: 1_000 },
      metrics: [{ metricId: 'completion', title: 'Completion', evaluator: 'rule', rule: 'business_completion_present', required: true }],
    });
    const config = EvaluationRunConfigSchema.parse({
      profile: 'controlled', taskIds: [task.taskId], suiteIds: [],
      candidateModel: { source: 'current' }, graderModel: { source: 'current' },
      budget: { maxTasks: 1 }, runRoot: taskRoot,
    });
    const candidateModel = resolvedModel();
    const composed = await composeEvaluationTask({
      repositoryRoot: process.cwd(), runConfig: config, task, taskRoot,
      candidateModel,
      graderModel: candidateModel,
    });
    try {
      expect(await readFile(path.join(composed.paths.workspace, 'materials', 'source.md'), 'utf8')).toBe('# Source');
      expect(composed.paths.home.startsWith(path.resolve(taskRoot))).toBe(true);
      expect(composed.scenarioIds.workspaceId).toBeTruthy();
    } finally {
      await composed.dispose();
    }
  });
});

function resolvedModel() {
  const credential = { type: 'api_key' as const, key: 'test-key' };
  return {
    source: 'custom' as const,
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
