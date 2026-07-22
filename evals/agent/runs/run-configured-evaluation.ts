/* Runs a fixed IDE-friendly Evaluation configuration without routing through the CLI. */
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import path from 'node:path';
import type { EvaluationCatalog } from '../config/load-evaluation-catalog';
import type { EvaluationProductRuntimeFactory } from '../runner/evaluation-runner';
import type { EvaluationSuiteReport } from '../reporters/evaluation-report';
import { loadEvaluationCatalog } from '../config/load-evaluation-catalog';
import { createComposeProductEvaluationFactory } from '../runner/compose-product-runtime-factory';
import { runEvaluationSuite, type RunEvaluationSuiteInput } from '../runner/evaluation-suite-runner';

export interface ConfiguredEvaluationRun {
  repositoryRoot: string;
  suiteId: string;
  targetId: string;
  profileId: string;
  credentialEnvironmentVariable: string;
  caseIds?: string[];
  repetitions?: number;
  retainEnvironments?: boolean;
}

export interface ConfiguredEvaluationResult {
  report: EvaluationSuiteReport;
  reportDirectory: string;
}

export interface EnvironmentConfiguredEvaluationRun {
  repositoryRoot: string;
  suiteId: string;
  caseIds?: string[];
  repetitions?: number;
  retainEnvironments?: boolean;
}

interface ConfiguredEvaluationDependencies {
  environment: NodeJS.ProcessEnv;
  pathExists(filePath: string): boolean;
  loadEnvFile(filePath: string): void;
  loadCatalog(evaluationRoot: string): Promise<EvaluationCatalog>;
  createRuntimeFactory(credential: string): EvaluationProductRuntimeFactory;
  runSuite(input: RunEvaluationSuiteInput): Promise<EvaluationSuiteReport>;
  now(): Date;
  log(message: string): void;
}

const defaultDependencies: ConfiguredEvaluationDependencies = {
  environment: process.env,
  pathExists: existsSync,
  loadEnvFile,
  loadCatalog: loadEvaluationCatalog,
  createRuntimeFactory: (credential) => createComposeProductEvaluationFactory({ credential }),
  runSuite: runEvaluationSuite,
  now: () => new Date(),
  log: (message) => console.log(message),
};

export async function runConfiguredEvaluation(
  request: ConfiguredEvaluationRun,
  dependencies: ConfiguredEvaluationDependencies = defaultDependencies,
): Promise<ConfiguredEvaluationResult> {
  const repositoryRoot = path.resolve(request.repositoryRoot);
  const evaluationRoot = path.join(repositoryRoot, 'evals', 'agent');
  loadRepositoryEnvironment(repositoryRoot, dependencies);
  const catalog = await dependencies.loadCatalog(evaluationRoot);
  return executeConfiguredEvaluation({ ...request, repositoryRoot }, catalog, dependencies);
}

export async function runEnvironmentConfiguredEvaluation(
  request: EnvironmentConfiguredEvaluationRun,
  dependencies: ConfiguredEvaluationDependencies = defaultDependencies,
): Promise<ConfiguredEvaluationResult> {
  const repositoryRoot = path.resolve(request.repositoryRoot);
  const evaluationRoot = path.join(repositoryRoot, 'evals', 'agent');
  const envPath = path.join(repositoryRoot, '.env');
  loadRepositoryEnvironment(repositoryRoot, dependencies);
  const targetId = requiredEnvironmentValue(
    dependencies.environment,
    'MEGUMI_EVALUATION_TARGET',
    envPath,
  );
  const credentialEnvironmentVariable = requiredEnvironmentValue(
    dependencies.environment,
    'MEGUMI_EVALUATION_CREDENTIAL_ENV',
    envPath,
  );
  const catalog = await dependencies.loadCatalog(evaluationRoot);
  const suite = catalog.suites.find((candidate) => candidate.suiteId === request.suiteId);
  if (!suite) throw new Error(`Evaluation Suite was not found: ${request.suiteId}`);
  return executeConfiguredEvaluation({
    ...request,
    repositoryRoot,
    targetId,
    profileId: suite.executionProfileId,
    credentialEnvironmentVariable,
  }, catalog, dependencies);
}

async function executeConfiguredEvaluation(
  request: ConfiguredEvaluationRun,
  catalog: EvaluationCatalog,
  dependencies: ConfiguredEvaluationDependencies,
): Promise<ConfiguredEvaluationResult> {
  const repositoryRoot = path.resolve(request.repositoryRoot);
  const evaluationRoot = path.join(repositoryRoot, 'evals', 'agent');
  const envPath = path.join(repositoryRoot, '.env');

  const credential = dependencies.environment[request.credentialEnvironmentVariable];
  if (!credential?.trim()) {
    throw new Error(
      `${request.credentialEnvironmentVariable} is missing. Configure it in ${envPath} or the IDE process environment.`,
    );
  }

  const timestamp = dependencies.now().toISOString().replace(/[:.]/g, '-');
  const reportDirectory = path.join(
    repositoryRoot,
    'evals',
    'reports',
    `${timestamp}-${safeId(request.suiteId)}-${safeId(request.targetId)}`,
  );
  const report = await dependencies.runSuite({
    catalog,
    suiteId: request.suiteId,
    targetId: request.targetId,
    profileId: request.profileId,
    evaluationRoot,
    repositoryRoot,
    runtimeFactory: dependencies.createRuntimeFactory(credential),
    availableIsolation: ['workspace_only'],
    reportDirectory,
    ...(request.caseIds ? { caseIds: request.caseIds } : {}),
    ...(request.repetitions ? { repetitionsOverride: request.repetitions } : {}),
    ...(request.retainEnvironments ? { retainEnvironments: true } : {}),
  });

  dependencies.log(`Suite verdict: ${report.verdict}`);
  for (const execution of report.executionReports) {
    dependencies.log(
      `Case ${execution.execution.caseId} #${execution.execution.repetition}: ${execution.caseVerdict}`,
    );
  }
  dependencies.log(`Report: ${reportDirectory}`);

  if (report.verdict !== 'passed') {
    throw new Error(
      `Suite ${request.suiteId} finished with verdict ${report.verdict}. Review ${reportDirectory}.`,
    );
  }
  return { report, reportDirectory };
}

function loadRepositoryEnvironment(
  repositoryRoot: string,
  dependencies: ConfiguredEvaluationDependencies,
): void {
  const envPath = path.join(repositoryRoot, '.env');
  if (dependencies.pathExists(envPath)) dependencies.loadEnvFile(envPath);
}

function requiredEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  envPath: string,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is missing. Configure it in ${envPath} or the IDE process environment.`);
  return value;
}

function safeId(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'evaluation';
}
