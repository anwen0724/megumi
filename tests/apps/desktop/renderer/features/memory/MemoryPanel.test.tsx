// @vitest-environment jsdom
/* Exercises memory management at its IPC boundary with persistent user drafts. */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryPanel } from '@megumi/desktop/renderer/features/memory/MemoryPanel';
import type { MemoryChanged } from '@megumi/application/contracts';

function fixture() {
  let version = 'v1';
  let content = '# User Profile\nA useful memory\n';
  let changed: ((event: MemoryChanged) => void) | undefined;
  const ok = (data: unknown) => Promise.resolve({ ok: true, data });
  const api = {
    getStatus: vi.fn(() => ok({ status: 'ok', memory: { generateMemories: true, useMemories: true, extractModel: { status: 'unconfigured' }, consolidationModel: { status: 'unconfigured' }, artifactState: 'ready', dirty: false, dirtyRevision: 1, processedRevision: 1, sourceCount: 1, recentRuns: [] } })),
    listDocuments: vi.fn(() => ok({ status: 'ok', documents: [{ path: 'memory_summary.md', version, readOnly: false }] })),
    listSources: vi.fn(() => ok({ status: 'ok', sources: [] })),
    onChanged: vi.fn((listener: typeof changed) => { changed = listener; return () => { changed = undefined; }; }),
    readDocument: vi.fn(() => ok({ status: 'found', document: { path: 'memory_summary.md', version, content, startLine: 1, nextLine: 3, truncated: false } })),
    updateDocument: vi.fn(({ payload }: { payload: { content: string; expectedVersion: string } }) => {
      if (payload.expectedVersion !== version) return Promise.resolve({ ok: false, data: { code: 'VERSION_CONFLICT', message: 'changed' } });
      content = payload.content; version = 'v3';
      return ok({ status: 'saved', document: { path: 'memory_summary.md', version, content, readOnly: false } });
    }),
    clearMemory: vi.fn(() => ok({ status: 'started', runId: 'clear' })),
    startGeneration: vi.fn(() => ok({ status: 'started', runId: 'run' })),
  };
  Object.defineProperty(window, 'megumi', { configurable: true, value: { memory: api } });
  return { api, changeFile: () => { version = 'v2'; content = '# User Profile\nExternal change\n'; }, changed: (sequence: number) => changed?.({ processInstanceId: 'p1', sequence, revision: sequence }) };
}

