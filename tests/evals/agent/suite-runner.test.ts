/* Verifies one Suite uses the same Runner across cases and emits comparable reports. */
// @vitest-environment node
import type { RuntimeEvent } from '@megumi/product/runtime-events';
import { describe, expect, it, vi } from 'vitest';
import { runEvaluationSuite } from '../../../evals/agent/runner/evaluation-suite-runner';
import type { EvaluationProductRuntime } from '../../../evals/agent/runner/evaluation-runner';

describe('runEvaluationSuite', () => {
  it('runs explicit manifest members and assigns a complete fingerprint', async () => {
    const result = await runEvaluationSuite({
      catalog: {
        cases: [{
          schemaVersion: 1, caseId: 'reply', name: 'Reply', description: 'Reply.', tags: ['smoke'],
          request: { text: 'Reply.' },
          graders: [{ graderId: 'reply', type: 'final_reply', required: true }],
        }],
        suites: [{
          schemaVersion: 1, suiteId: 'smoke', name: 'Smoke', description: 'Smoke.', caseIds: ['reply'],
          executionProfileId: 'controlled',
          policy: { repetitions: 1, requiredCaseIds: ['reply'], minimumPassRate: 1, maximumInvalidExecutionRate: 0, needsReview: 'blocks' },
        }],
        targets: [{ targetId: 'test', name: 'Test', providerId: 'test', modelId: 'model' }],
        profiles: [{
          profileId: 'controlled', name: 'Controlled', environmentKind: 'controlled', permissionMode: 'ask',
          enabledTools: [], networkAccess: 'disabled', isolation: 'workspace_only', limits: { wallClockMs: 2_000 },
        }],
      },
      suiteId: 'smoke',
      targetId: 'test',
      profileId: 'controlled',
      evaluationRoot: process.cwd(),
      repositoryRoot: process.cwd(),
      runtimeFactory: { create: async () => runtime() },
      availableIsolation: ['workspace_only'],
      sourceStateProvider: async () => ({ sourceRevision: 'abc123', sourceDirty: false }),
    });

    expect(result.verdict).toBe('passed');
    expect(result.executionReports).toHaveLength(1);
    expect(result.executionReports[0]?.execution.fingerprint).toMatchObject({
      sourceRevision: 'abc123',
      caseDigest: expect.any(String),
      relevantSettingsDigest: expect.any(String),
      toolCatalogDigest: expect.any(String),
      skillCatalogDigest: expect.any(String),
    });
  });

  it('rejects a profile that does not match the Suite manifest', async () => {
    await expect(runEvaluationSuite({
      catalog: { cases: [], suites: [], targets: [], profiles: [] },
      suiteId: 'missing', targetId: 'missing', profileId: 'other', evaluationRoot: process.cwd(), repositoryRoot: process.cwd(),
      runtimeFactory: { create: async () => runtime() }, availableIsolation: ['workspace_only'],
    })).rejects.toThrow(/Suite/);
  });

  it('does not allow a case filter to omit a required Suite member', async () => {
    const catalog = {
      cases: [
        { schemaVersion: 1 as const, caseId: 'required', name: 'Required', description: 'Required.', tags: ['safety'], request: { text: 'Required.' }, graders: [{ graderId: 'required', type: 'final_reply' as const, required: true }] },
        { schemaVersion: 1 as const, caseId: 'optional', name: 'Optional', description: 'Optional.', tags: ['smoke'], request: { text: 'Optional.' }, graders: [{ graderId: 'optional', type: 'final_reply' as const, required: true }] },
      ],
      suites: [{
        schemaVersion: 1 as const, suiteId: 'guarded', name: 'Guarded', description: 'Guarded.', caseIds: ['required', 'optional'],
        executionProfileId: 'controlled', policy: { repetitions: 1, requiredCaseIds: ['required'], minimumPassRate: 1, maximumInvalidExecutionRate: 0, needsReview: 'blocks' as const },
      }],
      targets: [{ targetId: 'test', name: 'Test', providerId: 'test', modelId: 'model' }],
      profiles: [{ profileId: 'controlled', name: 'Controlled', environmentKind: 'controlled' as const, permissionMode: 'ask' as const, enabledTools: [], networkAccess: 'disabled' as const, isolation: 'workspace_only' as const, limits: { wallClockMs: 2_000 } }],
    };
    await expect(runEvaluationSuite({
      catalog, suiteId: 'guarded', targetId: 'test', profileId: 'controlled',
      evaluationRoot: process.cwd(), repositoryRoot: process.cwd(), caseIds: ['optional'],
      runtimeFactory: { create: async () => runtime() }, availableIsolation: ['workspace_only'],
    })).rejects.toThrow(/required/i);
  });
});

function runtime(): EvaluationProductRuntime {
  return {
    host: {
      workspace: { useExistingProject: vi.fn().mockResolvedValue({ status: 'opened', project: { projectId: 'workspace' } }) },
      chat: {
        createSession: vi.fn().mockResolvedValue({ status: 'created', session: { id: 'session' } }),
        sendUserInput: vi.fn().mockResolvedValue({
          payload: { type: 'agent_run', run: { runId: 'run' } }, events: stream([event('run.started'), event('run.completed')]),
        }),
        cancelUserInput: vi.fn(),
        listMessages: vi.fn().mockResolvedValue({ status: 'ok', messages: [{ role: 'assistant', text: 'OK' }] }),
        listTimeline: vi.fn().mockResolvedValue({ messages: [] }),
      },
      approval: { resolve: vi.fn() },
      settings: { get: vi.fn().mockResolvedValue({ status: 'ok', settings: { permissions: { catalog: { tools: [] } } } }) },
      skill: { listSkills: vi.fn().mockResolvedValue({ status: 'ok', skills: [] }) },
      observability: { getRunTrace: vi.fn().mockResolvedValue({ status: 'not_found' }) },
    },
    observability: { flush: vi.fn().mockResolvedValue(undefined) },
    dispose: vi.fn(),
  };
}

function event(eventType: string): RuntimeEvent {
  return {
    eventId: eventType, schemaVersion: 1, eventType, runId: 'run', sessionId: 'session', sequence: 1,
    createdAt: new Date().toISOString(), source: 'core', visibility: 'system', persist: 'transient', payload: {},
  } as RuntimeEvent;
}

async function* stream(events: RuntimeEvent[]): AsyncIterable<RuntimeEvent> { yield* events; }
