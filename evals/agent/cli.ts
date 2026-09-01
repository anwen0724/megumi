/* Implements local Task validation, Evaluation Run, review, and Baseline commands. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMegumiHomePath } from '@megumi/home';
import { resolveEvaluationModels } from './adapters/evaluation-model-source';
import { EvaluationRunConfigSchema } from './contracts/evaluation-run-config';
import { EvaluationRunResultSchema } from './contracts/evaluation-result';
import { createModelMetricEvaluator } from './grading/model-grader';
import {
  approveBaseline,
  compareWithBaseline,
  EvaluationBaselineSchema,
} from './results/baseline-comparator';
import { importHumanReview } from './results/human-review';
import { renderEvaluationDiagnostics, renderEvaluationReport } from './results/report-writer';
import { cleanEvaluationRuns } from './results/retention-cleaner';
import { runEvaluation } from './execution/run-evaluation';
import { loadEvaluationTaskCatalog } from './execution/task-loader';

const evaluationRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(evaluationRoot, '..', '..');

async function main(arguments_: readonly string[]): Promise<void> {
  const [command, action, ...rest] = arguments_;
  if (command === 'tasks' && action === 'validate') {
    const catalog = await loadEvaluationTaskCatalog(evaluationRoot);
    process.stdout.write(`Tasks valid: ${catalog.tasks.size} Tasks, ${catalog.suites.size} Suites.\n`);
    return;
  }
  if (command === 'run' && action) {
    const config = EvaluationRunConfigSchema.parse(await readJson(path.resolve(action)));
    const catalog = await loadEvaluationTaskCatalog(evaluationRoot);
    catalog.resolveTasks(config);
    const models = await resolveEvaluationModels({
      config,
      megumiHomePath: resolveMegumiHomePath({
        env: { MEGUMI_HOME: process.env.MEGUMI_HOME },
        homeDirectory: os.homedir(),
      }),
      environment: process.env,
    });
    const modelMetricEvaluator = createModelMetricEvaluator({
      model: models.grader,
    });
    const { result, storage } = await runEvaluation({
      repositoryRoot,
      catalog,
      config,
      models,
      dependencies: { modelMetricEvaluator },
    });
    const comparison = config.baseline && result.infrastructureStatus === 'valid'
      ? compareWithBaseline({
          result,
          baseline: EvaluationBaselineSchema.parse(await readJson(path.join(
            config.runRoot,
            'baselines',
            `${config.baseline.baselineId}.json`,
          ))),
        })
      : undefined;
    if (comparison) await storage.writeBaselineComparison(comparison);
    if (result.infrastructureStatus === 'valid') {
      await storage.writeReport(renderEvaluationReport(result, comparison));
    } else {
      await storage.writeDiagnostics(renderEvaluationDiagnostics(result));
    }
    await cleanEvaluationRuns({ evaluationRoot: config.runRoot });
    process.stdout.write(`Evaluation ${result.infrastructureStatus}: ${storage.runDirectory}\n`);
    return;
  }
  if (command === 'human' && action === 'review' && rest[0] === 'import' && rest[1] && rest[2]) {
    const resultPath = path.resolve(rest[1]);
    const result = EvaluationRunResultSchema.parse(await readJson(resultPath));
    const reviewed = importHumanReview(result, await readJson(path.resolve(rest[2])));
    await writeJson(resultPath, reviewed);
    process.stdout.write(`Human Review imported into ${resultPath}.\n`);
    return;
  }
  if (command === 'baseline' && action === 'approve' && rest[0]) {
    const resultPath = path.resolve(rest[0]);
    const result = EvaluationRunResultSchema.parse(await readJson(resultPath));
    const baselineId = option(rest, '--id') ?? `baseline-${result.runId.replaceAll(':', '-')}`;
    const approvedBy = option(rest, '--by') ?? process.env.USERNAME ?? 'local-developer';
    const root = path.resolve(option(rest, '--root') ?? defaultBaselineRoot(resultPath));
    const baseline = approveBaseline({
      baselineId,
      result,
      approvedAt: new Date().toISOString(),
      approvedBy,
    });
    await mkdir(root, { recursive: true });
    const target = path.join(root, `${baselineId}.json`);
    await writeJson(target, baseline);
    process.stdout.write(`Baseline approved: ${target}\n`);
    return;
  }
  throw new Error('Usage: tasks validate | run <config.json> | human review import <result.json> <review.json> | baseline approve <result.json> [--id id] [--by name] [--root dir]');
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function option(arguments_: readonly string[], name: string): string | undefined {
  const index = arguments_.indexOf(name);
  return index >= 0 ? arguments_[index + 1] : undefined;
}

function defaultBaselineRoot(resultPath: string): string {
  return path.join(path.dirname(path.dirname(path.dirname(resultPath))), 'baselines');
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
