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
  const requestRecommendation = vi.fn();
  const confirmCandidateSupply = vi.fn();
  const configurationGet = vi.fn();
  const configurationUpdate = vi.fn();

  beforeEach(async () => {
    await initializeRendererI18n('zh-CN');
    confirmCandidateSupply.mockReset().mockResolvedValue(ok({ status: 'confirmed' }));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    getHome.mockReset().mockResolvedValue(ok(homeView()));
    searchRecommendations.mockReset().mockResolvedValue(ok({
      query: 'Agent',
      recommendations: [recommendation({ recommendationId: 'recommendation:search', title: 'Agent 搜索结果' })],
    }));
    updateRecommendationState.mockReset().mockImplementation(async (request) => ok({
      status: 'updated',
      state: recommendationState({
        favoriteAt: request.payload.action === 'set_favorite' && request.payload.favorite
          ? '2026-08-22T10:00:00.000Z'
          : undefined,
      }),
    }));
    changeInterest.mockReset().mockResolvedValue(ok({
      interestId: 'interest:2', description: '秋招信息', status: 'active', createdFrom: 'manual',
      userManagedAt: '2026-08-22T08:00:00.000Z', createdAt: '2026-08-22T08:00:00.000Z', updatedAt: '2026-08-22T08:00:00.000Z',
    }));
    requestRecommendation.mockReset().mockResolvedValue(ok({
      status: 'started', requestId: 'request:2', executionId: 'execution:2',
    }));
    configurationGet.mockReset().mockResolvedValue(ok(discoveryConfiguration()));
    configurationUpdate.mockReset().mockImplementation(async (request) => ok(discoveryConfiguration({
      recommendationTargetCount: request.payload.recommendationTargetCount,
    })));
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        discovery: {
          getHome, searchRecommendations, updateRecommendationState, changeInterest,
          requestRecommendation,
          confirmCandidateSupply,
          getConfiguration: configurationGet, updateConfiguration: configurationUpdate,
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

  it('offers to add the first interest without starting recommendation when interests are empty', async () => {
    getHome.mockResolvedValue(ok({
      ...homeView(),
      candidateSupplyConfirmed: false,
      interests: [],
      days: [],
      today: { localDate: '2026-08-22', status: 'not_generated', resultCount: 0 },
    }));

    render(<DiscoveryPage />);

    expect(await screen.findByRole('button', { name: '添加第一项兴趣' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '首次加载' })).not.toBeInTheDocument();
    expect(confirmCandidateSupply).not.toHaveBeenCalled();
    expect(requestRecommendation).not.toHaveBeenCalled();
  });

  it('asks for first supply consent and defers without repeatedly opening the prompt', async () => {
    getHome.mockResolvedValue(ok({ ...homeView(), candidateSupplyConfirmed: false }));
    const user = userEvent.setup();
    render(<DiscoveryPage />);
    const prompt = await screen.findByRole('dialog', { name: '首次加载' });
    expect(within(prompt).getByText('首次加载比较耗时，推荐可能会调用多次模型，过程会产生费用，请确认是否开始')).toBeInTheDocument();
    await user.click(within(prompt).getByRole('button', { name: '暂不开始' }));
    expect(screen.queryByRole('dialog', { name: '首次加载' })).not.toBeInTheDocument();
    expect(confirmCandidateSupply).not.toHaveBeenCalled();
    expect(requestRecommendation).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '开始' }));
    await user.click(within(await screen.findByRole('dialog', { name: '首次加载' })).getByRole('button', { name: '开始' }));
    expect(confirmCandidateSupply).toHaveBeenCalledOnce();
    expect(requestRecommendation).not.toHaveBeenCalled();
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

    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
      window.dispatchEvent(new Event('resize'));
    });
    await waitFor(() => expect(screen.getAllByTestId(/^recommendation-recommendation:/)).toHaveLength(6));

    const expand = screen.getByRole('button', { name: '显示更多（还有 2 条）' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');

    await user.click(expand);
    expect(screen.getAllByTestId(/^recommendation-recommendation:/)).toHaveLength(8);
    expect(screen.getByRole('button', { name: '收起' })).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('button', { name: '收起' }));
    expect(screen.getAllByTestId(/^recommendation-recommendation:/)).toHaveLength(6);
  });

  it('switches modes without rendering stale cards and ignores out-of-order Home responses', async () => {
    const user = userEvent.setup();
    const recommendations = Array.from({ length: 20 }, (_, index) => recommendation({
      recommendationId: `recommendation:${index + 1}`,
      title: `推荐内容 ${index + 1}`,
      position: index,
    }));
    const favoritesResponse = deferred<ReturnType<typeof ok>>();
    getHome.mockReset()
      .mockResolvedValueOnce(ok(homeView({ recommendations })))
      .mockImplementationOnce(() => favoritesResponse.promise)
      .mockResolvedValueOnce(ok(homeView({
        mode: 'watch_later',
        recommendations: [recommendation({ recommendationId: 'recommendation:later', title: '稍后看内容' })],
      })));

    render(<DiscoveryPage />);
    expect(await screen.findAllByTestId(/^recommendation-recommendation:/)).toHaveLength(4);

    await user.click(screen.getByRole('button', { name: '收藏' }));
    expect(screen.getByRole('button', { name: '收藏' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryAllByTestId(/^recommendation-recommendation:/)).toHaveLength(0);
    expect(screen.getByText('正在加载发现内容…')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '稍后看' }));
    expect(await screen.findByText('稍后看内容')).toBeInTheDocument();

    await act(async () => {
      favoritesResponse.resolve(ok(homeView({
        mode: 'favorites',
        recommendations: [recommendation({ recommendationId: 'recommendation:favorite', title: '收藏内容' })],
      })));
      await favoritesResponse.promise;
    });
    expect(screen.getByText('稍后看内容')).toBeInTheDocument();
    expect(screen.queryByText('收藏内容')).not.toBeInTheDocument();
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
    expect(requestRecommendation).not.toHaveBeenCalled();
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

    const count = screen.getByRole('spinbutton', { name: '推荐数量' });
    await user.clear(count);
    await user.type(count, '36');
    await user.click(screen.getByRole('button', { name: '保存发现设置' }));

    expect(configurationUpdate.mock.calls.at(-1)?.[0].payload).toMatchObject({
      recommendationTargetCount: 36,
      enabledSources: ['bilibili', 'open_web'],
    });
    expect(requestRecommendation).not.toHaveBeenCalled();
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
        localDate: '2026-08-22', status: 'failed', requestId: 'request:1', executionId: 'execution:1', resultCount: 0,
        failure: { code: 'source_unavailable', message: '暂时无法访问内容来源。', retryable: true },
      },
      days: [],
    }));
    const user = userEvent.setup();

    render(<DiscoveryPage />);
    expect(await screen.findByText('今天的发现生成失败。')).toBeInTheDocument();
    expect(screen.getByText('暂时无法访问内容来源。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(requestRecommendation).toHaveBeenCalledOnce();
  });

  it('defers by Escape without saving confirmation', async () => {
    getHome.mockResolvedValue(ok({ ...homeView(), candidateSupplyConfirmed: false }));
    const user = userEvent.setup();
    render(<DiscoveryPage />);
    await screen.findByRole('dialog', { name: '首次加载' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(confirmCandidateSupply).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '开始' })).toBeInTheDocument();
  });

  it('keeps failed confirmation open and does not render raw failure details', async () => {
    getHome.mockResolvedValue(ok({ ...homeView(), candidateSupplyConfirmed: false }));
    confirmCandidateSupply.mockResolvedValue({ ok: false, data: { message: 'raw settings stack' } });
    const user = userEvent.setup();
    render(<DiscoveryPage />);
    const dialog = await screen.findByRole('dialog', { name: '首次加载' });
    await user.click(within(dialog).getByRole('button', { name: '开始' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('未能确认开始，请重试。');
    expect(dialog).not.toHaveTextContent('raw settings stack');
    expect(requestRecommendation).not.toHaveBeenCalled();
  });

  it('disables repeated confirmation and displays actual supply progress after acceptance', async () => {
    getHome.mockResolvedValue(ok({ ...homeView(), candidateSupplyConfirmed: false }));
    let releaseConfirmation!: () => void;
    const pending = new Promise<void>((resolve) => { releaseConfirmation = resolve; });
    confirmCandidateSupply.mockImplementation(async () => {
      await pending;
      getHome.mockResolvedValue(ok({ ...homeView(), days: [],
        today: { localDate: '2026-08-22', status: 'not_generated', resultCount: 0 },
        candidateSupplyStatus: { status: 'running' },
      }));
      return ok({ status: 'confirmed' });
    });
    const user = userEvent.setup();
    render(<DiscoveryPage />);
    const dialog = await screen.findByRole('dialog', { name: '首次加载' });
    const start = within(dialog).getByRole('button', { name: '开始' });
    await user.dblClick(start);
    expect(start).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '暂不开始' })).toBeDisabled();
    expect(confirmCandidateSupply).toHaveBeenCalledOnce();
    await act(async () => { releaseConfirmation(); });
    expect(await screen.findByText('正在为你准备推荐…')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(requestRecommendation).not.toHaveBeenCalled();
  });

  it('shows a model configuration failure returned by the background input check', async () => {
    getHome.mockResolvedValue(ok({ ...homeView(), days: [],
      today: { localDate: '2026-08-22', status: 'model_unavailable', resultCount: 0 },
    }));
    render(<DiscoveryPage />);
    expect(await screen.findByText('没有可用的模型，请检查设置中的模型和 API Key。')).toBeInTheDocument();
    expect(screen.queryByText('正在为你准备推荐…')).not.toBeInTheDocument();
  });

  it.each([
    ['402: {"message":"Insufficient Balance","type":"unknown_error","param":null,"code":"invalid_request_error"}', '模型服务账户余额不足，请充值或在设置中更换模型服务后重试。'],
    ['401: {"message":"Invalid API key"}', '模型服务认证失败，请检查设置中的 API Key。'],
    ['429: {"message":"Rate limit exceeded"}', '模型服务请求受限，请稍后重试。'],
    ['500: {"message":"Internal server error"}', '模型服务暂时不可用，请稍后重试。'],
    ['{"message":"unrecognized technical detail"}', '未能完成推荐生成，请查看日志了解详情。'],
    ['Task 402 failed: {"message":"unrecognized technical detail"}', '未能完成推荐生成，请查看日志了解详情。'],
  ])('shows a localized summary instead of provider payload: %s', async (message, summary) => {
    getHome.mockResolvedValue(ok({
      ...homeView(),
      today: {
        localDate: '2026-08-22', status: 'failed', resultCount: 0,
        failure: { code: 'agent_execution_failed', message, retryable: false },
      },
      days: [],
    }));

    render(<DiscoveryPage />);
    await screen.findByText('今天的发现生成失败。');
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    expect(screen.getByText(summary)).toBeInTheDocument();
    expect(requestRecommendation).not.toHaveBeenCalled();
  });

  it('localizes the provider failure in English as well', async () => {
    await initializeRendererI18n('en-US');
    getHome.mockResolvedValue(ok({
      ...homeView(),
      today: {
        localDate: '2026-08-22', status: 'failed', resultCount: 0,
        failure: { code: 'agent_execution_failed', message: '402: {"message":"Insufficient Balance"}', retryable: false },
      },
      days: [],
    }));

    render(<DiscoveryPage />);
    expect(await screen.findByText('The model service account has insufficient balance. Add credit or change the model service in Settings before retrying.')).toBeInTheDocument();
    expect(screen.queryByText(/\{"message"/)).not.toBeInTheDocument();
  });

  it.each(['provider', 'ipc', 'rejected', 'model_unavailable'])(
    'shows a generation error rather than a save error when retry fails: %s', async (scenario) => {
      getHome.mockResolvedValue(ok({
        ...homeView(),
        today: { localDate: '2026-08-22', status: 'failed', resultCount: 0 },
        days: [],
      }));
      if (scenario === 'rejected') {
        requestRecommendation.mockRejectedValue(new Error('internal IPC detail'));
      } else if (scenario === 'ipc') {
        requestRecommendation.mockResolvedValue({ ok: false, data: { message: 'internal IPC detail' } });
      } else if (scenario === 'model_unavailable') {
        requestRecommendation.mockResolvedValue(ok({ status: 'model_unavailable', localDate: '2026-08-22' }));
      } else {
        requestRecommendation.mockResolvedValue(ok({
          status: 'failed', localDate: '2026-08-22',
          failure: { code: 'agent_execution_failed', message: '402: {"message":"Insufficient Balance"}', retryable: false },
        }));
      }
      const user = userEvent.setup();
      render(<DiscoveryPage />);
      await user.click(await screen.findByRole('button', { name: '重试' }));

      const alert = await screen.findByRole('alert');
      const expected = scenario === 'provider'
        ? '模型服务账户余额不足，请充值或在设置中更换模型服务后重试。'
        : scenario === 'model_unavailable'
          ? '没有可用的模型，请检查设置中的模型和 API Key。'
          : '未能完成推荐生成，请查看日志了解详情。';
      expect(alert).toHaveTextContent(expected);
      expect(alert).not.toHaveTextContent(/Insufficient Balance|internal IPC detail|未能保存/);
      expect(requestRecommendation).toHaveBeenCalledOnce();
    },
  );

  it('shows recommendation preparation and polls without mentioning the candidate pool', async () => {
    getHome.mockResolvedValue(ok({
      ...homeView(),
      today: {
        localDate: '2026-08-22', status: 'waiting_for_candidates', resultCount: 0,
      },
      days: [],
    }));
    vi.useFakeTimers();
    try {
      render(<DiscoveryPage onOpenContentSources={vi.fn()} />);
      await act(async () => { await Promise.resolve(); });

      expect(screen.getByText('正在为你准备推荐…')).toBeInTheDocument();
      expect(screen.queryByText(/候选/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '立即生成' })).not.toBeInTheDocument();

      act(() => vi.advanceTimersByTime(3_000));
      await act(async () => { await Promise.resolve(); });
      expect(getHome).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

function homeView(options: {
  mode?: 'timeline' | 'favorites' | 'watch_later';
  recommendations?: ReturnType<typeof recommendation>[];
} = {}) {
  return {
    mode: options.mode ?? 'timeline',
    candidateSupplyConfirmed: true,
    candidateSupplyStatus: { status: 'idle' as const },
    today: {
      localDate: '2026-08-22', status: 'published' as const,
      requestId: 'request:1', executionId: 'execution:1', resultCount: 1,
      publishedAt: '2026-08-22T08:00:00.000Z',
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
    recommendationId: 'recommendation:1', localDate: '2026-08-22', position: 0,
    sourceId: 'bilibili', sourceName: 'Bilibili', canonicalUrl: 'https://www.bilibili.com/video/BV1', contentType: 'video' as const,
    sourceContentId: 'BV1', title: 'Agent Harness 深入实践', author: '技术UP主',
    contentPublishedAt: '2026-08-21T09:00:00.000Z', description: '从运行循环到工具环境的完整拆解。',
    contentSummary: 'Agent Harness 工程实践摘要。',
    coverUrl: 'https://i.example.com/cover.jpg', recommendationReason: '因为它直接讨论你关心的工程实现。',
    hidden: false, favorite: false, watchLater: false, publishedAt: '2026-08-22T08:00:00.000Z',
    ...overrides,
  };
}

function recommendationState(overrides: Record<string, unknown> = {}) {
  return {
    id: 'recommendation-state:1',
    recommendationId: 'recommendation:1',
    reactionRevision: 0,
    learnedReactionRevision: 0,
    updatedAt: '2026-08-22T10:00:00.000Z',
    ...overrides,
  };
}

function discoveryConfiguration(overrides: Record<string, unknown> = {}) {
  return {
    conversationRecognitionEnabled: false,
    recommendationGenerationTime: '08:00',
    recommendationTargetCount: 20,
    recommendationWorkingSetCount: 80,
    sources: [
      { sourceId: 'bilibili', name: '哔哩哔哩', access: 'public_http' as const, supportedModes: ['relevance' as const, 'recent' as const], enabled: true, connectionState: 'ready' as const },
      { sourceId: 'open_web', name: '开放 Web', access: 'configured_provider' as const, supportedModes: ['relevance' as const, 'recent' as const], enabled: true, connectionState: 'ready' as const },
      { sourceId: 'xiaohongshu', name: '小红书', access: 'browser_session' as const, supportedModes: ['relevance' as const], enabled: false, connectionState: 'login_required' as const },
      { sourceId: 'douyin', name: '抖音', access: 'browser_session' as const, supportedModes: ['relevance' as const], enabled: false, connectionState: 'login_required' as const },
      { sourceId: 'zhihu', name: '知乎', access: 'configured_provider' as const, supportedModes: ['relevance' as const], enabled: false, connectionState: 'not_configured' as const },
      { sourceId: 'twitter', name: 'X / Twitter', access: 'configured_provider' as const, supportedModes: ['relevance' as const, 'recent' as const], enabled: false, connectionState: 'not_configured' as const },
    ],
    ...overrides,
  };
}

function ok<T extends object>(data: T) {
  return { ok: true as const, data, meta: {} };
}

function deferred<T>() {
  let settle: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => { settle = resolve; });
  return {
    promise,
    resolve(value: T) {
      if (!settle) throw new Error('Deferred promise was not initialized.');
      settle(value);
    },
  };
}
