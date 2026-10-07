// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiscoveryPage } from '@megumi/desktop/renderer/features/discovery';
import { initializeRendererI18n } from '@megumi/desktop/renderer/shared/i18n';
describe('DiscoveryPage', () => {
  const listInterests = vi.fn();
  const changeInterest = vi.fn();
  const getConfiguration = vi.fn();
  const updateConfiguration = vi.fn();
  const confirmCandidateSupply = vi.fn();
  const listDailyFeed = vi.fn();
  const startDailyFeed = vi.fn();
  beforeEach(async () => {
    await initializeRendererI18n('zh-CN');
    listInterests.mockReset().mockResolvedValue(ok({ interests: savedInterests() }));
    changeInterest
      .mockReset()
      .mockImplementation(async () => ok({ status: 'changed', interests: savedInterests() }));
    getConfiguration.mockReset().mockResolvedValue(ok(configuration()));
    updateConfiguration
      .mockReset()
      .mockImplementation(async (request) => ok(configuration({ enabledSources: request.payload.enabledSources })));
    confirmCandidateSupply.mockReset().mockResolvedValue(ok({ status: 'confirmed' }));
    listDailyFeed.mockReset().mockResolvedValue(ok({ date: '2026-10-07', items: [], batches: [], activeRuns: [] }));
    startDailyFeed.mockReset().mockResolvedValue(ok({ status: 'started', runId: 'daily-1' }));
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        recommendation: { listDailyFeed, startDailyFeed, onChanged: () => () => undefined },
        discovery: {
          listInterests,
          changeInterest,
          getConfiguration,
          updateConfiguration,
          confirmCandidateSupply,
        },
      },
    });
  });
  it('reads daily history without starting acquisition and distinguishes source failure from an empty day', async () => {
    listDailyFeed.mockResolvedValue(ok({ date: '2026-10-07', items: [], activeRuns: [], batches: [{ id: 'batch-1', interestId: 'interest:1', interestRevision: 1, interestText: 'Agent 工程化', status: 'failed', issues: [{ code: 'SOURCE_UNAVAILABLE', message: 'source unavailable' }] }] }));
    render(<DiscoveryPage />);
    expect(await screen.findByText('当日获取失败')).toBeInTheDocument();
    expect(screen.queryByText('当天没有符合条件的新内容')).not.toBeInTheDocument();
    expect(startDailyFeed).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: '动态日期' }), '2026-10-06');
    await waitFor(() => expect(listDailyFeed.mock.calls.at(-1)?.[0].payload).toEqual({ date: '2026-10-06' }));
    expect(startDailyFeed).not.toHaveBeenCalled();
  });
  it('reads the saved interests from the Host and links to the content sources settings', async () => {
    const onOpenContentSources = vi.fn();
    const user = userEvent.setup();
    render(<DiscoveryPage onOpenContentSources={onOpenContentSources} />);

    expect(await screen.findByText('Agent 工程化')).toBeInTheDocument();
    expect(screen.getByText('秋招信息')).toBeInTheDocument();
    expect(listInterests.mock.calls[0][0].payload).toEqual({});
    expect(listInterests.mock.calls[0][0].meta.channel).toBe('discovery:interest:list');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '管理内容来源' }));

    expect(onOpenContentSources).toHaveBeenCalledOnce();
  });
  it('creates an interest with the typed description', async () => {
    const user = userEvent.setup();
    render(<DiscoveryPage />);
    await screen.findByText('Agent 工程化');

    await user.type(screen.getByRole('textbox', { name: '添加关注' }), '  秋招面试经验  ');
    await user.click(screen.getByRole('button', { name: '添加' }));

    expect(changeInterest.mock.calls.at(-1)?.[0].payload).toEqual({
      action: 'create',
      description: '秋招面试经验',
    });
    expect(screen.getByRole('textbox', { name: '添加关注' })).toHaveValue('');
  });
  it('edits an interest from its overflow menu and keeps the saved text on failure', async () => {
    const user = userEvent.setup();
    changeInterest.mockResolvedValue({ ok: false, data: { message: 'raw host detail' }, meta: {} });
    render(<DiscoveryPage />);
    await screen.findByText('Agent 工程化');

    await user.click(screen.getByRole('button', { name: 'Agent 工程化的更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '编辑' }));
    const editor = screen.getByRole('textbox', { name: '编辑关注 Agent 工程化' });
    await user.clear(editor);
    await user.type(editor, 'Agent 工程化与真实项目');
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    expect(changeInterest.mock.calls.at(-1)?.[0].payload).toEqual({
      action: 'update',
      interestId: 'interest:1', expectedRevision: 1,
      description: 'Agent 工程化与真实项目',
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('未能保存这次修改。');
    expect(alert).not.toHaveTextContent('raw host detail');
    expect(editor).toHaveValue('Agent 工程化与真实项目');
  });
  it('enables, disables, and deletes an interest through one Host operation', async () => {
    const user = userEvent.setup();
    render(<DiscoveryPage />);
    await screen.findByText('Agent 工程化');

    await user.click(screen.getByRole('switch', { name: '暂停 Agent 工程化' }));
    expect(changeInterest.mock.calls.at(-1)?.[0].payload).toEqual({
      action: 'pause',
      interestId: 'interest:1', expectedRevision: 1,
    });

    await user.click(screen.getByRole('switch', { name: '恢复 秋招信息' }));
    expect(changeInterest.mock.calls.at(-1)?.[0].payload).toEqual({
      action: 'resume',
      interestId: 'interest:2', expectedRevision: 1,
    });

    await user.click(screen.getByRole('button', { name: 'Agent 工程化的更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '删除' }));
    expect(changeInterest.mock.calls.at(-1)?.[0].payload).toEqual({
      action: 'delete',
      interestId: 'interest:1', expectedRevision: 1,
    });
  });
  it('explains a conflicting edit and reloads current interests without discarding the draft', async () => {
    const user = userEvent.setup();
    render(<DiscoveryPage />);
    await screen.findByText('Agent 工程化');
    await user.click(screen.getByRole('button', { name: 'Agent 工程化的更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '编辑' }));
    const editor = screen.getByRole('textbox', { name: '编辑关注 Agent 工程化' });
    await user.clear(editor); await user.type(editor, '保留我的输入');
    changeInterest.mockResolvedValue(ok({ status: 'revision_conflict' }));
    listInterests.mockResolvedValue(ok({ interests: [{ id: 'interest:1', text: '其他设备的修改', enabled: true, revision: 2 }] }));
    await user.click(screen.getByRole('button', { name: '保存修改' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('已被修改');
    expect(editor).toHaveValue('保留我的输入');
    expect(await screen.findByRole('textbox', { name: '编辑关注 其他设备的修改' })).toHaveValue('保留我的输入');
  });
  it('adopts the saved list the Host returns instead of re-reading interests', async () => {
    const user = userEvent.setup();
    changeInterest.mockResolvedValue(ok({
      status: 'changed',
      interests: [{ id: 'interest:3', text: '只有这一条', enabled: true, revision: 1 }],
    }));
    render(<DiscoveryPage />);
    await screen.findByText('Agent 工程化');

    await user.click(screen.getByRole('switch', { name: '暂停 Agent 工程化' }));

    expect(await screen.findByText('只有这一条')).toBeInTheDocument();
    expect(screen.queryByText('秋招信息')).not.toBeInTheDocument();
    expect(listInterests).toHaveBeenCalledOnce();
  });
  it('reports a rejected interest edit without inventing a saved interest', async () => {
    const user = userEvent.setup();
    changeInterest.mockResolvedValue(ok({ status: 'not_found' }));
    render(<DiscoveryPage />);
    await screen.findByText('Agent 工程化');

    await user.click(screen.getByRole('switch', { name: '暂停 Agent 工程化' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('未能保存这次修改。');
    expect(screen.getByRole('switch', { name: '暂停 Agent 工程化' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
  it('enables a content source through the saved supply configuration', async () => {
    const user = userEvent.setup();
    updateConfiguration.mockResolvedValue(ok(configuration({ enabledSources: [] })));
    render(<DiscoveryPage />);
    await screen.findByText('Agent 工程化');

    await user.click(screen.getByRole('tab', { name: '内容来源' }));
    const source = screen.getByRole('switch', { name: '知乎' });
    expect(source).toHaveAttribute('aria-checked', 'true');

    await user.click(source);

    expect(updateConfiguration.mock.calls.at(-1)?.[0].payload).toEqual({ enabledSources: [] });
    expect(await screen.findByRole('switch', { name: '知乎' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
  it('asks for first-supply consent once an enabled interest exists and defers without confirming', async () => {
    getConfiguration.mockResolvedValue(ok(configuration({ candidateSupplyConfirmed: false })));
    const user = userEvent.setup();
    render(<DiscoveryPage />);

    const dialog = await screen.findByRole('dialog', { name: '首次加载' });
    expect(within(dialog).getByText(/首次加载比较耗时/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '暂不开始' }));

    expect(screen.queryByRole('dialog', { name: '首次加载' })).not.toBeInTheDocument();
    expect(confirmCandidateSupply).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '开始' })).toBeInTheDocument();
  });
  it('confirms the first supply through the Host and stops prompting', async () => {
    getConfiguration.mockResolvedValue(ok(configuration({ candidateSupplyConfirmed: false })));
    const user = userEvent.setup();
    render(<DiscoveryPage />);

    const prompt = await screen.findByRole('dialog', { name: '首次加载' });
    await user.click(within(prompt).getByRole('button', { name: '暂不开始' }));
    await user.click(screen.getByRole('button', { name: '开始' }));
    const dialog = await screen.findByRole('dialog', { name: '首次加载' });
    await user.click(within(dialog).getByRole('button', { name: '开始' }));

    expect(confirmCandidateSupply).toHaveBeenCalledOnce();
    expect(confirmCandidateSupply.mock.calls[0][0].meta.channel).toBe(
      'discovery:candidate-supply:confirm',
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '首次加载' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: '开始' })).not.toBeInTheDocument();
  });
  it('keeps a failed confirmation open without rendering raw host details', async () => {
    getConfiguration.mockResolvedValue(ok(configuration({ candidateSupplyConfirmed: false })));
    confirmCandidateSupply.mockResolvedValue({
      ok: false,
      data: { code: 'ipc_handler_failed', message: 'raw settings stack' },
      meta: {},
    });
    const user = userEvent.setup();
    render(<DiscoveryPage />);

    const dialog = await screen.findByRole('dialog', { name: '首次加载' });
    await user.click(within(dialog).getByRole('button', { name: '开始' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('未能确认开始，请重试。');
    expect(dialog).not.toHaveTextContent('raw settings stack');
    expect(screen.getByRole('dialog', { name: '首次加载' })).toBeInTheDocument();
  });
  it('does not ask for supply consent while every interest is disabled', async () => {
    listInterests.mockResolvedValue(ok({
      interests: [{ id: 'interest:2', text: '秋招信息', enabled: false, revision: 1 }],
    }));
    getConfiguration.mockResolvedValue(ok(configuration({ candidateSupplyConfirmed: false })));

    render(<DiscoveryPage />);

    expect(await screen.findByText('秋招信息')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '首次加载' })).not.toBeInTheDocument();
    expect(confirmCandidateSupply).not.toHaveBeenCalled();
  });
  it('reports a failed read without rendering raw host details', async () => {
    listInterests.mockResolvedValue({
      ok: false,
      data: { code: 'ipc_handler_failed', message: 'raw discovery stack' },
      meta: {},
    });

    render(<DiscoveryPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('无法加载关注。');
    expect(alert).not.toHaveTextContent('raw discovery stack');
    expect(screen.getByText('正在读取关注…')).toBeInTheDocument();
  });
});
function savedInterests() {
  return [
    { id: 'interest:1', text: 'Agent 工程化', enabled: true, revision: 1 },
    { id: 'interest:2', text: '秋招信息', enabled: false, revision: 1 },
  ];
}
function configuration(options: { candidateSupplyConfirmed?: boolean; enabledSources?: string[] } = {}) {
  const enabledSources = options.enabledSources ?? ['zhihu'];
  return {
    candidateSupplyConfirmed: options.candidateSupplyConfirmed ?? true,
    sources: [
      {
        sourceId: 'zhihu',
        name: '知乎',
        enabled: enabledSources.includes('zhihu'),
        credentialConfigured: true,
      },
    ],
  };
}
function ok<T extends object>(data: T) {
  return { ok: true as const, data, meta: {} };
}
