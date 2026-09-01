/* Implements local catalog, run, review, and Baseline commands. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvaluationRunConfigSchema } from './catalog/evaluation-run-config';
import { loadEvaluationCatalog } from './catalog/evaluation-catalog';
import { createEvaluationCredentials } from './runtime/adapters/evaluation-credential-store';
import { createModelGrader } from './runtime/model-grader';
import { runEvaluation } from './runtime/evaluation-runner';
import { EvaluationRunResultSchema } from './runtime/evaluation-result';
import { renderEvaluationReport } from './reporting/report-writer';
import {
  approveBaseline,
  compareWithBaseline,
  EvaluationBaselineSchema,
} from './reporting/baseline-comparator';
import { importHumanReview } from './reporting/human-review';
import { cleanEvaluationRuns } from './reporting/retention-cleaner';

const evaluationRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(evaluationRoot, '..', '..');

async function main(arguments_: readonly string[]): Promise<void> {
  const [command, action, ...rest] = arguments_;
  if (command === 'catalog' && action === 'validate') {
    const catalog = await loadEvaluationCatalog(evaluationRoot);
    process.stdout.write(`Catalog valid: ${catalog.cases.size} Cases, ${catalog.suites.size} Suites.\n`);
    return;
  }
  if (command === 'run' && action) {
    const config = EvaluationRunConfigSchema.parse(await readJson(path.resolve(action)));
    const catalog = await loadEvaluationCatalog(evaluationRoot);
    assertSuiteProfiles(catalog, config);
    const credentials = createEvaluationCredentials(process.env);
    credentials.require(config.candidateModel.apiKeyEnv);
    const modelGrader = createModelGrader({
      config: config.graderModel,
      apiKey: credentials.require(config.graderModel.apiKeyEnv),
    });
    const { result, storage } = await runEvaluation({
      repositoryRoot,
      catalog,
      config,
      dependencies: { modelGrader },
    });
    const fixtureVersions = catalogFixtureVersions(catalog);
    const comparison = config.baseline
      ? compareWithBaseline({
          result,
          baseline: EvaluationBaselineSchema.parse(await readJson(path.join(
            config.runRoot,
            'baselines',
            `${config.baseline.baselineId}.json`,
          ))),
          fixtureVersions,
        })
      : undefined;
    if (comparison) await storage.writeBaselineComparison(comparison);
    await storage.writeReport(renderEvaluationReport(result, comparison));
    await cleanEvaluationRuns({ evaluationRoot: config.runRoot });
    process.stdout.write(`Evaluation complete: ${storage.runDirectory}\n`);
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
    const catalog = await loadEvaluationCatalog(evaluationRoot);
    const fixtureVersions = catalogFixtureVersions(catalog);
    const baseline = approveBaseline({
      baselineId,
      result,
      approvedAt: new Date().toISOString(),
      approvedBy,
      fixtureVersions,
    });
    await mkdir(root, { recursive: true });
    const target = path.join(root, `${baselineId}.json`);
    await writeJson(target, baseline);
    process.stdout.write(`Baseline approved: ${target}\n`);
    return;
  }
  throw new Error('Usage: catalog validate | run <config.json> | human review import <result.json> <review.json> | baseline approve <result.json> [--id id] [--by name] [--root dir]');
}

function assertSuiteProfiles(
  catalog: Awaited<ReturnType<typeof loadEvaluationCatalog>>,
  config: import('./catalog/evaluation-run-config').EvaluationRunConfig,
): void {
  for (const suiteId of config.suiteIds) {
    const suite = catalog.resolveSuite(suiteId).suite;
    if (suite.profile !== config.profile) {
      throw new Error(`Suite ${suiteId} requires ${suite.profile}, but Run Config selected ${config.profile}.`);
    }
  }
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

function catalogFixtureVersions(
  catalog: Awaited<ReturnType<typeof loadEvaluationCatalog>>,
): Record<string, number> {
  return Object.fromEntries([...catalog.cases.values()].map((entry) => [entry.caseId, entry.fixtureVersion]));
}

function defaultBaselineRoot(resultPath: string): string {
  return path.join(path.dirname(path.dirname(path.dirname(resultPath))), 'baselines');
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
