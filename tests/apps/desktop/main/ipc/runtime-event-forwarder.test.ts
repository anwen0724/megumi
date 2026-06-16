// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@megumi/shared/ipc';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import { createToolRegistrySnapshot } from '@megumi/tools/registry';
import {
  createBuiltInToolRegistrations,
  createExternalTestToolRegistrations,
} from '@megumi/tools/sources';
import { forwardRuntimeEvents } from '@megumi/desktop/main/ipc/runtime-event-forwarder';

const runtimeContext = {
  requestId: 'ipc-chat-start-1',
  traceId: 'trace-forward-1',
  debugId: 'debug-forward-1',
  operationName: 'session.message.send',
  source: 'main',
  createdAt: '2026-05-12T00:00:00.000Z',
} as const;

async function* stream(events: unknown[]): AsyncIterable<RuntimeEvent> {
  for (const event of events) {
    yield event as RuntimeEvent;
  }
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('forwardRuntimeEvents', () => {
  it('validates and forwards runtime events with context unchanged', async () => {
    const sender = { send: vi.fn() };
    const logger = createLogger();
    const event: RuntimeEvent = {
      eventId: 'event-1',
      schemaVersion: 1,
      eventType: 'run.started',
      requestId: 'ipc-chat-start-1',
      context: runtimeContext,
      runId: 'run-1',
      sequence: 1,
      createdAt: '2026-05-12T00:00:01.000Z',
      source: 'core',
      visibility: 'system',
      persist: 'required',
      payload: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        runKind: 'chat',
      },
    };

    await forwardRuntimeEvents(sender, stream([event]), { logger });

    expect(sender.send).toHaveBeenCalledWith(IPC_CHANNELS.runtime.event, event);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('forwards approval events that carry registry snapshot identity', async () => {
    const sender = { send: vi.fn() };
    const logger = createLogger();
    const snapshot = createToolRegistrySnapshot({
      runId: 'run:550e8400-e29b-41d4-a716-446655440000:project-C-Users-anwen-Desktop-test',
      projectId: 'project-1',
      permissionMode: 'default',
      modelId: 'deepseek-v4-flash',
      createdAt: '2026-05-12T00:00:00.000Z',
      sources: [{
        sourceId: 'built_in',
        sourceKind: 'built_in',
        namespace: 'megumi',
        displayName: 'Built-in tools',
        configured: true,
        enabled: true,
        availabilityStatus: 'available',
        config: {},
        createdAt: '2026-05-12T00:00:00.000Z',
        updatedAt: '2026-05-12T00:00:00.000Z',
      }, {
        sourceId: 'external_test',
        sourceKind: 'external_test',
        namespace: 'demo',
        displayName: 'Demo tools',
        configured: true,
        enabled: false,
        availabilityStatus: 'available',
        config: {},
        createdAt: '2026-05-12T00:00:00.000Z',
        updatedAt: '2026-05-12T00:00:00.000Z',
      }],
      registrations: [
        ...createBuiltInToolRegistrations(),
        ...createExternalTestToolRegistrations(),
      ],
      providerCapabilitySummary: { supportsToolCall: true },
    });
    const writeFileEntry = snapshot.entries.find((entry) => entry.sourceToolName === 'write_file');
    if (!writeFileEntry) {
      throw new Error('Expected write_file snapshot entry.');
    }
    const event: RuntimeEvent = {
      eventId: 'event-approval-1',
      schemaVersion: 1,
      eventType: 'approval.requested',
      requestId: 'ipc-chat-start-1',
      context: runtimeContext,
      runId: snapshot.runId,
      stepId: 'step-1',
      sequence: 1,
      createdAt: '2026-05-12T00:00:01.000Z',
      source: 'approval',
      visibility: 'system',
      persist: 'required',
      payload: {
        approvalRequest: {
          approvalRequestId: 'approval-1',
          toolCallId: 'tool-call-1',
          toolExecutionId: 'tool-execution-1',
          permissionDecisionId: 'permission-decision-1',
          runId: snapshot.runId,
          stepId: 'step-1',
          toolName: 'write_file',
          registrySnapshotId: snapshot.snapshotId,
          snapshotEntryId: writeFileEntry.snapshotEntryId,
          modelVisibleName: writeFileEntry.modelVisibleName,
          canonicalToolId: writeFileEntry.canonicalToolId,
          sourceId: writeFileEntry.sourceId,
          namespace: writeFileEntry.namespace,
          sourceToolName: writeFileEntry.sourceToolName,
          capabilities: ['project_write'],
          riskLevel: 'medium',
          title: 'Approve write_file',
          summary: 'Write file',
          preview: {
            action: 'Write file',
            targets: [{ kind: 'file', label: 'draft.md', sensitivity: 'normal' }],
          },
          requestedScope: 'once',
          status: 'pending',
          createdAt: '2026-05-12T00:00:01.000Z',
        },
      },
    };

    await forwardRuntimeEvents(sender, stream([event]), { logger });

    expect(writeFileEntry.snapshotEntryId.length).toBeLessThanOrEqual(128);
    expect(sender.send).toHaveBeenCalledWith(IPC_CHANNELS.runtime.event, event);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('drops invalid runtime events and logs redacted diagnostics', async () => {
    const sender = { send: vi.fn() };
    const logger = createLogger();
    const obsoleteRuntimeErrorField = ['recover', 'able'].join('');
    const invalidEvent = {
      eventId: 'event-invalid',
      schemaVersion: 1,
      eventType: 'run.failed',
      requestId: 'ipc-chat-start-1',
      context: runtimeContext,
      runId: 'run-1',
      sequence: 1,
      createdAt: '2026-05-12T00:00:01.000Z',
      source: 'provider',
      visibility: 'user',
      persist: 'required',
      payload: {
        error: {
          code: 'provider_auth_failed',
          message: 'Authorization: Bearer sk-raw-secret',
          severity: 'error',
          retryable: false,
          source: 'provider',
          [obsoleteRuntimeErrorField]: false,
        },
      },
    };

    await forwardRuntimeEvents(sender, stream([invalidEvent]), { logger });

    expect(sender.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'runtime_event_invalid',
      expect.objectContaining({
        eventType: 'run.failed',
        requestId: 'ipc-chat-start-1',
        traceId: 'trace-forward-1',
        debugId: 'debug-forward-1',
        issueCount: 1,
        issues: [
          expect.objectContaining({
            path: 'payload.error',
            message: expect.any(String),
          }),
        ],
      }),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('sk-raw-secret');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(obsoleteRuntimeErrorField);
  });

  it('logs send failures without exposing raw event payload', async () => {
    const sender = {
      send: vi.fn(() => {
        throw new Error('send failed with sk-send-secret');
      }),
    };
    const logger = createLogger();
    const event: RuntimeEvent = {
      eventId: 'event-1',
      schemaVersion: 1,
      eventType: 'assistant.output.delta',
      requestId: 'ipc-chat-start-1',
      context: runtimeContext,
      runId: 'run-1',
      sequence: 2,
      createdAt: '2026-05-12T00:00:02.000Z',
      source: 'provider',
      visibility: 'user',
      persist: 'transient',
      payload: {
        delta: 'Hello',
      },
    };

    await forwardRuntimeEvents(sender, stream([event]), { logger });

    expect(logger.error).toHaveBeenCalledWith(
      'runtime_event_send_failed',
      expect.objectContaining({
        eventId: 'event-1',
        eventType: 'assistant.output.delta',
        requestId: 'ipc-chat-start-1',
        traceId: 'trace-forward-1',
        debugId: 'debug-forward-1',
        message: 'Runtime event delivery failed.',
      }),
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('sk-send-secret');
  });
});

