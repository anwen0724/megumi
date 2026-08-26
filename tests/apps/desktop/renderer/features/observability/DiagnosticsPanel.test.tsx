/* Verifies the human-readable Trace diagnostics workbench and lazy Content interaction. */
// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
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
  const listSessions = vi.fn();
  const listMessages = vi.fn();

  beforeEach(() => {
    list.mockReset().mockResolvedValue(success({ status: 'ok', traces: [summary, dailySummary] }));
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
    listSessions.mockReset().mockResolvedValue(success({
      status: 'ok',
      sessions: [{
        id: 'session:1', projectId: 'project:1', title: 'Sleep chat', status: 'active',
        createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:01.000Z',
      }],
    }));
    listMessages.mockReset().mockResolvedValue(success({
      status: 'ok',
      messages: [{
        id: 'message:1', sessionId: 'session:1', executionId: 'execution:1', role: 'user',
        text: "I'm going to sleep", createdAt: '2026-08-26T00:00:00.000Z',
      }],
    }));
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        observability: { list, get, getContent, getHealth, rebuildIndex, createBundle },
        session: { list: listSessions, message: { list: listMessages } },
      },
    });
  });

  it('groups conversation Traces by Session and explains execution separately from diagnostics', async () => {
    const user = userEvent.setup();
    render(<DiagnosticsPanel />);

    expect(await screen.findByText('Sleep chat')).toBeInTheDocument();
    expect(screen.getByText("I'm going to sleep")).toBeInTheDocument();
    expect(screen.getByText('Daily discovery · Aug 26')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ payload: { limit: 200 } }));
    expect(listSessions).toHaveBeenCalled();
    expect(listMessages).toHaveBeenCalledWith(expect.objectContaining({
      payload: { executionIds: ['execution:1', 'execution:2'] },
    }));

    await user.click(screen.getByRole('button', { name: /I'm going to sleep/i }));

    expect(await screen.findByText('Execution completed')).toBeInTheDocument();
    expect(screen.getByText('Diagnostics incomplete · 1')).toBeInTheDocument();
    expect(screen.getByText('Call model')).toBeInTheDocument();
    expect(screen.getByText('Final prompt')).toBeInTheDocument();
    expect(screen.getByText('2 fields were not captured')).toBeInTheDocument();
    expect(screen.getByText('/prompt_cache_key')).toBeInTheDocument();
    expect(screen.queryByText('actual prompt')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'View full content' }));
    expect(await screen.findByText('actual prompt')).toBeInTheDocument();
    expect(getContent).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Collapse content' }));
    expect(screen.queryByText('actual prompt')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View full content' }));
    expect(await screen.findByText('actual prompt')).toBeInTheDocument();
    expect(getContent).toHaveBeenCalledTimes(1);
  });

  it('applies human filters immediately through styled controls', async () => {
    const user = userEvent.setup();
    render(<DiagnosticsPanel />);
    await screen.findByText("I'm going to sleep");

    await user.click(screen.getByRole('combobox', { name: 'Session' }));
    await user.click(screen.getByRole('option', { name: 'Sleep chat' }));
    await user.click(screen.getByRole('combobox', { name: 'Trace type' }));
    await user.click(screen.getByRole('option', { name: 'Daily discovery' }));

    expect(screen.queryByText("I'm going to sleep")).not.toBeInTheDocument();
    const dailyGroup = screen.getByText('Daily discovery · Aug 26').closest('section');
    expect(dailyGroup).not.toBeNull();
    expect(within(dailyGroup!).getByText('Scheduled discovery')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Execution result' }));
    await user.click(screen.getByRole('option', { name: 'Failed' }));
    expect(screen.getByText('Scheduled discovery')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Only traces with diagnostic issues' }));
    await waitFor(() => expect(screen.queryByText('Scheduled discovery')).not.toBeInTheDocument());
    expect(screen.getByText('No traces match the current filters.')).toBeInTheDocument();
  });

  it('can collapse a Content checkpoint while its body is still loading', async () => {
    getContent.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    render(<DiagnosticsPanel />);

    await user.click(await screen.findByRole('button', { name: /I'm going to sleep/i }));
    await user.click(await screen.findByRole('button', { name: 'View full content' }));

    const collapse = await screen.findByRole('button', { name: 'Collapse content' });
    expect(collapse).toBeEnabled();
    await user.click(collapse);
    expect(screen.getByRole('button', { name: 'View full content' })).toBeInTheDocument();
  });
});

function success<T extends object>(data: T) {
  return { ok: true as const, data, meta: {} };
}

const summary = {
  traceId: 'trace:conversation:1', traceKind: 'conversation' as const,
  status: 'ok' as const, diagnostics: 'incomplete' as const,
  correlation: { requestId: 'request:1', executionId: 'execution:1', sessionId: 'session:1' },
  startedAt: '2026-08-26T00:00:00.000Z', endedAt: '2026-08-26T00:00:01.000Z',
  durationMs: 1_000, spanCount: 1, eventCount: 1, contentCount: 1, issueCount: 1,
};

const dailySummary = {
  traceId: 'trace:daily:1', traceKind: 'daily_discovery' as const,
  status: 'error' as const, diagnostics: 'complete' as const,
  correlation: { executionId: 'execution:2', batchId: 'batch:1' },
  startedAt: '2026-08-26T07:30:00.000Z', endedAt: '2026-08-26T07:30:42.000Z',
  durationMs: 42_000, spanCount: 2, eventCount: 0, contentCount: 1, issueCount: 0,
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
  links: [],
  issues: [{
    code: 'partial_content_capture', sequence: 4, contentKind: 'model.provider_request',
    captureIssues: [
      { path: '/prompt_cache_key', kind: 'unavailable' as const, reason: 'unsupported_value' },
      { path: '/prompt_cache_retention', kind: 'unavailable' as const, reason: 'unsupported_value' },
    ],
  }],
  sourceFiles: ['trace.jsonl'],
};
