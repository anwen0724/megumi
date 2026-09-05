/* Verifies Evaluation Dataset authoring through the public Dataset Module interface. */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EvaluationCaseSchema } from '../../evals/agent/contracts/evaluation-dataset';
import { loadCase, loadDataset, validateDatasets } from '../../evals/agent/datasets/dataset-loader';

const DATASET_ROOT = path.resolve('evals', 'agent', 'datasets');

describe('Evaluation Dataset', () => {
  it('allows the no-Interest/no-source scenario but rejects unsupported Controlled sources before startup', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'megumi-dataset-source-boundary-'));
    const directory = path.join(root, 'controlled/cases/candidate-supply');
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, 'source.json');
    const candidateCase = candidateSupplyCase();
    await writeJson(file, { ...candidateCase, initialState: { ...candidateCase.initialState, interests: [] } });
    await expect(loadCase({ rootDirectory: root, identity: 'controlled/candidate-supply.source' })).resolves.toBeDefined();
    await writeJson(file, { ...candidateCase, initialState: { ...candidateCase.initialState, controlledSources: [{ sourceId: 'douyin', queryIncludes: '', results: [] }] } });
    await expect(loadCase({ rootDirectory: root, identity: 'controlled/candidate-supply.source' })).rejects.toThrow(/unsupported controlled source/iu);
  });
  it('loads one controlled Dataset and fixed Case shape for every supported business', async () => {
    const validated = await validateDatasets({ rootDirectory: DATASET_ROOT });

    expect(validated).toEqual({ datasetCount: 7, caseCount: 13, warnings: [] });

    const identities = [
      'controlled/conversation',
      'controlled/interest-understanding',
      'controlled/candidate-supply',
      'controlled/recommendation',
      'controlled/preference-learning',
    ] as const;
    const datasets = await Promise.all(identities.map((identity) => loadDataset({
      rootDirectory: DATASET_ROOT,
      identity,
    })));

    expect(datasets.map((dataset) => dataset.cases[0]?.case.type)).toEqual([
      'conversation',
      'interest_understanding',
      'candidate_supply',
      'recommendation',
      'preference_learning',
    ]);
    for (const dataset of datasets) {
      expect(dataset.digest).toMatch(/^[a-f0-9]{64}$/u);
      expect(dataset.cases).toHaveLength(1);
      expect(dataset.cases[0]?.digest).toMatch(/^[a-f0-9]{64}$/u);
      expect(dataset.cases[0]?.memberships).toEqual([dataset.identity]);
      expect(dataset.cases[0]?.case).not.toHaveProperty('metrics');
      expect(dataset.cases[0]?.case).not.toHaveProperty('timeoutMs');
    }
  });

  it('rejects duplicate business references inside a fixed Case contract', () => {
    const candidateCase = {
      schemaVersion: 2,
      caseId: 'candidate-supply.duplicate-interest',
      revision: 1,
      name: '重复兴趣',
      description: '重复的引用会使 Initial State 不确定。',
      type: 'candidate_supply',
      initialState: {
        clock: '2026-01-15T08:00:00.000Z',
        minimumCount: 1,
        maximumCount: 3,
        interests: [
          { referenceId: 'agent', description: 'Agent', status: 'active' },
          { referenceId: 'agent', description: 'Agent Evaluation', status: 'active' },
        ],
        existingCandidates: [],
        controlledSources: [{ sourceId: 'open_web', queryIncludes: 'Agent', results: [] }],
      },
      input: { trigger: 'supply_conditions_changed' },
    };

    expect(() => EvaluationCaseSchema.parse(candidateCase)).toThrow(/Interest reference is duplicated/iu);
  });

  it('requires controlled search data only for Controlled Candidate Supply Cases', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'megumi-dataset-environment-'));
    for (const environmentKind of ['controlled', 'live'] as const) {
      const cases = path.join(root, environmentKind, 'cases', 'candidate-supply');
      await mkdir(cases, { recursive: true });
      await writeJson(path.join(cases, 'source.json'), candidateSupplyCase());
    }

    await expect(loadCase({ rootDirectory: root, identity: 'controlled/candidate-supply.source' }))
      .rejects.toThrow(/requires at least one controlled source/iu);
    await expect(loadCase({ rootDirectory: root, identity: 'live/candidate-supply.source' }))
      .resolves.toMatchObject({ identity: 'live/candidate-supply.source' });
  });

  it('returns Dataset members in stable Case identity order', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'megumi-dataset-order-'));
    const cases = path.join(root, 'controlled', 'cases', 'conversation');
    const manifests = path.join(root, 'controlled', 'manifests');
    await Promise.all([mkdir(cases, { recursive: true }), mkdir(manifests, { recursive: true })]);
    await writeJson(path.join(cases, 'z.json'), conversationCase('conversation.z'));
    await writeJson(path.join(cases, 'a.json'), conversationCase('conversation.a'));
    await writeJson(path.join(manifests, 'ordered.json'), {
      schemaVersion: 1,
      environmentKind: 'controlled',
      datasetId: 'ordered',
      revision: 1,
      name: 'Ordered',
      description: 'Stable ordering.',
      caseIds: ['conversation.z', 'conversation.a'],
    });

    const dataset = await loadDataset({ rootDirectory: root, identity: 'controlled/ordered' });

    expect(dataset.cases.map((entry) => entry.identity)).toEqual([
      'controlled/conversation.a',
      'controlled/conversation.z',
    ]);
  });

  it('reports an authored Case that no Dataset explicitly references', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'megumi-dataset-warning-'));
    const cases = path.join(root, 'controlled', 'cases', 'conversation');
    const manifests = path.join(root, 'controlled', 'manifests');
    await Promise.all([mkdir(cases, { recursive: true }), mkdir(manifests, { recursive: true })]);
    await writeJson(path.join(cases, 'used.json'), conversationCase('conversation.used'));
    await writeJson(path.join(cases, 'unused.json'), conversationCase('conversation.unused'));
    await writeJson(path.join(manifests, 'core.json'), {
      schemaVersion: 1,
      environmentKind: 'controlled',
      datasetId: 'core',
      revision: 1,
      name: 'Core',
      description: 'Core Dataset.',
      caseIds: ['conversation.used'],
    });

    const result = await validateDatasets({ rootDirectory: root });

    expect(result.warnings).toEqual([
      'Case controlled/conversation.unused is not referenced by any Dataset.',
    ]);
  });

  it('rejects credential-like secrets before a Case enters the catalog', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'megumi-dataset-secret-'));
    const cases = path.join(root, 'controlled', 'cases', 'conversation');
    const manifests = path.join(root, 'controlled', 'manifests');
    await Promise.all([mkdir(cases, { recursive: true }), mkdir(manifests, { recursive: true })]);
    const unsafe = conversationCase('conversation.unsafe');
    unsafe.initialState.workspaceFiles.push({
      path: 'secret.txt',
      content: 'sk-examplecredential1234567890',
    });
    await writeJson(path.join(cases, 'unsafe.json'), unsafe);
    await writeJson(path.join(manifests, 'unsafe.json'), {
      schemaVersion: 1,
      environmentKind: 'controlled',
      datasetId: 'unsafe',
      revision: 1,
      name: 'Unsafe',
      description: 'Must fail validation.',
      caseIds: ['conversation.unsafe'],
    });

    await expect(loadDataset({ rootDirectory: root, identity: 'controlled/unsafe' }))
      .rejects.toThrow(/Credential-like secret/iu);
  });
});

function conversationCase(caseId: string) {
  return {
    schemaVersion: 2,
    caseId,
    revision: 1,
    name: caseId,
    description: 'A deterministic conversation Case.',
    type: 'conversation',
    initialState: {
      clock: '2026-01-15T08:00:00.000Z',
      workspaceFiles: [],
      sessionHistory: [],
      controlledWeb: [],
      approvalDecisions: [],
    },
    input: { steps: [{ userInput: 'Answer briefly.', permissionMode: 'auto' }] },
  };
}

function candidateSupplyCase() {
  return {
    schemaVersion: 2,
    caseId: 'candidate-supply.source',
    revision: 1,
    name: 'Environment-specific source',
    description: 'Controlled source data is optional only when the Live Adapter supplies it.',
    type: 'candidate_supply',
    initialState: {
      clock: '2026-01-15T08:00:00.000Z',
      minimumCount: 1,
      maximumCount: 3,
      interests: [{ referenceId: 'agent', description: 'Agent', status: 'active' }],
      existingCandidates: [],
    },
    input: { trigger: 'supply_conditions_changed' },
  };
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
