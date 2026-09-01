/* Verifies the single-file Evaluation Task authoring contract and task selection. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EvaluationRunConfigSchema } from '../../evals/agent/contracts/evaluation-run-config';
import { EvaluationTaskSchema } from '../../evals/agent/contracts/evaluation-task';
import { loadEvaluationTaskCatalog } from '../../evals/agent/runtime/task-loader';

describe('Evaluation Task authoring', () => {
  it('accepts one conversation task containing scenario, steps, and freely chosen metrics', () => {
    const task = EvaluationTaskSchema.parse(conversationTask());

    expect(task.taskId).toBe('conversation.create-study-note');
    expect(task.runner).toBe('conversation');
    expect(task.scenario.workspace.files).toEqual([
      { path: 'source.md', content: '# TypeScript\nUse unknown at untrusted boundaries.' },
    ]);
    expect(task.steps).toHaveLength(1);
    expect(task.metrics.map((metric) => metric.metricId)).toEqual([
      'document_created',
      'content_quality',
      'tool_calls',
    ]);
  });

  it('rejects duplicated metric IDs and runner-specific input mismatches', () => {
    const duplicate = conversationTask();
    duplicate.metrics.push({ ...duplicate.metrics[0] });
    expect(() => EvaluationTaskSchema.parse(duplicate)).toThrow();

    expect(() => EvaluationTaskSchema.parse({
      ...conversationTask(),
      runner: 'candidate_supply',
    })).toThrow();

    expect(() => EvaluationTaskSchema.parse({
      ...candidateSupplyTask(),
      scenario: {
        ...scenario(),
        candidates: [{
          scenarioCandidateId: 'candidate', sourceId: 'open_web', sourceName: 'Web',
          canonicalUrl: 'https://example.test/candidate', title: 'Candidate',
          matchedInterestScenarioIds: ['missing-interest'], relevance: 'direct',
        }],
      },
    })).toThrow(/Interest Scenario reference does not exist/iu);
  });

  it('loads tasks and suites, then resolves direct and suite task selections without duplicates', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'megumi-evaluation-tasks-'));
    await mkdir(path.join(root, 'tasks', 'conversation'), { recursive: true });
    await mkdir(path.join(root, 'tasks', 'candidate-supply'), { recursive: true });
    await mkdir(path.join(root, 'suites'), { recursive: true });
    await writeJson(path.join(root, 'tasks', 'conversation', 'create-study-note.json'), conversationTask());
    await writeJson(path.join(root, 'tasks', 'candidate-supply', 'refill.json'), candidateSupplyTask());
    await writeJson(path.join(root, 'suites', 'core.json'), {
      suiteId: 'core',
      revision: 1,
      title: 'Core',
      purpose: 'Core quality tasks.',
      profile: 'controlled',
      taskIds: ['conversation.create-study-note', 'candidate-supply.refill'],
    });

    const catalog = await loadEvaluationTaskCatalog(root);
    const selected = catalog.resolveTasks(EvaluationRunConfigSchema.parse({
      profile: 'controlled',
      taskIds: ['conversation.create-study-note'],
      suiteIds: ['core'],
      candidateModel: model('candidate-key'),
      graderModel: model('grader-key'),
      repetitions: 1,
      concurrency: 1,
      budget: { maxTasks: 10 },
      runRoot: path.join(root, 'runs'),
    }));

    expect(catalog.tasks.size).toBe(2);
    expect(selected.map((task) => task.taskId)).toEqual([
      'conversation.create-study-note',
      'candidate-supply.refill',
    ]);
  });

  it('requires at least one task or suite in a Run Config', () => {
    expect(() => EvaluationRunConfigSchema.parse({
      profile: 'controlled',
      candidateModel: model('candidate-key'),
      graderModel: model('grader-key'),
      budget: { maxTasks: 1 },
      runRoot: '.megumi/evaluation',
    })).toThrow();
  });
});

function conversationTask() {
  return {
    taskId: 'conversation.create-study-note',
    revision: 1,
    title: '创建学习笔记',
    objective: '读取材料并创建一份准确的学习笔记。',
    runner: 'conversation' as const,
    difficulty: 'simple' as const,
    profiles: ['controlled'] as const,
    tags: ['core'],
    scenario: scenario(),
    steps: [{ userInput: '读取 source.md，并创建 notes.md。', permissionMode: 'auto' as const }],
    completion: { kind: 'conversation_steps_terminal' as const, timeoutMs: 120_000 },
    metrics: [
      {
        metricId: 'document_created', title: '文档已创建', evaluator: 'rule' as const,
        required: true, rule: 'workspace_files_exist' as const, paths: ['notes.md'],
      },
      {
        metricId: 'content_quality', title: '内容质量', evaluator: 'model' as const,
        required: true, rubric: '笔记应准确覆盖材料中的核心规则。', minScore: 3,
      },
      {
        metricId: 'tool_calls', title: '工具调用次数', evaluator: 'measurement' as const,
        required: false, measurement: 'toolCalls' as const, operator: 'max' as const, threshold: 6,
      },
    ],
  };
}

function candidateSupplyTask() {
  return {
    taskId: 'candidate-supply.refill',
    revision: 1,
    title: '补充候选池',
    objective: '为已有关注补充有效 Candidate。',
    runner: 'candidate_supply' as const,
    difficulty: 'medium' as const,
    profiles: ['controlled'] as const,
    tags: ['core'],
    scenario: scenario(),
    input: { kind: 'request_candidate_supply' as const },
    completion: { kind: 'candidate_supply_terminal' as const, timeoutMs: 180_000 },
    metrics: [{
      metricId: 'completion', title: '业务完成', evaluator: 'rule' as const,
      required: true, rule: 'business_completion_present' as const,
    }],
  };
}

function scenario() {
  return {
    clock: '2026-01-15T08:00:00.000Z',
    dailyTargetCount: 3,
    workspace: {
      files: [{ path: 'source.md', content: '# TypeScript\nUse unknown at untrusted boundaries.' }],
    },
    sessions: [],
    interests: [],
    candidates: [],
    recommendations: [],
    preferences: [],
    controlledSearch: [],
    permissionDecision: 'allow' as const,
  };
}

function model(apiKeyEnv: string) {
  return {
    providerId: 'test-provider',
    modelId: 'test-model',
    api: 'openai-completions' as const,
    apiKeyEnv,
    baseUrl: 'https://example.test/v1',
    contextWindowTokens: 8_192,
    maxOutputTokens: 1_024,
  };
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
