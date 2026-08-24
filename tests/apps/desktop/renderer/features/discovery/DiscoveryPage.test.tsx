// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiscoveryPage } from '@megumi/desktop/renderer/features/discovery';
import { initializeRendererI18n } from '@megumi/desktop/renderer/shared/i18n';

describe('DiscoveryPage', () => {
  const getHome = vi.fn();
  const searchRecommendations = vi.fn();
  const updateRecommendationState = vi.fn();
  const changeInterest = vi.fn();
  const ensureDaily = vi.fn();
  const configurationGet = vi.fn();
  const configurationUpdate = vi.fn();
  const beginPairing = vi.fn();
  const getBrowserConnection = vi.fn();
  const revokeBrowserConnection = vi.fn();

  beforeEach(async () => {
    await initializeRendererI18n('zh-CN');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    getHome.mockReset().mockResolvedValue(ok(homeView()));
    searchRecommendations.mockReset().mockResolvedValue(ok({
      query: 'Agent',
      recommendations: [recommendation({ recommendationId: 'recommendation:search', title: 'Agent 搜索结果' })],
    }));
    updateRecommendationState.mockReset().mockImplementation(async (request) => ok({
      ...recommendation(),
      favorite: request.payload.action === 'set_favorite' ? request.payload.favorite : false,
    }));
    changeInterest.mockReset().mockResolvedValue(ok({
      interestId: 'interest:2', description: '秋招信息', status: 'active', createdFrom: 'manual',
      userManagedAt: '2026-08-22T08:00:00.000Z', createdAt: '2026-08-22T08:00:00.000Z', updatedAt: '2026-08-22T08:00:00.000Z',
    }));
    ensureDaily.mockReset().mockResolvedValue(ok({ status: 'started', localDate: '2026-08-22', batchId: 'batch:2', executionId: 'execution:2' }));
    configurationGet.mockReset().mockResolvedValue(ok(discoveryConfiguration()));
    configurationUpdate.mockReset().mockImplementation(async (request) => ok(discoveryConfiguration({
      dailyTargetCount: request.payload.dailyTargetCount,
    })));
    beginPairing.mockReset().mockResolvedValue(ok({ code: '123456', port: 43127, expiresAt: '2026-08-22T08:05:00.000Z' }));
    getBrowserConnection.mockReset().mockResolvedValue(ok({ state: 'extension_offline', port: 43127 }));
    revokeBrowserConnection.mockReset().mockResolvedValue(ok({ state: 'not_configured' }));
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        discovery: {
          getHome, searchRecommendations, updateRecommendationState, changeInterest, ensureDaily,
          getConfiguration: configurationGet, updateConfiguration: configurationUpdate,
        },
        browserSource: {
          getConnection: getBrowserConnection,
          beginPairing,
          revokeConnection: revokeBrowserConnection,
        },
      },
    });
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('renders the default timeline as date groups using persisted Recommendation facts', async () => {
    render(<DiscoveryPage />);

    expect(await screen.findByRole('heading', { name: '今日发现' })).toBeInTheDocument();
    expect(getHome.mock.calls[0][0].payload).toEqual({ mode: 'timeline', limit: 60 });
    expect(screen.getByRole('heading', { name: '今天 · 8月22日' })).toBeInTheDocument();
    const card = screen.getByTestId('recommendation-recommendation:1');
    expect(within(card).getByText('Bilibili')).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: 'Agent Harness 深入实践' })).toBeInTheDocument();
    expect(within(card).getByText('因为它直接讨论你关心的工程实现。')).toBeInTheDocument();
    expect(within(card).queryByText('Agent 工程化')).not.toBeInTheDocument();
    expect(screen.queryByText(/桌面通知/)).not.toBeInTheDocument();
  });

  it('does not fabricate cover, author, or publish time when source facts are absent', async () => {
    getHome.mockResolvedValue(ok(homeView({
      recommendations: [recommendation({
        recommendationId: 'recommendation:sparse',
        title: '只有标题的网页',
        coverUrl: undefined,
        author: undefined,
        contentPublishedAt: undefined,
      })],
    })));

    render(<DiscoveryPage />);
    const card = await screen.findByTestId('recommendation-recommendation:sparse');

    expect(within(card).queryByRole('img')).not.toBeInTheDocument();
    expect(within(card).queryByText('未知作者')).not.toBeInTheDocument();
    expect(within(card).queryByText('刚刚')).not.toBeInTheDocument();
  });

  it('labels card actions and replaces an unavailable remote cover with the title fallback', async () => {
    render(<DiscoveryPage />);
    const card = await screen.findByTestId('recommendation-recommendation:1');
    const cover = card.querySelector('img');
    expect(cover).not.toBeNull();

    expect(cover).toHaveAttribute('loading', 'lazy');
    expect(cover).toHaveAttribute('decoding', 'async');
    expect(cover).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(within(card).getByRole('button', { name: '喜欢 Agent Harness 深入实践' })).toHaveAttribute('title', '喜欢');
    expect(within(card).getByRole('button', { name: '收藏 Agent Harness 深入实践' })).toHaveAttribute('title', '收藏');
    expect(within(card).getByRole('button', { name: '稍后看 Agent Harness 深入实践' })).toHaveAttribute('title', '稍后看');

    fireEvent.error(cover!);
    expect(card.querySelector('img')).not.toBeInTheDocument();
    expect(within(card).getAllByText('Agent Harness 深入实践')).toHaveLength(2);
  });

  it('shows two responsive rows per timeline day and lets the user expand or collapse the group', async () => {
    const user = userEvent.setup();
    const recommendations = Array.from({ length: 8 }, (_, index) => recommendation({
      recommendationId: `recommendation:${index + 1}`,
      title: `每日内容 ${index + 1}`,
      position: index,
    }));
    getHome.mockResolvedValue(ok(homeView({ recommendations })));

    render(<DiscoveryPage />);

    expect(await screen.findAllByTestId(/^recommendation-recommendation:/)).toHaveLength(4);
    expect(screen.getByRole('button', { name: '显示更多（还有 4 条）' })).toHaveAttribute('aria-expanded', 'false');

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(screen.getAllByTestId(/^recommendation-recommendation:/)).toHaveLength(6));

    const expand = screen.getByRole('button', { name: '显示更多（还有 2 条）' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');

    await user.click(expand);
    expect(screen.getAllByTestId(/^recommendation-recommendation:/)).toHaveLength(8);
    expect(screen.getByRole('button', { name: '收起' })).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('button', { name: '收起' }));
    expect(screen.getAllByTestId(/^recommendation-recommendation:/)).toHaveLength(6);
  });

  it('searches only published local recommendations and updates card state through the Host', async () => {
    const user = userEvent.setup();
    searchRecommendations.mockResolvedValue(ok({
      query: 'Agent',
      recommendations: Array.from({ length: 8 }, (_, index) => recommendation({
        recommendationId: index === 0 ? 'recommendation:search' : `recommendation:search:${index}`,
        title: index === 0 ? 'Agent 搜索结果' : `Agent 搜索结果 ${index + 1}`,
        position: index,
      })),
    }));
    render(<DiscoveryPage />);
    await screen.findByText('Agent Harness 深入实践');

    await user.type(screen.getByRole('searchbox', { name: '搜索已发现的内容' }), 'Agent');
    await user.click(screen.getByRole('button', { name: '搜索' }));

    expect(searchRecommendations).toHaveBeenCalledOnce();
    expect(searchRecommendations.mock.calls[0][0].payload).toEqual({ query: 'Agent', limit: 60 });
    expect(ensureDaily).not.toHaveBeenCalled();
    expect(await screen.findByText('Agent 搜索结果')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^recommendation-recommendation:/)).toHaveLength(8);
    expect(screen.queryByRole('button', { name: /显示更多/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '收藏 Agent 搜索结果' }));
    expect(updateRecommendationState.mock.calls.at(-1)?.[0].payload).toEqual({
      recommendationId: 'recommendation:search',
      action: 'set_favorite',
      favorite: true,
    });
  });

  it('records an open before sending the persisted original URL to the Desktop shell', async () => {
    const user = userEvent.setup();
    render(<DiscoveryPage />);
    await user.click(await screen.findByRole('heading', { name: 'Agent Harness 深入实践' }));

    expect(updateRecommendationState.mock.calls.at(-1)?.[0].payload).toEqual({
      recommendationId: 'recommendation:1',
      action: 'opened',
    });
    expect(window.open).toHaveBeenCalledWith('https://www.bilibili.com/video/BV1', '_blank', 'noopener,noreferrer');
  });

  it('manages natural-language interests and saves adjustable discovery settings', async () => {
    const user = userEvent.setup();
    render(<DiscoveryPage />);
    await screen.findByText('Agent Harness 深入实践');

    await user.click(screen.getByRole('button', { name: '管理关注' }));
    expect(await screen.findByRole('dialog', { name: '关注与每日发现' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '关注 1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Agent 工程化')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Agent 工程化')).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '添加关注' }), '秋招信息');
    await user.click(screen.getByRole('button', { name: '添加' }));
    expect(changeInterest.mock.calls.at(-1)?.[0].payload).toEqual({ action: 'create', description: '秋招信息' });

    await user.click(screen.getByRole('tab', { name: '发现设置' }));
    expect(screen.getByRole('switch', { name: '允许从已授权会话中理解关注' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: '哔哩哔哩' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: '开放 Web' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    const count = screen.getByRole('spinbutton', { name: '每日推荐数量' });
    await user.clear(count);
    await user.type(count, '36');
    await user.click(screen.getByRole('button', { name: '保存发现设置' }));

    expect(configurationUpdate.mock.calls.at(-1)?.[0].payload).toMatchObject({
      dailyTargetCount: 36,
      enabledSources: ['bilibili', 'open_web'],
    });
    expect(ensureDaily).not.toHaveBeenCalled();
  });

  it('keeps interests readable until edited and places destructive actions in an overflow menu', async () => {
    const user = userEvent.setup();
    render(<DiscoveryPage />);
    await screen.findByText('Agent Harness 深入实践');

    await user.click(screen.getByRole('button', { name: '管理关注' }));
    const activeSwitch = await screen.findByRole('switch', { name: '暂停 Agent 工程化' });
    expect(activeSwitch).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('button', { name: 'Agent 工程化的更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '编辑' }));
    const editor = screen.getByRole('textbox', { name: '编辑关注 Agent 工程化' });
    await user.clear(editor);
    await user.type(editor, 'Agent 工程化与真实项目');
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    expect(changeInterest.mock.calls.at(-1)?.[0].payload).toEqual({
      action: 'update',
      interestId: 'interest:1',
      description: 'Agent 工程化与真实项目',
    });

    await user.click(screen.getByRole('button', { name: 'Agent 工程化的更多操作' }));
    expect(screen.getByRole('menuitem', { name: '删除' })).toBeInTheDocument();
  });

  it('keeps the interest drawer mounted until its closing motion has visibly completed', async () => {
    const user = userEvent.setup();
    render(<DiscoveryPage />);
    await screen.findByText('Agent Harness 深入实践');
    await user.click(screen.getByRole('button', { name: '管理关注' }));

    const dialog = await screen.findByRole('dialog', { name: '关注与每日发现' });
    await waitFor(() => expect(dialog).toHaveClass('translate-x-0'));

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: '关闭关注管理' }));
      expect(dialog).toHaveClass('translate-x-full');

      act(() => vi.advanceTimersByTime(200));
      expect(dialog).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(80));
      expect(screen.queryByRole('dialog', { name: '关注与每日发现' })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a failed daily run and lets the user retry it', async () => {
    getHome.mockResolvedValue(ok({
      ...homeView(),
      today: {
        localDate: '2026-08-22', status: 'failed', batchId: 'batch:1', executionId: 'execution:1', resultCount: 0,
        failure: { code: 'source_unavailable', message: '暂时无法访问内容来源。', retryable: true },
      },
      days: [],
    }));
    const user = userEvent.setup();

    render(<DiscoveryPage />);
    expect(await screen.findByText('今天的发现生成失败。')).toBeInTheDocument();
    expect(screen.getByText('暂时无法访问内容来源。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(ensureDaily).toHaveBeenCalledOnce();
  });
});

function homeView(options: { recommendations?: ReturnType<typeof recommendation>[] } = {}) {
  return {
    mode: 'timeline' as const,
    today: {
      localDate: '2026-08-22', status: 'published' as const, batchId: 'batch:1', executionId: 'execution:1',
      targetCount: 20, resultCount: 1, publishedAt: '2026-08-22T08:00:00.000Z',
    },
    days: [{ localDate: '2026-08-22', recommendations: options.recommendations ?? [recommendation()] }],
    interests: [{
      interestId: 'interest:1', description: 'Agent 工程化', status: 'active' as const, createdFrom: 'manual' as const,
      userManagedAt: '2026-08-20T08:00:00.000Z', createdAt: '2026-08-20T08:00:00.000Z', updatedAt: '2026-08-20T08:00:00.000Z',
    }],
    favoriteCount: 0,
    watchLaterCount: 0,
    nextScheduledAt: '2026-08-23T00:00:00.000Z',
  };
}

function recommendation(overrides: Record<string, unknown> = {}) {
  return {
    recommendationId: 'recommendation:1', batchId: 'batch:1', localDate: '2026-08-22', position: 0,
    sourceId: 'bilibili', sourceName: 'Bilibili', canonicalUrl: 'https://www.bilibili.com/video/BV1', contentType: 'video' as const,
    sourceContentId: 'BV1', title: 'Agent Harness 深入实践', author: '技术UP主',
    contentPublishedAt: '2026-08-21T09:00:00.000Z', description: '从运行循环到工具环境的完整拆解。',
    coverUrl: 'https://i.example.com/cover.jpg', recommendationReason: '因为它直接讨论你关心的工程实现。',
    hidden: false, favorite: false, watchLater: false, publishedAt: '2026-08-22T08:00:00.000Z',
    ...overrides,
  };
}

function discoveryConfiguration(overrides: Record<string, unknown> = {}) {
  return {
    conversationRecognitionEnabled: false,
    dailyGenerationTime: '08:00',
    dailyTargetCount: 20,
    sources: [
      { sourceId: 'bilibili', name: '哔哩哔哩', access: 'public' as const, supportedModes: ['relevance' as const, 'recent' as const], enabled: true, connectionState: 'ready' as const },
      { sourceId: 'open_web', name: '开放 Web', access: 'public' as const, supportedModes: ['relevance' as const, 'recent' as const], enabled: true, connectionState: 'ready' as const },
      { sourceId: 'xiaohongshu', name: '小红书', access: 'browser_session' as const, supportedModes: ['relevance' as const, 'recent' as const], enabled: false, connectionState: 'extension_offline' as const },
      { sourceId: 'douyin', name: '抖音', access: 'browser_session' as const, supportedModes: ['relevance' as const, 'recent' as const], enabled: false, connectionState: 'extension_offline' as const },
      { sourceId: 'zhihu', name: '知乎', access: 'browser_session' as const, supportedModes: ['relevance' as const, 'recent' as const], enabled: false, connectionState: 'extension_offline' as const },
    ],
    ...overrides,
  };
}

function ok<T extends object>(data: T) {
  return { ok: true as const, data, meta: {} };
}