describe('MemoryPanel', () => {
  it('reads paged source messages as conversation text instead of JSON or thinking blocks', async () => {
    const f = fixture();
    f.api.listSources.mockResolvedValue({ ok: true, data: { status: 'ok', sources: [{ sessionId: 's1', title: 'Project setup', workspaceId: 'w1', contentUpdatedAt: '', sourceRef: 'ref', eligibility: 'eligible', version: 0, usageCount: 0, selected: true }] } });
    const text = JSON.stringify([{ type: 'thinking', thinking: 'Internal reasoning' }, { type: 'text', text: 'Use pnpm.' }]);
    Object.assign(f.api, { readSource: vi.fn(({ payload }: { payload: { cursor?: string } }) => Promise.resolve({ ok: true, data: {
      status: 'found', sessionId: 's1', workspaceId: 'w1', sourceVersion: 'version', sourceChanged: false,
      messages: [{ messageId: 'm1', kind: 'assistant_reply', text: payload.cursor ? text.slice(30) : text.slice(0, 30), characterOffset: payload.cursor ? 30 : 0, truncated: !payload.cursor }],
      ...(!payload.cursor ? { nextCursor: 'page2' } : {}),
    } })) });
    render(<MemoryPanel onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage sources' }));
    fireEvent.click(await screen.findByRole('button', { name: 'View evidence' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Use pnpm.')).toBeInTheDocument();
    expect(screen.getByText('Assistant')).toBeInTheDocument();
    expect(screen.queryByText(/Internal reasoning/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"type"/)).not.toBeInTheDocument();
  });
  it('opens remembered content without file categories and preserves the full document when editing', async () => {
    const f = fixture();
    const content = '# Task Group: Project conventions\nscope: this project\n## Task: Package manager\n### rollout_summary_files\n- rollout_summaries/abc.md [sourceId=s1; sourceVersion=v1; sourceRef=ref1]\n### keywords\npnpm\n### learnings\nUse pnpm for this project.\n';
    f.api.listDocuments.mockResolvedValue({ ok: true, data: { status: 'ok', documents: [
      { path: 'MEMORY.md', version: 'v1', readOnly: false },
      { path: 'memory_summary.md', version: 'v1', readOnly: false },
    ] } });
    f.api.readDocument.mockResolvedValue({ ok: true, data: { status: 'found', document: {
      path: 'MEMORY.md', version: 'v1', content, startLine: 1, nextLine: 10, truncated: false,
    } } });
    render(<MemoryPanel onClose={vi.fn()} />);
    expect(await screen.findByText('Use pnpm for this project.')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByText('MEMORY.md')).not.toBeInTheDocument();
    expect(screen.queryByText(/sourceId=/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit memory' }));
    expect(await screen.findByRole('textbox', { name: 'Draft' })).toHaveValue(content);
  });
  it('separates a historical failure from current status and does not label zero jobs as zero sources', async () => {
    const f = fixture();
    f.api.getStatus.mockResolvedValue({ ok: true, data: { status: 'ok', memory: {
      generateMemories: false, useMemories: false, extractModel: { status: 'unconfigured' }, consolidationModel: { status: 'unconfigured' },
      artifactState: 'empty', dirty: false, dirtyRevision: 0, processedRevision: 0, sourceCount: 3,
      recentRuns: [{ runId: 'old', kind: 'startup', status: 'failed', createdAt: '2026-10-08T00:00:00Z', jobs: [], result: { error: { code: 'MODEL_UNAVAILABLE', message: 'The extraction model is unavailable.' } } }],
    } } });
    render(<MemoryPanel onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run details' }));
    expect(await screen.findByText('No task is running')).toBeInTheDocument();
    const history = screen.getByText('Recent runs').closest('details');
    expect(history).not.toHaveAttribute('open');
    expect(screen.queryByText(/\/ 0 sources/)).not.toBeInTheDocument();
  });
  it('assembles paged text without inserting blank lines before editing', async () => {
    const f = fixture();
    f.api.readDocument.mockImplementation((...args: unknown[]) => {
      const input = args[0] as { payload: { startLine?: number } };
      const second = input.payload.startLine === 3;
      return Promise.resolve({ ok: true, data: { status: 'found', document: {
        path: 'memory_summary.md', version: 'v1', content: second ? 'Third line\n' : 'First line\nSecond line\n',
        startLine: second ? 3 : 1, nextLine: second ? 4 : 3, truncated: !second,
      } } });
    });
    render(<MemoryPanel onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit memory' }));
    expect(await screen.findByRole('textbox', { name: 'Draft' })).toHaveValue('First line\nSecond line\nThird line\n');
  });

  it.each([
    ['multiple lines', 'First line\n' + 'x'.repeat(17000) + '\nThird line\n', 2, 15989],
    ['one long line', 'x'.repeat(20000), 1, 16000],
  ] as const)('resumes a character-limited page within %s without dropping text', async (_name, content, nextLine, nextCharacter) => {
    const f = fixture();
    f.api.readDocument.mockImplementation((...args: unknown[]) => {
      const input = args[0] as { payload: { startCharacter?: number } };
      const second = input.payload.startCharacter === nextCharacter;
      return Promise.resolve({ ok: true, data: { status: 'found', document: {
        path: 'memory_summary.md', version: 'v1', content: second ? content.slice(16000) : content.slice(0, 16000),
        startLine: second ? nextLine : 1, nextLine, nextCharacter: second ? 0 : nextCharacter,
        truncated: !second, lastLineComplete: second,
      } } });
    });
    render(<MemoryPanel onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit memory' }));
    expect(await screen.findByRole('textbox', { name: 'Draft' })).toHaveValue(content);
  });

  it('preserves a conflicting draft while showing the latest file, then saves an explicit merge', async () => {
    const f = fixture();
    render(<MemoryPanel onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit memory' }));
    const draft = await screen.findByRole('textbox', { name: 'Draft' });
    fireEvent.change(draft, { target: { value: '# User Profile\nMy corrected memory\n' } });
    f.changeFile();
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your draft is preserved');
    expect(draft).toHaveValue('# User Profile\nMy corrected memory\n');
    fireEvent.click(screen.getByRole('button', { name: 'Read latest content' }));
    expect(await screen.findByText(/External change/)).toBeInTheDocument();
    expect(draft).toHaveValue('# User Profile\nMy corrected memory\n');
    fireEvent.click(screen.getByRole('button', { name: 'Keep merged draft with latest version' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Draft' })).not.toBeInTheDocument());
    expect(await screen.findByText(/My corrected memory/)).toBeInTheDocument();
  });

  it('never generates on open and requires scope confirmation before clearing', async () => {
    const f = fixture();
    render(<MemoryPanel onClose={vi.fn()} />);
    await screen.findByRole('button', { name: 'Edit memory' });
    expect(f.api.startGeneration).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Run details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear and disable automatic memory' }));
    expect(f.api.clearMemory).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Keep original sessions');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm clear and disable' }));
    await waitFor(() => expect(f.api.clearMemory).toHaveBeenCalledTimes(1));
  });

  it('allows retrying an interrupted clear after its failed run finishes', async () => {
    const f = fixture();
    f.api.getStatus.mockResolvedValue({ ok: true, data: { status: 'ok', memory: {
      generateMemories: false, useMemories: false, extractModel: { status: 'unconfigured' }, consolidationModel: { status: 'unconfigured' },
      artifactState: 'clearing', dirty: false, dirtyRevision: 1, processedRevision: 1, sourceCount: 0,
      recentRuns: [{ runId: 'failed-clear', kind: 'clear', status: 'failed', createdAt: '2026-10-08T00:00:00Z', jobs: [], result: { error: { code: 'STORAGE_FAILED', message: 'Disk unavailable' } } }],
    } } });
    render(<MemoryPanel onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run details' }));
    const clear = await screen.findByRole('button', { name: 'Clear and disable automatic memory' });
    expect(clear).not.toBeDisabled();
    fireEvent.click(clear);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm clear and disable' }));
    await waitFor(() => expect(f.api.clearMemory).toHaveBeenCalledTimes(1));
  });

  it('ignores duplicate and older notifications while refreshing newer state', async () => {
    const f = fixture();
    render(<MemoryPanel onClose={vi.fn()} />);
    await screen.findByRole('button', { name: 'Edit memory' });
    await act(async () => f.changed(3));
    const reads = f.api.getStatus.mock.calls.length;
    await act(async () => { f.changed(3); f.changed(2); });
    expect(f.api.getStatus).toHaveBeenCalledTimes(reads);
    await act(async () => f.changed(4));
    expect(f.api.getStatus).toHaveBeenCalledTimes(reads + 1);
  });
});
