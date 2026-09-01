/* Loads and validates Evaluation Tasks and Suites behind one author-facing catalog. */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { EvaluationRunConfig } from '../contracts/evaluation-run-config';
import { EvaluationSuiteSchema, type EvaluationSuite } from '../contracts/evaluation-suite';
import { EvaluationTaskSchema, type EvaluationTask } from '../contracts/evaluation-task';

export interface EvaluationTaskCatalog {
  readonly tasks: ReadonlyMap<string, EvaluationTask>;
  readonly suites: ReadonlyMap<string, EvaluationSuite>;
  resolveTasks(config: EvaluationRunConfig): readonly EvaluationTask[];
}

/** Loads all Task and Suite JSON files and validates every reference before execution. */
export async function loadEvaluationTaskCatalog(root: string): Promise<EvaluationTaskCatalog> {
  const tasks = new Map<string, EvaluationTask>();
  for (const file of await listJsonFiles(path.join(root, 'tasks'))) {
    const task = EvaluationTaskSchema.parse(await readJson(file));
    rejectDuplicate(tasks, task.taskId, 'Task');
    tasks.set(task.taskId, task);
  }

  const suites = new Map<string, EvaluationSuite>();
  for (const file of await listJsonFiles(path.join(root, 'suites'))) {
    const suite = EvaluationSuiteSchema.parse(await readJson(file));
    rejectDuplicate(suites, suite.suiteId, 'Suite');
    for (const taskId of suite.taskIds) {
      const task = requireTask(tasks, taskId);
      if (!task.profiles.includes(suite.profile)) {
        throw new Error(`Task ${taskId} does not allow ${suite.profile} Profile required by Suite ${suite.suiteId}.`);
      }
    }
    suites.set(suite.suiteId, suite);
  }

  return {
    tasks,
    suites,
    resolveTasks(config) {
      const selected = new Map<string, EvaluationTask>();
      for (const taskId of config.taskIds) addTask(selected, requireTask(tasks, taskId), config.profile);
      for (const suiteId of config.suiteIds) {
        const suite = suites.get(suiteId);
        if (!suite) throw new Error(`Evaluation Suite not found: ${suiteId}.`);
        if (suite.profile !== config.profile) {
          throw new Error(`Suite ${suiteId} requires ${suite.profile}, but Run Config selected ${config.profile}.`);
        }
        for (const taskId of suite.taskIds) addTask(selected, requireTask(tasks, taskId), config.profile);
      }
      return [...selected.values()];
    },
  };
}

async function listJsonFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJsonFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.json') ? [fullPath] : [];
  }));
  return nested.flat().sort();
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'));
}

function addTask(
  selected: Map<string, EvaluationTask>,
  task: EvaluationTask,
  profile: EvaluationRunConfig['profile'],
): void {
  if (!task.profiles.includes(profile)) {
    throw new Error(`Task ${task.taskId} does not allow ${profile} Profile.`);
  }
  selected.set(task.taskId, task);
}

function requireTask(tasks: ReadonlyMap<string, EvaluationTask>, taskId: string): EvaluationTask {
  const task = tasks.get(taskId);
  if (!task) throw new Error(`Evaluation Task not found: ${taskId}.`);
  return task;
}

function rejectDuplicate<T>(values: ReadonlyMap<string, T>, id: string, kind: string): void {
  if (values.has(id)) throw new Error(`${kind} ID is duplicated: ${id}.`);
}
