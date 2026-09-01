/* Verifies Evidence uses real Product facts, decodes Trace content, and removes credentials. */
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import type { AnyEvent } from '@megumi/events';
import { EvaluationTaskSchema } from '../../evals/agent/contracts/evaluation-task';
import {
  collectEvidence,
  waitForCommittedRun,
} from '../../evals/agent/runtime/evidence-collector';
import {
  composeTestApplication,
  type TestApplication,
} from '../packages/composition/compose-test-application';

let application: TestApplication | undefined;
afterEach(async () => { await application?.cleanup(); application = undefined; });

describe('Evaluation Evidence collector', () => {
  it('collects correlated Trace and model usage while redacting credentials', async () => {
    const task = conversationTask();
    application = composeTestApplication(['A completed reply.']);
    await application.runtime.start();
    const opened = await application.runtime.host.workspace.useExistingProject();
    if (opened.status !== 'opened' || !opened.project) throw new Error('Test Workspace did not open.');
    const runtimeEvents: AnyEvent[] = [];
    const subscription = application.runtime.subscribeRuntimeEvents({}, (event) => { runtimeEvents.push(event); });
    const startedAtMs = Date.now();
    try {
      const submitted = await application.runtime.host.session.sendUserInput({
        projectId: opened.project.projectId,
        text: 'Complete the task.',
        modelSelection: { provider_id: 'test', model_id: 'model' },
        permissionMode: 'full_access',
      });
      if (submitted.payload.type !== 'agent_run') throw new Error('Test Run did not start.');
      const completion = await waitForCommittedRun({
        runtime: application.runtime,
        sessionId: submitted.payload.session.id,
        executionId: submitted.payload.run.executionId,
        timeoutMs: 2_000,
      });
      const evidence = await collectEvidence({
        evidenceId: 'evidence:test',
        task,
        runtime: application.runtime,
        execution: {
          input: { apiKey: 'must-not-survive' }, beforeFacts: {}, completion, afterFacts: {},
          correlations: [{
            executionId: submitted.payload.run.executionId,
            sessionId: submitted.payload.session.id,
            messageId: submitted.payload.userMessageId,
          }],
          runtimeEvents,
        },
        environment: { profile: 'controlled' },
        startedAtMs,
        collectedAt: '2026-01-01T00:00:01.000Z',
      });
      expect(evidence.measurements).toMatchObject({ inputTokens: 10, outputTokens: 5, modelCalls: 1 });
      expect(evidence.traces).toHaveLength(1);
      expect(evidence.input.apiKey).toBe('[REDACTED]');
      expect(JSON.stringify(evidence)).not.toContain('must-not-survive');
    } finally {
      subscription.unsubscribe();
    }
  });
});

function conversationTask() {
  return EvaluationTaskSchema.parse({
    taskId: 'conversation.evidence', revision: 1, title: 'Evidence', objective: 'Collect Evidence.',
    difficulty: 'simple', profiles: ['controlled'], tags: [], runner: 'conversation',
    scenario: {
      clock: '2026-01-01T00:00:00.000Z', workspace: { files: [] }, sessions: [], interests: [],
      candidates: [], recommendations: [], preferences: [], controlledSearch: [], permissionDecision: 'allow',
    },
    steps: [{ userInput: 'Complete the task.', permissionMode: 'full_access' }],
    completion: { kind: 'conversation_steps_terminal', timeoutMs: 2_000 },
    metrics: [{ metricId: 'trace', title: 'Trace', evaluator: 'rule', rule: 'trace_correlated', required: true }],
  });
}
