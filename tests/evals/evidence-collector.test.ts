/* Verifies Evidence is collected from real Product facts and decoded Trace content. */
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import type { AnyEvent } from '@megumi/events';
import { loadEvaluationCatalog } from '../../evals/agent/catalog/evaluation-catalog';
import { collectEvidence, waitForCommittedRun } from '../../evals/agent/runtime/evidence';
import {
  composeTestApplication,
  type TestApplication,
} from '../packages/composition/compose-test-application';

let application: TestApplication | undefined;
afterEach(async () => { await application?.cleanup(); application = undefined; });

describe('Evaluation Evidence collector', () => {
  it('decodes captured JSON, measures model usage, and removes credentials', async () => {
    const catalog = await loadEvaluationCatalog('evals/agent');
    const evaluationCase = catalog.cases.get('conversation.contextual-answer');
    if (!evaluationCase) throw new Error('Expected checked-in Conversation Case.');
    application = composeTestApplication(['A contextual reply.']);
    await application.runtime.start();
    const opened = await application.runtime.host.workspace.useExistingProject();
    if (opened.status !== 'opened' || !opened.project) throw new Error('Test Workspace did not open.');
    const runtimeEvents: AnyEvent[] = [];
    const subscription = application.runtime.subscribeRuntimeEvents({}, (event) => { runtimeEvents.push(event); });
    const startedAtMs = Date.now();
    try {
      const submitted = await application.runtime.host.session.sendUserInput({
        projectId: opened.project.projectId,
        text: 'Use the existing context.',
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
        evaluationCase,
        runtime: application.runtime,
        execution: {
          input: { apiKey: 'must-not-survive' },
          beforeFacts: { sessionState: 'before' },
          completion,
          afterFacts: { sessionState: 'after' },
          correlation: {
            executionId: submitted.payload.run.executionId,
            sessionId: submitted.payload.session.id,
            messageId: submitted.payload.userMessageId,
          },
          runtimeEvents: runtimeEvents.filter((event) => event.executionId === submitted.payload.run.executionId),
        },
        environment: { profile: 'controlled' },
        startedAtMs,
        collectedAt: '2026-01-01T00:00:01.000Z',
      });

      expect(evidence.issues).toEqual([]);
      expect(evidence.measurements).toMatchObject({
        inputTokens: 10,
        outputTokens: 5,
        modelCalls: 1,
        estimatedCostUsd: 0.002,
      });
      expect(evidence.trace).not.toBeNull();
      expect(JSON.stringify(evidence)).not.toContain('must-not-survive');
      expect(evidence.input.apiKey).toBe('[REDACTED]');
    } finally {
      subscription.unsubscribe();
    }
  });

  it('marks a required missing Trace as not gradable', async () => {
    const catalog = await loadEvaluationCatalog('evals/agent');
    const evaluationCase = catalog.cases.get('conversation.contextual-answer');
    if (!evaluationCase) throw new Error('Expected checked-in Conversation Case.');
    application = composeTestApplication();
    await application.runtime.start();

    const evidence = await collectEvidence({
      evidenceId: 'evidence:missing-trace',
      evaluationCase,
      runtime: application.runtime,
      execution: {
        input: {}, beforeFacts: {}, completion: {}, afterFacts: {},
        correlation: { executionId: 'execution:missing' },
        runtimeEvents: [],
      },
      environment: { profile: 'controlled' },
      startedAtMs: Date.now(),
      collectedAt: '2026-01-01T00:00:01.000Z',
    });

    expect(evidence.issues).toContainEqual(expect.objectContaining({
      code: 'required_trace_missing', impact: 'not_gradable',
    }));
  });
});
