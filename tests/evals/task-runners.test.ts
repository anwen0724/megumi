/* Protects multi-step Conversation Task continuity and final Workspace capture. */
// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ProductRuntime } from '@megumi/composition';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvaluationRunConfigSchema } from '../../evals/agent/contracts/evaluation-run-config';
import { EvaluationTaskSchema } from '../../evals/agent/contracts/evaluation-task';
import { conversationTaskRunner } from '../../evals/agent/runners/conversation-task-runner';

let workspace: string | undefined;
afterEach(async () => { if (workspace) await rm(workspace, { recursive: true, force: true }); workspace = undefined; });

describe('Conversation Task Runner', () => {
  it('runs every step in one Session and returns final Workspace files', async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'megumi-task-runner-'));
    await writeFile(path.join(workspace, 'result.md'), '# Final result', 'utf8');
    const sentSessionIds: Array<string | undefined> = [];
    let execution = 0;
    const runtime = {
      host: {
        session: {
          readSession: vi.fn(async () => ({ status: 'ok', session: { id: 'session:1' } })),
          sendUserInput: vi.fn(async (input: { sessionId?: string }) => {
            sentSessionIds.push(input.sessionId);
            execution += 1;
            return {
              payload: {
                type: 'agent_run', session: { id: 'session:1' },
                run: { executionId: `execution:${execution}` }, userMessageId: `message:${execution}`,
              },
            };
          }),
          readCommittedRun: vi.fn(async () => ({
            status: 'ok',
            messages: [{ type: 'message', message: { kind: 'assistantReply' } }],
          })),
        },
      },
      subscribeRuntimeEvents: vi.fn(() => ({ unsubscribe: vi.fn() })),
    } as unknown as ProductRuntime;
    const task = EvaluationTaskSchema.parse({
      taskId: 'conversation.multi-step', revision: 1, title: 'Multi step', objective: 'Keep context.',
      difficulty: 'complex', profiles: ['controlled'], tags: [], runner: 'conversation',
      scenario: {
        clock: '2026-01-01T00:00:00.000Z', workspace: { files: [] }, sessions: [], interests: [],
        candidates: [], recommendations: [], preferences: [], controlledSearch: [], permissionDecision: 'allow',
      },
      steps: [
        { userInput: 'Create a result.', permissionMode: 'full_access' },
        { userInput: 'Review the same result.', permissionMode: 'full_access' },
      ],
      completion: { kind: 'conversation_steps_terminal', timeoutMs: 1_000 },
      metrics: [{ metricId: 'completion', title: 'Completion', evaluator: 'rule', rule: 'business_completion_present', required: true }],
    });
    const executionEvidence = await conversationTaskRunner.execute({
      task,
      runConfig: EvaluationRunConfigSchema.parse({
        profile: 'controlled', taskIds: [task.taskId], suiteIds: [],
        candidateModel: modelConfig('CANDIDATE_KEY'), graderModel: modelConfig('GRADER_KEY'),
        budget: { maxTasks: 1 }, runRoot: workspace,
      }),
      runtime,
      scenarioIds: {
        workspaceId: 'workspace:1', sessions: {}, interests: {}, candidates: {}, recommendations: {},
        preferenceRevisions: [],
      },
      workspacePath: workspace,
      environment: { profile: 'controlled' },
      now: () => task.scenario.clock,
    });
    expect(sentSessionIds).toEqual([undefined, 'session:1']);
    expect(executionEvidence.correlations).toHaveLength(2);
    expect(executionEvidence.afterFacts.workspaceFiles).toEqual({ 'result.md': '# Final result' });
  });
});

function modelConfig(apiKeyEnv: string) {
  return {
    providerId: 'test', modelId: 'model', api: 'openai-completions' as const, apiKeyEnv,
    baseUrl: 'https://example.test/v1', contextWindowTokens: 64_000, maxOutputTokens: 2_048,
  };
}
