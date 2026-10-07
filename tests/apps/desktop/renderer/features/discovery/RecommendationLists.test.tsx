/*
 * Verifies saved curated and favorite cards and explicit user actions through the preload boundary.
 */
// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiscoveryPage } from '@megumi/desktop/renderer/features/discovery';
import { initializeRendererI18n } from '@megumi/desktop/renderer/shared/i18n';
const card = { contentId: 'content-1', materialId: 'material-1', platform: 'web', title: '面试准备实录', url: 'https://example.com/interview', excerpt: '一种有实际步骤的准备方法', materialKind: 'excerpt', truncated: true, publicationPrecision: 'unknown', interestLabels: [{ interestId: 'interest-1', revision: 1, text: '求职', historical: false }], saved: false, reason: '给出可直接练习的具体方法', evidence: [{ materialId: 'material-1', quote: '准备方法' }] };
const swap = vi.fn();
const save = vi.fn();
const open = vi.fn();
beforeEach(async () => {
  await initializeRendererI18n('zh-CN');
  let saved = false;
  const listeners = new Set<(event: {
    kind: 'favorite';
  }) => void>();
  swap.mockReset().mockResolvedValue({ ok: true, data: { status: 'no_candidates' } });
  open.mockReset().mockResolvedValue({ ok: true, data: { status: 'accepted' } });
  save.mockReset().mockImplementation(async (request) => {
    saved = request.payload.saved;
    for (const listener of listeners)
      listener({ kind: 'favorite' });
    return { ok: true, data: { contentId: 'content-1', saved, changed: true } };
  });
  Object.defineProperty(window, 'megumi', {
    configurable: true, value: {
      recommendation: {
        listInterests: async () => ({ ok: true, data: { interests: [{ id: 'interest-1', text: '求职', enabled: true, revision: 1 }] } }),
        getConfiguration: async () => ({ ok: true, data: { revision: 'v1', config: { enabled: true }, sources: [] } }),
        listDailyFeed: async () => ({ ok: true, data: { date: '2026-10-07', items: [], batches: [], activeRuns: [] } }),
        getCuratedSelection: async () => ({ ok: true, data: { selection: { id: 'selection-1', createdAt: '2026-10-07T00:00:00Z', items: [{ ...card, saved }] }, needsUpdate: false, supplyStatus: [] } }),
        listFavorites: async () => ({ ok: true, data: { items: saved ? [{ ...card, saved: true }] : [] } }),
        startCuratedSelection: swap, setFavorite: save, openContent: open,
        onChanged: (callback: (event: {
          kind: 'favorite';
        }) => void) => { listeners.add(callback); return () => listeners.delete(callback); },
      }
    }
  });
});
it('lets the user cancel a running selection while keeping the saved cards', async () => {
  const cancel = vi.fn().mockResolvedValue({ ok: true, data: { status: 'cancelling' } });
  Object.assign(window.megumi.recommendation, {
    getCuratedSelection: vi.fn().mockResolvedValue({ ok: true, data: { selection: { id: 'selection-1', createdAt: '2026-10-07T00:00:00Z', items: [card] }, needsUpdate: true, activeRun: 'running-selection', supplyStatus: [] } }),
    getRun: vi.fn().mockResolvedValue({ ok: true, data: { id: 'running-selection', kind: 'curated', status: 'running', startedAt: '2026-10-07T00:00:00Z', finishedAt: null, issues: [] } }),
    cancelRun: cancel
  });
  render(<DiscoveryPage />);
  await screen.findByText('给出可直接练习的具体方法');
  await userEvent.click(await screen.findByRole('button', { name: '取消精选' }));
  expect(cancel.mock.calls[0]?.[0].payload).toEqual({ runId: 'running-selection' });
  expect(screen.getByText('面试准备实录')).toBeInTheDocument();
});
it('reads a saved selection without generating, and keeps it when a swap has no alternatives', async () => {
  render(<DiscoveryPage />);
  expect(await screen.findByText('给出可直接练习的具体方法')).toBeInTheDocument();
  expect(swap).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '换一批' }));
  expect(await screen.findByText('没有可替换的候选，已登记独立补充需求。')).toBeInTheDocument();
  expect(screen.getByText('面试准备实录')).toBeInTheDocument();
});
it('favorites the displayed material and opens only the saved content identity', async () => {
  render(<DiscoveryPage />);
  const title = await screen.findByText('面试准备实录');
  const article = title.closest('article');
  if (!article)
    throw new Error('Expected content card');
  await userEvent.click(within(article).getByRole('button', { name: '收藏' }));
  expect(save.mock.calls[0]![0].payload).toEqual({ contentId: 'content-1', materialId: 'material-1', saved: true });
  await userEvent.click(within(article).getByRole('button', { name: '打开原文' }));
  expect(open.mock.calls[0]![0].payload).toEqual({ contentId: 'content-1' });
  await userEvent.click(screen.getByRole('button', { name: '收藏' }));
  expect(await screen.findByRole('button', { name: '取消收藏' })).toBeInTheDocument();
  expect(screen.queryByText('给出可直接练习的具体方法')).not.toBeInTheDocument();
});
