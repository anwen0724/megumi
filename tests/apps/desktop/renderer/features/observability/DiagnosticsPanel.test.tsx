/* Verifies the Trace-native diagnostics console and explicit lazy Content read. */
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticsPanel } from '@megumi/desktop/renderer/features/observability';

describe('DiagnosticsPanel', () => {
  const list = vi.fn();
  const get = vi.fn();
  const getContent = vi.fn();
  const getHealth = vi.fn();
  const rebuildIndex = vi.fn();
  const createBundle = vi.fn();

  beforeEach(() => {
    list.mockReset().mockResolvedValue(success({ status: 'ok', traces: [summary] }));
    get.mockReset().mockResolvedValue(success({ status: 'found', trace: detail }));
    getContent.mockReset().mockResolvedValue(success({
      status: 'available',
      content: {
        encoding: 'text', contentId: 'a'.repeat(64), mediaType: 'text/plain;charset=utf-8',
        byteLength: 13, text: 'actual prompt',
      },
    }));
    getHealth.mockReset().mockResolvedValue(success({
      status: 'ok',
      health: {
        droppedRecords: 0,
        recordsDroppedByType: { content: 0, event: 0, lifecycle: 0, runtime: 0 },
        contentBytesDropped: 0, writerQueueHighWaterBytes: 0, journalWriteFailures: 0,
        contentWriteFailures: 0, flushFailures: 0, rotationFailures: 0,
        retentionCleanupFailures: 0, indexProjectionFailures: 0, classifierFailures: 0,
        contextFailures: 0, captureFailures: 0,
      },
    }));
    rebuildIndex.mockReset();
    createBundle.mockReset();
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        observability: {
          list, get, getContent, getHealth, rebuildIndex, createBundle,
        },
      },
    });
  });

  it('reads Trace facts without joining Project, Session, or message business state', async () => {
    const user = userEvent.setup();
    render(<DiagnosticsPanel />);

    expect(await screen.findByText('trace:conversation:1')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ payload: { limit: 50 } }));
    await user.click(screen.getByRole('button', { name: /trace:conversation:1/i }));

    expect((await screen.findAllByText('model.call')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('model.output.started')).toBeInTheDocument();
    expect(screen.getAllByText('prompt.final')).toHaveLength(2);
    expect(screen.queryByText('actual prompt')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View content' }));
    expect(await screen.findByText('actual prompt')).toBeInTheDocument();
    expect(getContent).toHaveBeenCalledWith(expect.objectContaining({
      payload: { traceId: 'trace:conversation:1', sequence: 4 },
    }));
  });

  it('sends fixed Trace filters to the Reader instead of filtering through business data', async () => {
    const user = userEvent.setup();
    render(<DiagnosticsPanel />);
    await screen.findByText('trace:conversation:1');

    await user.selectOptions(screen.getByLabelText('Trace kind'), 'daily_discovery');
    await user.selectOptions(screen.getByLabelText('Status'), 'error');
    await user.type(screen.getByLabelText('Correlation'), 'batch:42');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({
      payload: {
        traceKind: 'daily_discovery',
        status: 'error',
        correlation: { batchId: 'batch:42' },
        limit: 50,
      },
    })));
  });
});

function success<T extends object>(data: T) {
  return { ok: true as const, data, meta: {} };
}

const summary = {
  traceId: 'trace:conversation:1', traceKind: 'conversation' as const,
  status: 'ok' as const, diagnostics: 'complete' as const,
  correlation: { requestId: 'request:1', executionId: 'execution:1', sessionId: 'session:1' },
  startedAt: '2026-08-26T00:00:00.000Z', endedAt: '2026-08-26T00:00:01.000Z',
  durationMs: 1_000, spanCount: 1, eventCount: 1, contentCount: 1, issueCount: 0,
};

const detail = {
  summary,
  outcome: { status: 'ok' as const, code: 'completed' },
  spans: [{
    spanId: 'span:1', name: 'model.call', correlation: { modelCallId: 'model-call:1' },
    startedAt: '2026-08-26T00:00:00.100Z', endedAt: '2026-08-26T00:00:00.900Z',
    durationMs: 800, outcome: { status: 'ok' as const },
    events: [{
      sequence: 3, timestamp: '2026-08-26T00:00:00.200Z',
      type: 'model.output.started', detail: { providerAttempt: 1 },
    }],
  }],
  contents: [{
    sequence: 4, timestamp: '2026-08-26T00:00:00.300Z', spanId: 'span:1',
    kind: 'prompt.final', mode: 'inline' as const, contentId: 'a'.repeat(64),
    mediaType: 'text/plain;charset=utf-8', byteLength: 13, correlation: { executionId: 'execution:1' },
  }],
  links: [], issues: [], sourceFiles: ['trace.jsonl'],
};
