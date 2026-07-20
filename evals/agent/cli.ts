/* Provides explicit run, list, and manual Baseline acceptance commands. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEvaluationCatalog } from './config/load-evaluation-catalog';
import { createComposeProductEvaluationFactory } from './runner/compose-product-runtime-factory';
import { runEvaluationSuite } from './runner/evaluation-suite-runner';
import { acceptEvaluationBaseline } from './reporters/report-writer';
import type { EvaluationSuiteReport } from './reporters/evaluation-report';

const evaluationRoot = path.resolve(__dirname);
const repositoryRoot = path.resolve(evaluationRoot, '..', '..');

void main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(args: string[]): Promise<void> {
  const command = args[0];
  if (command === 'list') {
    await listCatalog();
    return;
  }
  if (command === 'run') {
    await runSuite(args.slice(1));
    return;
  }
  if (command === 'accept-baseline') {
    await acceptBaseline(args.slice(1));
    return;
  }
  printHelp();
  if (command) process.exitCode = 1;
}

async function listCatalog(): Promise<void> {
  const catalog = await loadEvaluationCatalog(evaluationRoot);
  printGroup('Suites', catalog.suites.map((item) => `${item.suiteId}\t${item.name}\tprofile=${item.executionProfileId}`));
  printGroup('Cases', catalog.cases.map((item) => `${item.caseId}\t${item.name}`));
  printGroup('Targets', catalog.targets.map((item) => `${item.targetId}\t${item.providerId}/${item.modelId}`));
  printGroup('Profiles', catalog.profiles.map((item) => `${item.profileId}\t${item.environmentKind}/${item.isolation}`));
}

async function runSuite(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const suiteId = requiredOption(options, 'suite');
  const targetId = requiredOption(options, 'target');
  const profileId = requiredOption(options, 'profile');
  const credentialEnv = requiredOption(options, 'credential-env');
  const credential = process.env[credentialEnv];
  if (!credential) throw new Error(`Credential environment variable is missing or empty: ${credentialEnv}`);
  const webSearchProvider = optionValue(options, 'web-search-provider');
  const webSearchCredentialEnv = optionValue(options, 'web-search-credential-env');
  if (Boolean(webSearchProvider) !== Boolean(webSearchCredentialEnv)) {
    throw new Error('--web-search-provider and --web-search-credential-env must be provided together.');
  }
  const webSearchCredential = webSearchCredentialEnv ? process.env[webSearchCredentialEnv] : undefined;
  if (webSearchCredentialEnv && !webSearchCredential) {
    throw new Error(`Web search credential environment variable is missing or empty: ${webSearchCredentialEnv}`);
  }
  const webSearchBaseUrl = optionValue(options, 'web-search-base-url');
  const catalog = await loadEvaluationCatalog(evaluationRoot);
  const profile = catalog.profiles.find((item) => item.profileId === profileId);
  if (!profile) throw new Error(`Execution Profile was not found: ${profileId}`);
  if (profile.environmentKind === 'live') {
    console.error('Live Evaluation may incur Provider charges and depends on changing external services.');
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDirectory = path.join(evaluationRoot, '..', 'reports', `${timestamp}-${safeId(suiteId)}-${safeId(targetId)}`);
  const repetitions = optionValue(options, 'repetitions');
  const explicitCaseIds = optionValues(options, 'case');
  const tags = optionValues(options, 'tag');
  const caseIds = resolveCaseFilter(catalog, suiteId, explicitCaseIds, tags);
  const report = await runEvaluationSuite({
    catalog,
    suiteId,
    targetId,
    profileId,
    evaluationRoot,
    repositoryRoot,
    runtimeFactory: createComposeProductEvaluationFactory({
      credential,
      ...(webSearchProvider && webSearchCredential ? {
        webSearch: {
          provider: webSearchProviderValue(webSearchProvider),
          credential: webSearchCredential,
          ...(webSearchBaseUrl ? { baseUrl: webSearchBaseUrl } : {}),
        },
      } : {}),
    }),
    availableIsolation: ['workspace_only'],
    reportDirectory,
    retainEnvironments: options.has('retain-environments'),
    ...(repetitions ? { repetitionsOverride: positiveInteger(repetitions, 'repetitions') } : {}),
    ...(explicitCaseIds.length > 0 || tags.length > 0 ? { caseIds } : {}),
  });
  console.log(`Suite verdict: ${report.verdict}`);
  console.log(`Report: ${reportDirectory}`);
  if (report.verdict !== 'passed') process.exitCode = 1;
}

async function acceptBaseline(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const reportPath = path.resolve(requiredOption(options, 'report'));
  const baselineId = safeId(requiredOption(options, 'baseline'));
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as EvaluationSuiteReport;
  const baselinePath = path.join(evaluationRoot, 'baselines', `${baselineId}.json`);
  await acceptEvaluationBaseline(report, baselinePath);
  console.log(`Baseline accepted: ${baselinePath}`);
}

function parseOptions(args: string[]): Map<string, string[]> {
  const output = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = args[index + 1];
    const value = next && !next.startsWith('--') ? next : 'true';
    if (value !== 'true') index += 1;
    output.set(key, [...(output.get(key) ?? []), value]);
  }
  return output;
}

function requiredOption(options: Map<string, string[]>, key: string): string {
  const value = optionValue(options, key);
  if (!value || value === 'true') throw new Error(`Missing required option: --${key}`);
  return value;
}

function optionValue(options: Map<string, string[]>, key: string): string | undefined {
  return options.get(key)?.at(-1);
}

function optionValues(options: Map<string, string[]>, key: string): string[] {
  return (options.get(key) ?? []).filter((value) => value !== 'true');
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function safeId(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) throw new Error(`Unsafe Evaluation identifier: ${value}`);
  return value;
}

function webSearchProviderValue(value: string): 'brave' | 'tavily' | 'exa' | 'custom' {
  if (value === 'brave' || value === 'tavily' || value === 'exa' || value === 'custom') return value;
  throw new Error(`Unsupported web search provider: ${value}`);
}

function resolveCaseFilter(
  catalog: Awaited<ReturnType<typeof loadEvaluationCatalog>>,
  suiteId: string,
  explicitCaseIds: string[],
  tags: string[],
): string[] {
  if (explicitCaseIds.length === 0 && tags.length === 0) return [];
  const suite = catalog.suites.find((item) => item.suiteId === suiteId);
  if (!suite) throw new Error(`Evaluation Suite was not found: ${suiteId}`);
  const explicitlySelected = explicitCaseIds.length > 0 ? new Set(explicitCaseIds) : undefined;
  return suite.caseIds.filter((caseId) => {
    if (explicitlySelected && !explicitlySelected.has(caseId)) return false;
    if (tags.length === 0) return true;
    const evaluationCase = catalog.cases.find((item) => item.caseId === caseId);
    return Boolean(evaluationCase && tags.some((tag) => evaluationCase.tags.includes(tag)));
  });
}

function printGroup(label: string, items: string[]): void {
  console.log(`${label}:`);
  for (const item of items) console.log(`  ${item}`);
}

function printHelp(): void {
  console.log('Megumi Agent Evaluation');
  console.log('  list');
  console.log('  run --suite <id> --target <id> --profile <id> --credential-env <name> [--web-search-provider <id> --web-search-credential-env <name>] [--case <id>] [--tag <tag>] [--repetitions <n>]');
  console.log('  accept-baseline --report <summary.json> --baseline <id>');
}
