/* Runs the Coding Suite with the Target selected in the repository .env file. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const runsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(runsDirectory, '..', '..', '..');
const tsconfig = path.join(repositoryRoot, 'evals', 'agent', 'tsconfig.json');
const { runEnvironmentConfiguredEvaluation } = await tsImport('./run-configured-evaluation.ts', {
  parentURL: import.meta.url,
  tsconfig,
});

await runEnvironmentConfiguredEvaluation({ repositoryRoot, suiteId: 'coding' });
