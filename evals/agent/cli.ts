/* Implements the local Dataset, Metric Catalog, and Evaluation Run commands. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvaluationRunRequestSchema } from './contracts/evaluation-run';
import { loadDataset, validateDatasets } from './datasets/dataset-loader';
import { listMetricDefinitions } from './metrics/metric-catalog';
import { runEvaluation } from './run/evaluation-runner';

const evaluationRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(evaluationRoot, '..', '..');

async function main(arguments_: readonly string[]): Promise<void> {
  const [command, action, ...rest] = arguments_;
  if (command === 'datasets' && action === 'validate') {
    const result = await validateDatasets({ rootDirectory: path.join(evaluationRoot, 'datasets') });
    process.stdout.write(`Datasets valid: ${result.datasetCount} Datasets, ${result.caseCount} Cases.\n`);
    return;
  }
  if (command === 'datasets' && action === 'show' && rest[0]) {
    const dataset = await loadDataset({
      rootDirectory: path.join(evaluationRoot, 'datasets'),
      identity: rest[0],
    });
    process.stdout.write(`${JSON.stringify(dataset, null, 2)}\n`);
    return;
  }
  if (command === 'metrics' && action === 'list') {
    process.stdout.write(`${JSON.stringify(listMetricDefinitions(), null, 2)}\n`);
    return;
  }
  if (command === 'run') {
    const options = parseRunOptions(arguments_.slice(1));
    const candidateModel: unknown = JSON.parse(await readFile(options.candidateFile, 'utf8'));
    const request = EvaluationRunRequestSchema.parse({
      datasetIds: options.datasetIds,
      caseIds: options.caseIds,
      candidateModel,
      ...(options.safetyWallClockLimitMs === undefined
        ? {}
        : { safetyWallClockLimitMs: options.safetyWallClockLimitMs }),
    });
    const result = await runEvaluation({
      repositoryRoot,
      evaluationRoot,
      datasetRoot: path.join(evaluationRoot, 'datasets'),
      request,
    });
    process.stdout.write(`Evaluation ${result.record.status}: ${result.runDirectory}\n`);
    return;
  }
  throw new Error(usage());
}

interface RunOptions {
  readonly candidateFile: string;
  readonly datasetIds: readonly string[];
  readonly caseIds: readonly string[];
  readonly safetyWallClockLimitMs?: number;
}

function parseRunOptions(arguments_: readonly string[]): RunOptions {
  const datasetIds: string[] = [];
  const caseIds: string[] = [];
  let candidateFile: string | undefined;
  let safetyWallClockLimitMs: number | undefined;
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (!option || !value) throw new Error(usage());
    if (option === '--dataset') datasetIds.push(value);
    else if (option === '--case') caseIds.push(value);
    else if (option === '--candidate') candidateFile = path.resolve(value);
    else if (option === '--timeout-ms') {
      safetyWallClockLimitMs = Number(value);
      if (!Number.isSafeInteger(safetyWallClockLimitMs) || safetyWallClockLimitMs <= 0) {
        throw new Error('--timeout-ms must be a positive integer.');
      }
    } else throw new Error(`Unknown run option: ${option}.\n${usage()}`);
  }
  if (!candidateFile) throw new Error(`--candidate is required.\n${usage()}`);
  return { candidateFile, datasetIds, caseIds, safetyWallClockLimitMs };
}

function usage(): string {
  return 'Usage: datasets validate | datasets show <environment/dataset-id> | metrics list | '
    + 'run --candidate <model.json> [--dataset <environment/dataset-id>] '
    + '[--case <environment/case-id>] [--timeout-ms <milliseconds>]';
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
