/* Implements the local Dataset, Metric Catalog, and Evaluation Run commands. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDataset, validateDatasets } from './datasets/dataset-loader';
import { listMetricDefinitions } from './metrics/metric-catalog';

const evaluationRoot = path.dirname(fileURLToPath(import.meta.url));

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
  throw new Error('Usage: datasets validate | datasets show <environment/dataset-id> | metrics list');
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
