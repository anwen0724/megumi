/* Verifies extensible Task authoring and catalog selection without business-specific Runner fields. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EvaluationRunConfigSchema } from '../../evals/agent/contracts/evaluation-run-config';
import { EvaluationTaskSchema } from '../../evals/agent/contracts/evaluation-task';
import { loadEvaluationTaskCatalog } from '../../evals/agent/execution/task-loader';

describe('Evaluation Task authoring', () => {
  it('defines a real product input, isolated initial state, and freely chosen metrics', () => {
    const task = EvaluationTaskSchema.parse(conversationTask());

    expect(task.input).toMatchObject({ type: 'conversation' });
    expect(task.initialState.workspaceFiles).toEqual([
      { path: 'source.md', content: '# TypeScript\nUse unknown at untrusted boundaries.' },
    ]);
    expect(task.metrics.map((metric) => metric.metricId)).toEqual([
      'document_created',
      'content_quality',
      'tool_calls',
    ]);
    expect(task).not.toHaveProperty('runner');
  });

  it('rejects duplicated Metric IDs and missing initial-state references', () => {
    const duplicate = conversationTask();
    duplicate.metrics.push({ ...duplicate.metrics[0] });
    expect(() => EvaluationTaskSchema.parse(duplicate)).toThrow();

    expect(() => EvaluationTaskSchema.parse({
      ...candidateSupplyTask(),
      initialState: {
        ...initialState(),
        candidates: [{
          referenceId: 'candidate', sourceId: 'open_web', sourceName: 'Web',
          canonicalUrl: 'https://example.test/candidate', title: 'Candidate',
          matchedInterestReferenceIds: ['missing-interest'], relevance: 'direct',
        }],
      },
    })).toThrow(/Interest initial-state reference does not exist/iu);
  });

  it('loads independently added Task files and resolves Suite selection without duplicates', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'megumi-evaluation-tasks-'));
    await mkdir(path.join(root, 'tasks', 'conversation'), { recursive: true });
    await mkdir(path.join(root, 'tasks', 'candidate-supply'), { recursive: true });
    await mkdir(path.join(root, 'suites'), { recursive: true });
    await writeJson(path.join(root, 'tasks', 'conversation', 'create-study-note.json'), conversationTask());
    await writeJson(path.join(root, 'tasks', 'candidate-supply', 'refill.json'), candidateSupplyTask());
    await writeJson(path.join(root, 'suites', 'core.json'), {
      suiteId: 'core', revision: 1, title: 'Core', purpose: 'Core quality tasks.',
      profile: 'controlled',
      taskIds: ['conversation.create-study-note', 'candidate-supply.refill'],
    });

    const catalog = await loadEvaluationTaskCatalog(root);
    const selected = catalog.resolveTasks(EvaluationRunConfigSchema.parse({
      profile: 'controlled',
      taskIds: ['conversation.create-study-note'],
      suiteIds: ['core'],
      candidateModel: { source: 'current' },
      graderModel: { source: 'configured', providerId: 'grader', modelId: 'grader-model' },
      repetitions: 1,
      concurrency: 1,
      budget: { maxTasks: 10 },
    }));

    expect(catalog.tasks.size).toBe(2);
    expect(selected.map((task) => task.taskId)).toEqual([
      'conversation.create-study-note',
      'candidate-supply.refill',
    ]);
  });
});

function conversationTask() {
  return {
    taskId: 'conversation.create-study-note',
    revision: 1,
    title: '创建学习笔记',
    objective: '读取材料并创建一份准确的学习笔记。',
    difficulty: 'simple' as const,
    profiles: ['controlled'] as const,
    tags: ['core'],
    initialState: initialState(),
    input: {
      type: 'conversation' as const,
      steps: [{ userInput: '读取 source.md，并创建 notes.md。', permissionMode: 'auto' as const }],
    },
    timeoutMs: 120_000,
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
    taskId: 'candidate-supply.refill', revision: 1, title: '补充候选池',
    objective: '为已有关注补充有效 Candidate。', difficulty: 'medium' as const,
    profiles: ['controlled'] as const, tags: ['core'], initialState: initialState(),
    input: { type: 'candidate_supply' as const }, timeoutMs: 180_000,
    metrics: [{
      metricId: 'completion', title: '业务完成', evaluator: 'rule' as const,
      required: true, rule: 'business_completion_present' as const,
    }],
  };
}

function initialState() {
  return {
    clock: '2026-01-15T08:00:00.000Z',
    dailyTargetCount: 3,
    workspaceFiles: [{ path: 'source.md', content: '# TypeScript\nUse unknown at untrusted boundaries.' }],
    sessions: [], interests: [], candidates: [], recommendations: [], preferences: [],
    controlledSearch: [], permissionDecision: 'allow' as const,
  };
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
