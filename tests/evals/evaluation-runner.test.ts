/* Verifies selection, isolated execution, immutable records, and failure continuation through runEvaluation. */
// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CaseRunResultSchema, EvaluationRunRequestSchema } from '../../evals/agent/contracts/evaluation-run';
import { runEvaluation } from '../../evals/agent/run/evaluation-runner';
import { createScriptedStreams } from '../packages/composition/compose-test-application';

let temporaryRoot: string | undefined;
const now = '2026-09-03T00:00:00.000Z';

afterEach(() => {
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

describe('Evaluation Run', () => {
  it('deduplicates Dataset and direct Case selection, then seals facts without evaluating them', async () => {
    const roots = await createDatasetRoot();
    const scripted = createScriptedStreams(['The task is complete.']);
    const request = EvaluationRunRequestSchema.parse({
      datasetIds: ['controlled/conversation-a', 'controlled/conversation-b'],
      caseIds: ['controlled/conversation.record-facts'],
      candidateModel: candidateConfig(),
      safetyWallClockLimitMs: 5_000,
    });

    const result = await runEvaluation({
      repositoryRoot: process.cwd(),
      evaluationRoot: roots.evaluationRoot,
      datasetRoot: roots.datasetRoot,
      request,
      environment: { TEST_EVALUATION_API_KEY: 'test-key' },
      dependencies: {
        createRunId: () => 'run.test',
        now: monotonicClock(),
        modelStreams: { 'openai-completions': scripted.streams },
      },
    });

    expect(result.record).toMatchObject({
      runId: 'run.test', status: 'completed',
      selection: {
        datasets: [
          { identity: 'controlled/conversation-a' },
          { identity: 'controlled/conversation-b' },
        ],
        directCaseIds: ['controlled/conversation.record-facts'],
      },
      caseRuns: [{
        caseRunId: 'controlled.conversation.record-facts.r1',
        caseIdentity: 'controlled/conversation.record-facts',
        datasetMemberships: ['controlled/conversation-a', 'controlled/conversation-b'],
        recordStatus: 'recorded',
      }],
    });
    expect(result.runDirectory).toBe(path.join(roots.evaluationRoot, 'records', 'run.test'));
    const caseDirectory = path.join(result.runDirectory, 'cases', 'controlled.conversation.record-facts.r1');
    expect(existsSync(path.join(caseDirectory, 'case.json'))).toBe(true);
    expect(existsSync(path.join(caseDirectory, 'result.json'))).toBe(true);
    expect(existsSync(path.join(caseDirectory, 'traces', 'manifest.json'))).toBe(true);
    expect(existsSync(path.join(caseDirectory, 'traces', 'journal'))).toBe(true);
    expect(existsSync(path.join(caseDirectory, 'artifacts'))).toBe(true);
    expect(existsSync(path.join(caseDirectory, 'home'))).toBe(false);
    expect(existsSync(path.join(caseDirectory, 'megumi.sqlite'))).toBe(false);
    expect(existsSync(path.join(result.runDirectory, 'cases', '.controlled.conversation.record-facts.r1.draft'))).toBe(false);

    const caseSnapshot = readJson(path.join(caseDirectory, 'case.json'));
    const caseResult = CaseRunResultSchema.parse(readJson(path.join(caseDirectory, 'result.json')));
    expect(caseSnapshot).toMatchObject({
      identity: 'controlled/conversation.record-facts', revision: 1,
      datasetMemberships: ['controlled/conversation-a', 'controlled/conversation-b'],
      case: { expected: { expectedFacts: ['EXPECTED MUST NOT ENTER CANDIDATE CONTEXT'] } },
    });
    expect(caseResult).toMatchObject({
      recordStatus: 'recorded', terminalState: 'settled',
      businessIds: { sessionId: expect.any(String), executionIds: [expect.any(String)] },
      productResult: { steps: [{ status: 'ok' }] },
      traceIntegrity: { status: 'complete' },
      artifacts: { files: [] },
    });
    expect(caseResult.traceIntegrity.traceCount).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(scripted.contexts)).not.toContain('EXPECTED MUST NOT ENTER CANDIDATE CONTEXT');
    expect(JSON.stringify(caseResult)).not.toMatch(/score|judgement|evaluator|grader|report/iu);
  });

  it('validates every selection before creating a Run directory or starting a Case', async () => {
    const roots = await createDatasetRoot();
    const request = EvaluationRunRequestSchema.parse({
      datasetIds: ['controlled/missing-dataset'],
      candidateModel: candidateConfig(),
    });

    await expect(runEvaluation({
      repositoryRoot: process.cwd(), evaluationRoot: roots.evaluationRoot,
      datasetRoot: roots.datasetRoot, request,
      environment: { TEST_EVALUATION_API_KEY: 'test-key' },
    })).rejects.toThrow(/missing-dataset|cannot read evaluation json/iu);
    expect(existsSync(path.join(roots.evaluationRoot, 'records'))).toBe(false);
  });

  it('records one Case infrastructure failure and still runs the remaining Case', async () => {
    const roots = await createDatasetRoot({ includeUnsupportedSourceCase: true });
    const scripted = createScriptedStreams(['The task is complete.']);
    const request = EvaluationRunRequestSchema.parse({
      datasetIds: ['controlled/mixed'],
      candidateModel: candidateConfig(),
      safetyWallClockLimitMs: 5_000,
    });

    const result = await runEvaluation({
      repositoryRoot: process.cwd(), evaluationRoot: roots.evaluationRoot,
      datasetRoot: roots.datasetRoot, request,
      environment: { TEST_EVALUATION_API_KEY: 'test-key' },
      dependencies: {
        createRunId: () => 'run.failure-continuation',
        now: monotonicClock(),
        modelStreams: { 'openai-completions': scripted.streams },
      },
    });

    expect(result.record.status).toBe('completed_with_failures');
    expect(result.record.caseRuns).toHaveLength(2);
    expect(result.record.caseRuns.map(({ recordStatus }) => recordStatus).sort()).toEqual([
      'infrastructure_failed', 'recorded',
    ]);
    for (const caseRun of result.record.caseRuns) {
      expect(existsSync(path.join(result.runDirectory, caseRun.resultPath))).toBe(true);
    }
  });
});

async function createDatasetRoot(options: { readonly includeUnsupportedSourceCase?: boolean } = {}) {
  temporaryRoot = mkdtempSync(path.join(tmpdir(), 'megumi-evaluation-runner-test-'));
  const datasetRoot = path.join(temporaryRoot, 'datasets');
  const evaluationRoot = path.join(temporaryRoot, 'evaluation');
  const caseRoot = path.join(datasetRoot, 'controlled', 'cases');
  const manifestRoot = path.join(datasetRoot, 'controlled', 'manifests');
  await mkdir(path.join(caseRoot, 'conversation'), { recursive: true });
  await mkdir(path.join(datasetRoot, 'live', 'cases'), { recursive: true });
  await mkdir(path.join(datasetRoot, 'live', 'manifests'), { recursive: true });
  await mkdir(manifestRoot, { recursive: true });
  await writeJson(path.join(caseRoot, 'conversation', 'record-facts.json'), conversationCase());
  await writeJson(path.join(manifestRoot, 'conversation-a.json'), manifest('conversation-a', ['conversation.record-facts']));
  await writeJson(path.join(manifestRoot, 'conversation-b.json'), manifest('conversation-b', ['conversation.record-facts']));
  if (options.includeUnsupportedSourceCase) {
    await mkdir(path.join(caseRoot, 'candidate-supply'), { recursive: true });
    await writeJson(path.join(caseRoot, 'candidate-supply', 'unsupported-source.json'), unsupportedSourceCase());
    await writeJson(path.join(manifestRoot, 'mixed.json'), manifest('mixed', [
      'candidate-supply.unsupported-source', 'conversation.record-facts',
    ]));
  }
  return { datasetRoot, evaluationRoot };
}

function conversationCase() {
  return {
    schemaVersion: 2, caseId: 'conversation.record-facts', revision: 1,
    name: 'Record facts', description: 'Run one real Conversation and record its facts.',
    type: 'conversation',
    initialState: { clock: now, workspaceFiles: [], sessionHistory: [], controlledWeb: [], approvalDecisions: [] },
    input: { steps: [{ userInput: 'Complete this task.', permissionMode: 'full_access' }] },
    expected: { expectedFacts: ['EXPECTED MUST NOT ENTER CANDIDATE CONTEXT'], allowedOutcomes: ['completed'] },
  };
}

function unsupportedSourceCase() {
  return {
    schemaVersion: 2, caseId: 'candidate-supply.unsupported-source', revision: 1,
    name: 'Unsupported source', description: 'Fails only while composing its Controlled Adapter.',
    type: 'candidate_supply',
    initialState: {
      clock: now, minimumCount: 1, maximumCount: 3,
      interests: [{ referenceId: 'interest', description: 'TypeScript', status: 'active' }],
      existingCandidates: [],
      controlledSources: [{ sourceId: 'unsupported', queryIncludes: 'TypeScript', results: [] }],
    },
    input: { trigger: 'supply_conditions_changed' },
  };
}

function manifest(datasetId: string, caseIds: readonly string[]) {
  return {
    schemaVersion: 1, environmentKind: 'controlled', datasetId, revision: 1,
    name: datasetId, description: `Dataset ${datasetId}.`, caseIds,
  };
}

function candidateConfig() {
  return {
    source: 'explicit', providerId: 'test', modelId: 'model', api: 'openai-completions',
    baseUrl: 'https://example.test/v1', contextWindowTokens: 64_000, maxOutputTokens: 2_048,
    credentialEnvironmentVariable: 'TEST_EVALUATION_API_KEY',
  };
}

function monotonicClock(): () => Date {
  let milliseconds = Date.parse(now);
  return () => new Date(milliseconds++);
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(file: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  return parsed;
}
