/* Loads versioned Evaluation files and validates all stable cross-file references. */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { EvaluationCaseSchema, type EvaluationCase } from '../cases/evaluation-case';
import { EvaluationSuiteSchema, type EvaluationSuite } from '../suites/evaluation-suite';
import { ExecutionProfileSchema, type ExecutionProfile } from './execution-profile';
import { EvaluationTargetSchema, type EvaluationTarget } from './evaluation-target';

export interface EvaluationCatalog {
  cases: EvaluationCase[];
  suites: EvaluationSuite[];
  targets: EvaluationTarget[];
  profiles: ExecutionProfile[];
}

export async function loadEvaluationCatalog(root: string): Promise<EvaluationCatalog> {
  const [cases, suites, targets, profiles] = await Promise.all([
    loadDirectory(path.join(root, 'cases'), EvaluationCaseSchema.parse),
    loadDirectory(path.join(root, 'suites'), EvaluationSuiteSchema.parse),
    loadDirectory(path.join(root, 'config', 'targets'), EvaluationTargetSchema.parse),
    loadDirectory(path.join(root, 'config', 'profiles'), ExecutionProfileSchema.parse),
  ]);

  assertUnique(cases, (item) => item.caseId, 'case');
  assertUnique(suites, (item) => item.suiteId, 'suite');
  assertUnique(targets, (item) => item.targetId, 'target');
  assertUnique(profiles, (item) => item.profileId, 'profile');

  const caseIds = new Set(cases.map((item) => item.caseId));
  const profileIds = new Set(profiles.map((item) => item.profileId));
  for (const suite of suites) {
    assertNoDuplicates(suite.caseIds, `Suite ${suite.suiteId} contains duplicate case IDs`);
    assertNoDuplicates(suite.policy.requiredCaseIds, `Suite ${suite.suiteId} contains duplicate required case IDs`);
    for (const caseId of suite.caseIds) {
      if (!caseIds.has(caseId)) throw new Error(`Suite ${suite.suiteId} references unknown case: ${caseId}`);
    }
    for (const caseId of suite.policy.requiredCaseIds) {
      if (!suite.caseIds.includes(caseId)) {
        throw new Error(`Suite ${suite.suiteId} requires a case outside its manifest: ${caseId}`);
      }
    }
    if (!profileIds.has(suite.executionProfileId)) {
      throw new Error(`Suite ${suite.suiteId} references unknown profile: ${suite.executionProfileId}`);
    }
  }

  return { cases, suites, targets, profiles };
}

async function loadDirectory<T>(directory: string, parse: (value: unknown) => T): Promise<T[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(names.map(async (name) => {
    const filePath = path.join(directory, name);
    let value: unknown;
    try {
      value = JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      throw new Error(`Failed to read Evaluation config ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      return parse(value);
    } catch (error) {
      throw new Error(`Invalid Evaluation config ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
}

function assertUnique<T>(items: T[], identify: (item: T) => string, label: string): void {
  const ids = items.map(identify);
  assertNoDuplicates(ids, `Duplicate ${label} ID`);
}

function assertNoDuplicates(ids: string[], message: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`${message}: ${id}`);
    seen.add(id);
  }
}
