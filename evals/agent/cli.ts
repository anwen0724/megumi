/* Implements the local Dataset, Metric Catalog, and Evaluation Run commands. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvaluationRunRequestSchema } from './contracts/evaluation-run';
import { loadDataset, validateDatasets } from './datasets/dataset-loader';
import { listMetricDefinitions } from './metrics/metric-catalog';
import { runEvaluation } from './run/evaluation-runner';
import { scoreEvaluationRun } from './grading/score-run';

const evaluationRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(evaluationRoot, '..', '..');

async function main(arguments_: readonly string[]): Promise<void> {
  const [command, action, ...rest] = arguments_;
  if (command === 'score') {
    const options = parseFileOptions(arguments_.slice(1), ['--run', '--profile', '--out'], ['--review']);
    const profile: unknown = JSON.parse(await readFile(options['--profile'], 'utf8'));
    const review: unknown = options['--review'] ? JSON.parse(await readFile(options['--review'], 'utf8')) : undefined;
    const result = await scoreEvaluationRun({ runDirectory: options['--run'], outputDirectory: options['--out'], profile, review });
    process.stdout.write(`Evaluation score ${result.status}: ${options['--out']}\n`);
    if (result.status !== 'passed') process.exitCode = 1;
    return;
  }
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
    for (const record of result.caseResults) {
      process.stdout.write(`${record.caseIdentity}: ${record.terminalState ?? 'not_started'}; evidence=${record.recordStatus}\n`);
    }
    if (result.record.status === 'completed_with_failures') process.exitCode = 1;
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
    + '[--case <environment/case-id>] [--timeout-ms <milliseconds>] | '
    + 'score --run <directory> --profile <json> --out <new-directory> [--review <json>]';
}

/** Parses nonrepeatable offline file options and rejects unknown or missing arguments. */
function parseFileOptions(arguments_: readonly string[], required: readonly string[], optional: readonly string[] = []): Record<string, string> {
  const options: Record<string, string> = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (!option || !value || value.startsWith('--') || ![...required, ...optional].includes(option) || options[option]) {
      throw new Error('Invalid or duplicate offline option. ' + usage());
    }
    options[option] = path.resolve(value);
  }
  for (const key of required) if (!options[key]) throw new Error(key + ' is required.');
  return options;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
