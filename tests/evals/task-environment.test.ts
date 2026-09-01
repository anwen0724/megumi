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
      candidateModel: modelConfig('CANDIDATE_KEY'), graderModel: modelConfig('GRADER_KEY'),
      budget: { maxTasks: 1 }, runRoot: taskRoot,
    });
    const composed = await composeEvaluationTask({
      repositoryRoot: process.cwd(), runConfig: config, task, taskRoot,
      environment: { CANDIDATE_KEY: 'test-key' },
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

function modelConfig(apiKeyEnv: string) {
  return {
    providerId: 'test', modelId: 'model', api: 'openai-completions' as const, apiKeyEnv,
    baseUrl: 'https://example.test/v1', contextWindowTokens: 64_000, maxOutputTokens: 2_048,
  };
}
