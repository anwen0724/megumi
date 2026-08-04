/*
 * Verifies the stable Engine contract shapes and policy validation boundary.
 */
import { describe, expect, it } from 'vitest';
import type {
  CancelRunResult,
  CreateEngineOptions,
  Engine,
  EnginePolicy,
  ResumeRunResult,
  RunApprovalStatus,
  StartRunRequest,
  StartRunResult,
} from '@megumi/engine';
import { validateEnginePolicy } from '../../../packages/engine/src/engine-policy';

const validPolicy: EnginePolicy = {
  maxModelCallsPerRun: 8,
  maxToolRoundsPerRun: 6,
  maxToolCallsPerModelCall: 8,
  maxToolCallsPerRun: 24,
  maxConcurrentToolExecutions: 4,
  modelCallTimeoutMs: 60_000,
  modelCallTerminationTimeoutMs: 10_000,
  toolExecutionTimeoutMs: 30_000,
  cancellationTimeoutMs: 5_000,
  maxModelCallAttempts: 2,
  modelRetryDelayMs: 250,
  maxToolExecutionsPerCall: 1,
  terminalRunRetentionMs: 60_000,
};

describe('engine public contracts', () => {
  it('uses the confirmed public operation and result names', () => {
    const operationNames: (keyof Engine)[] = ['startRun', 'resumeRun', 'cancelRun', 'getRun', 'shutdown'];
    const startStatuses: StartRunResult['status'][] = [
      'started',
      'already_started',
      'session_busy',
      'failed',
    ];
    const resumeStatuses: ResumeRunResult['status'][] = [
      'resumed',
      'not_found',
      'not_waiting',
      'already_resolved',
      'failed',
    ];
    const cancelStatuses: CancelRunResult['status'][] = [
      'cancellation_requested',
      'already_cancelling',
      'already_terminal',
      'not_found',
    ];
    const approvalStatuses: RunApprovalStatus[] = [
      'pending',
      'approved',
      'denied',
      'cancelled',
    ];
    const dependencyNames: (keyof CreateEngineOptions)[] = [
      'models',
      'context',
      'session',
      'tools',
      'permissions',
      'events',
      'observability',
      'ids',
      'clock',
      'policy',
    ];

    expect(operationNames).toEqual(['startRun', 'resumeRun', 'cancelRun', 'getRun', 'shutdown']);
    expect(startStatuses).not.toContain('completed');
    expect(resumeStatuses).toContain('already_resolved');
    expect(cancelStatuses).not.toContain('cancelled');
    expect(dependencyNames).toContain('models');
    expect(dependencyNames).not.toContain('settings');
  });

  it('accepts only the normalized UserInput contract', () => {
    const request = {
      requestId: 'request:1',
      workspaceId: 'workspace:1',
      sessionId: 'session:1',
      input: {
        displayContent: [{ type: 'text', text: 'hello' }],
        modelContent: [{ type: 'text', text: 'hello' }],
        attachments: [],
      },
      model: {} as StartRunRequest['model'],
      permissionMode: 'ask',
    } satisfies StartRunRequest;

    expect(request.input).toEqual({
      displayContent: [{ type: 'text', text: 'hello' }],
      modelContent: [{ type: 'text', text: 'hello' }],
      attachments: [],
    });
    expect(request.sessionId).toBe('session:1');
    expect('providerConfig' in request).toBe(false);
  });
});

describe('engine policy validation', () => {
  it('accepts a fully resolved policy', () => {
    expect(validateEnginePolicy(validPolicy)).toEqual(validPolicy);
  });

  it.each([
    ['maxModelCallsPerRun', 0],
    ['maxConcurrentToolExecutions', 1.5],
    ['modelCallTimeoutMs', -1],
    ['modelCallTerminationTimeoutMs', 0],
    ['modelRetryDelayMs', -1],
    ['terminalRunRetentionMs', 0],
  ] as const)('rejects invalid %s', (field, value) => {
    expect(() => validateEnginePolicy({ ...validPolicy, [field]: value })).toThrow(
      `Invalid EnginePolicy.${field}`,
    );
  });
});
