/* Loads and validates Case and Suite files, then resolves their references. */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  EvaluationCaseSchema,
  evaluationCapabilityDirectory,
  type EvaluationCase,
} from './evaluation-case';
import { EvaluationSuiteSchema, type EvaluationSuite } from './evaluation-suite';
import { EvaluationFixtureSchema } from '../fixtures/fixture';

export interface EvaluationCatalog {
  readonly cases: ReadonlyMap<string, EvaluationCase>;
  readonly suites: ReadonlyMap<string, EvaluationSuite>;
  resolveSuite(suiteId: string): { readonly suite: EvaluationSuite; readonly cases: readonly EvaluationCase[] };
}

export async function loadEvaluationCatalog(root: string): Promise<EvaluationCatalog> {
  const cases = new Map<string, EvaluationCase>();
  for (const file of await listJsonFiles(path.join(root, 'cases'))) {
    const parsed = EvaluationCaseSchema.parse(await readJson(file));
    validateDimensions(parsed);
    const fixture = EvaluationFixtureSchema.parse(await readJson(path.join(
      root,
      'fixtures',
      evaluationCapabilityDirectory(parsed.capability),
      `${parsed.setup.fixtureId}.json`,
    )));
    if (fixture.fixtureId !== parsed.setup.fixtureId
      || fixture.capability !== parsed.capability
      || fixture.version !== parsed.fixtureVersion) {
      throw new Error(`Case ${parsed.caseId} does not match Fixture ${parsed.setup.fixtureId}.`);
    }
    rejectDuplicate(cases, parsed.caseId, 'Case');
    cases.set(parsed.caseId, parsed);
  }
  const suites = new Map<string, EvaluationSuite>();
  for (const file of await listJsonFiles(path.join(root, 'suites'))) {
    const parsed = EvaluationSuiteSchema.parse(await readJson(file));
    rejectDuplicate(suites, parsed.suiteId, 'Suite');
    for (const caseId of parsed.caseIds) {
      const evaluationCase = cases.get(caseId);
      if (!evaluationCase) throw new Error(`Suite ${parsed.suiteId} references unknown Case ${caseId}.`);
      if (!evaluationCase.profiles.includes(parsed.profile)) {
        throw new Error(`Case ${caseId} does not allow ${parsed.profile} Profile.`);
      }
    }
    suites.set(parsed.suiteId, parsed);
  }
  return {
    cases,
    suites,
    resolveSuite(suiteId) {
      const suite = suites.get(suiteId);
      if (!suite) throw new Error(`Evaluation Suite not found: ${suiteId}.`);
      return { suite, cases: suite.caseIds.map((caseId) => requireCase(cases, caseId)) };
    },
  };
}

const capabilityDimensions: Readonly<Record<EvaluationCase['capability'], readonly string[]>> = {
  conversation: ['task_completion', 'answer_quality', 'context_use', 'tool_behavior', 'safety_permissions', 'reliability_recovery'],
  interest_understanding: ['recognition_accuracy', 'omission', 'interest_merge', 'evidence_sufficiency', 'user_control', 'reliability_recovery'],
  candidate_supply: ['trigger_correctness', 'search_strategy', 'candidate_quality', 'admission_quality', 'supply_efficiency', 'reliability_recovery', 'untrusted_content_safety'],
  daily_recommendation: ['relevance', 'negative_preference', 'novelty', 'diversity_exploration', 'publication_integrity', 'reliability_recovery', 'untrusted_content_safety'],
  preference_learning: ['feedback_accuracy', 'scope_assignment', 'evidence_sufficiency', 'revision_retraction', 'stability_usability', 'reliability_recovery'],
};

function validateDimensions(evaluationCase: EvaluationCase): void {
  const allowed = new Set(capabilityDimensions[evaluationCase.capability]);
  for (const dimension of evaluationCase.grading.dimensions) {
    if (!allowed.has(dimension)) {
      throw new Error(`Case ${evaluationCase.caseId} uses invalid ${evaluationCase.capability} dimension ${dimension}.`);
    }
  }
  for (const dimension of [
    ...evaluationCase.grading.requiredDimensions,
    ...evaluationCase.grading.modelGradedDimensions,
  ]) {
    if (!evaluationCase.grading.dimensions.includes(dimension)) {
      throw new Error(`Case ${evaluationCase.caseId} grades undeclared dimension ${dimension}.`);
    }
  }
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

function requireCase(cases: ReadonlyMap<string, EvaluationCase>, caseId: string): EvaluationCase {
  const evaluationCase = cases.get(caseId);
  if (!evaluationCase) throw new Error(`Evaluation Case not found: ${caseId}.`);
  return evaluationCase;
}

function rejectDuplicate<T>(values: ReadonlyMap<string, T>, id: string, kind: string): void {
  if (values.has(id)) throw new Error(`${kind} ID is duplicated: ${id}.`);
}
