/* Protects initial-state Candidate details and real Conversation terminal-state interpretation. */
// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ProductRuntime } from '@megumi/composition';
import { afterEach, describe, expect, it } from 'vitest';
import { EvaluationInitialStateSchema, EvaluationTaskSchema } from '../../evals/agent/contracts/evaluation-task';
import { executeTask } from '../../evals/agent/execution/execute-task';
import {
  createDatabaseInitialStateOwner,
  installInitialState,
} from '../../evals/agent/execution/initial-state';

let temporaryRoot: string | undefined;
afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

describe('Evaluation execution regressions', () => {
  it('installs Candidate full content before admission through the real repository lifecycle', async () => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), 'megumi-evaluation-initial-state-'));
    const homePath = path.join(temporaryRoot, 'home');
    const workspaceRoot = path.join(temporaryRoot, 'workspace');
    await mkdir(path.join(homePath, 'sqlite'), { recursive: true });
    await mkdir(workspaceRoot, { recursive: true });
    const initialState = EvaluationInitialStateSchema.parse({
      clock: '2026-01-01T00:00:00.000Z',
      workspaceFiles: [], sessions: [], recommendations: [], preferences: [], controlledSearch: [],
      permissionDecision: 'allow',
      interests: [{ referenceId: 'typescript', description: 'TypeScript engineering', status: 'active' }],
      candidates: [{
        referenceId: 'article', sourceId: 'open_web', sourceName: 'Open Web',
        canonicalUrl: 'https://example.test/article', title: 'TypeScript article',
        description: 'Summary', contentText: 'Complete article body.',
        matchedInterestReferenceIds: ['typescript'], relevance: 'direct',
      }],
    });
    const databaseOwner = createDatabaseInitialStateOwner({
      homePath,
      migrationsFolder: path.join(process.cwd(), 'packages', 'agent', 'database', 'migrations'),
      now: initialState.clock,
    });
    try {
      const installed = await installInitialState({ initialState, workspaceRoot, owner: databaseOwner.owner });
      expect(installed.candidates.article).toMatch(/^candidate:/u);
    } finally {
      databaseOwner.close();
    }
  });

  it('installs the domain-rich initial states used by recommendation and preference Tasks', async () => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), 'megumi-evaluation-task-state-'));
    const files = [
      'daily-recommendation/novel-diverse-selection.json',
      'daily-recommendation/preference-aware-selection.json',
      'preference-learning/preference-correction.json',
      'preference-learning/preference-retraction.json',
    ];
    for (const [index, file] of files.entries()) {
      const task = EvaluationTaskSchema.parse(JSON.parse(await readFile(
        path.join(process.cwd(), 'evals', 'agent', 'tasks', file),
        'utf8',
      )));
      const homePath = path.join(temporaryRoot, String(index), 'home');
      const workspaceRoot = path.join(temporaryRoot, String(index), 'workspace');
      await mkdir(path.join(homePath, 'sqlite'), { recursive: true });
      await mkdir(workspaceRoot, { recursive: true });
      const databaseOwner = createDatabaseInitialStateOwner({
        homePath,
        migrationsFolder: path.join(process.cwd(), 'packages', 'agent', 'database', 'migrations'),
        now: task.initialState.clock,
      });
      try {
        await expect(installInitialState({
          initialState: task.initialState,
          workspaceRoot,
          owner: databaseOwner.owner,
        })).resolves.toBeDefined();
      } finally {
        databaseOwner.close();
      }
    }
  });

  it('treats a committed failed Assistant Reply as product failure rather than completion', async () => {
    const task = EvaluationTaskSchema.parse({
      taskId: 'conversation.failed-reply', revision: 1, title: 'Failed reply',
      objective: 'Observe a failed product reply.', difficulty: 'simple', profiles: ['controlled'], tags: [],
      initialState: {
        clock: '2026-01-01T00:00:00.000Z', workspaceFiles: [], sessions: [], interests: [],
        candidates: [], recommendations: [], preferences: [], controlledSearch: [], permissionDecision: 'allow',
      },
      input: { type: 'conversation', steps: [{ userInput: 'Do the task.', permissionMode: 'auto' }] },
      timeoutMs: 1_000,
      metrics: [{
        metricId: 'completion', title: 'Completion', evaluator: 'rule',
        rule: 'business_completion_present', required: true,
      }],
    });
    const runtime = {
      host: {
        session: {
          async sendUserInput() {
            return {
              payload: {
                type: 'agent_run',
                session: { id: 'session:1' },
                run: { executionId: 'execution:1' },
                userMessageId: 'message:1',
              },
            };
          },
          async readCommittedRun() {
            return {
              status: 'ok',
              messages: [{
                type: 'message',
                entryId: 'entry:1',
                message: {
                  kind: 'assistantReply', status: 'failed', reasonCode: 'model_call_failed',
                },
              }],
            };
          },
        },
      },
    } as unknown as ProductRuntime;

    const execution = await executeTask({
      task,
      runtime,
      initialStateIds: {
        workspaceId: 'workspace:1', sessions: {}, interests: {}, candidates: {},
        recommendations: {}, preferenceRevisions: [],
      },
      candidateModel: { providerId: 'test', modelId: 'test' },
      now: () => task.initialState.clock,
    });

    expect(execution.outcome).toEqual({
      status: 'failed',
      message: 'Assistant Reply failed: model_call_failed.',
    });
  });
});
