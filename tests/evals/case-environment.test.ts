/* Verifies the Evaluation caller against a real, isolated Application. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { resolveCandidateModel } from '../../evals/agent/adapters/candidate-model';
import { loadCase } from '../../evals/agent/datasets/dataset-loader';
import { createCaseEnvironment } from '../../evals/agent/run/case-environment';
import { executeCase } from '../../evals/agent/run/case-execution';
import { createScriptedStreams } from '../packages/composition/compose-test-application';

it('executes a controlled conversation and retains its actual workspace result', async () => {
  const repositoryRoot = process.cwd();
  const resolvedCase = await loadCase({
    rootDirectory: path.join(repositoryRoot, 'evals/agent/datasets'),
    identity: 'controlled/conversation.create-workspace-note',
  });
  const candidateModel = await resolveCandidateModel({
    config: {
      source: 'explicit',
      providerId: 'test',
      modelId: 'model',
      api: 'openai-completions',
      baseUrl: 'https://example.test/v1',
      contextWindowTokens: 64_000,
      maxOutputTokens: 2048,
      credentialEnvironmentVariable: 'TEST_MODEL_KEY',
    },
    environment: { TEST_MODEL_KEY: 'test-key' },
  });
  const scripted = createScriptedStreams([
    [{ type: 'toolCall', id: 'read-source', name: 'read_file', arguments: { path: 'source.md' } }],
    [
      {
        type: 'toolCall',
        id: 'write-note',
        name: 'write_file',
        arguments: {
          path: 'notes.md',
          content: '外部未知数据必须先进行运行时校验',
        },
      },
    ],
    '已将核心规则保存到 notes.md。',
  ]);
  const environment = await createCaseEnvironment({
    repositoryRoot,
    resolvedCase,
    candidateModel,
    modelStreams: { 'openai-completions': scripted.streams },
  });
  try {
    const result = await executeCase({
      evaluationCase: resolvedCase.case,
      runtime: environment.runtime,
      initialStateIds: environment.initialStateIds,
      candidateModel: candidateModel.config,
      now: environment.now,
      safetyWallClockLimitMs: 10_000,
    });
    expect(result.terminalState).toBe('settled');
    expect(result.businessIds.executionIds).toHaveLength(1);
    expect(await readFile(path.join(environment.paths.workspace, 'notes.md'), 'utf8')).toBe(
      '外部未知数据必须先进行运行时校验',
    );
  } finally {
    await environment.dispose();
  }
});
