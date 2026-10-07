/*
 * Verifies local recommendation reads, explicit edits and persisted result actions in the page.
 */
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
      .mockImplementation(async (request) => ok(configuration({ enabledSources: request.payload.changes.enabledSources })));
    listDailyFeed.mockReset().mockResolvedValue(ok({ date: '2026-10-07', items: [], batches: [], activeRuns: [] }));
    startDailyFeed.mockReset().mockResolvedValue(ok({ status: 'started', runId: 'daily-1' }));
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        recommendation: { listDailyFeed, startDailyFeed, getCuratedSelection:async()=>ok({needsUpdate:false,supplyStatus:[]}),listFavorites:async()=>ok({items:[]}),onChanged: () => () => undefined,
          listInterests,
          createInterest:changeInterest,updateInterest:changeInterest,deleteInterest:changeInterest,
          getConfiguration,
          updateConfiguration,
        },
      },
    });
  });
  it('navigates between separate daily and curated pages without starting acquisition', async () => {
    render(<DiscoveryPage />);
    expect(await screen.findByRole('region', { name: '精选推荐' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '自定义兴趣动态' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '每日动态' }));
    expect(await screen.findByRole('region', { name: '自定义兴趣动态' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '精选推荐' })).not.toBeInTheDocument();
    expect(startDailyFeed).not.toHaveBeenCalled();
  });
  it('opens management in a keyboard-dismissible sidebar and returns focus to its button', async () => {
    render(<DiscoveryPage />);
    expect(screen.queryByRole('textbox', { name: '添加兴趣' })).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: '管理兴趣与来源' });
    await userEvent.click(button);
    const drawer = await screen.findByRole('dialog', { name: '兴趣与内容来源' });
    expect(await within(drawer).findByText('Agent 工程化')).toBeInTheDocument();
    expect(within(drawer).getByRole('textbox', { name: '添加兴趣' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '兴趣与内容来源' })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
  it('reads daily history without starting acquisition and distinguishes source failure from an empty day', async () => {
    listDailyFeed.mockResolvedValue(ok({ date: '2026-10-07', items: [], activeRuns: [], batches: [{ id: 'batch-1', interestId: 'interest:1', interestRevision: 1, interestText: 'Agent 工程化', status: 'failed', issues: [{ code: 'SOURCE_UNAVAILABLE', message: 'source unavailable' }] }] }));
    render(<DiscoveryPage />);
    await userEvent.click(screen.getByRole('button', { name: '每日动态' }));
    expect(await screen.findByText('当日获取失败')).toBeInTheDocument();
    expect(screen.queryByText('当天没有符合条件的新内容')).not.toBeInTheDocument();
    expect(startDailyFeed).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: '动态日期' }), '2026-10-06');
    await waitFor(() => expect(listDailyFeed).toHaveBeenCalledWith(expect.objectContaining({payload:{date:'2026-10-06'}})));
    expect(screen.getByRole('combobox',{name:'动态日期'})).toHaveValue('2026-10-06');
    expect(startDailyFeed).not.toHaveBeenCalled();
  });
  it('reads the saved interests from the Host and links to the content sources settings', async () => {
    const onOpenContentSources = vi.fn();
    const user = userEvent.setup();
    render(<DiscoveryPage onOpenContentSources={onOpenContentSources} />);

    await user.click(screen.getByRole('button', { name: '管理兴趣与来源' }));
    expect(await screen.findByText('Agent 工程化')).toBeInTheDocument();
    expect(screen.getByText('秋招信息')).toBeInTheDocument();
    expect(listInterests.mock.calls[0][0].payload).toEqual({});
    expect(listInterests.mock.calls[0][0].meta.channel).toBe('recommendation:list-interests');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '内容来源' }));
    await user.click(screen.getByRole('button', { name: '配置' }));

    expect(onOpenContentSources).toHaveBeenCalledOnce();
  });
  it('creates an interest with the typed description', async () => {
    const user = userEvent.setup();
    render(<DiscoveryPage />);
    await user.click(screen.getByRole('button', { name: '管理兴趣与来源' }));
    await screen.findByText('Agent 工程化');

    await user.type(screen.getByRole('textbox', { name: '添加兴趣' }), '  秋招面试经验  ');
    await user.click(screen.getByRole('button', { name: '添加' }));

    expect(changeInterest.mock.calls.at(-1)?.[0].payload).toEqual({
      text: '秋招面试经验',
    });
    expect(screen.getByRole('textbox', { name: '添加兴趣' })).toHaveValue('');
  });
  it('edits an interest from its overflow menu and keeps the saved text on failure', async () => {
    const user = userEvent.setup();
    changeInterest.mockResolvedValue({ ok: false, data: { message: 'raw host detail' }, meta: {} });
    render(<DiscoveryPage />);
    await user.click(screen.getByRole('button', { name: '管理兴趣与来源' }));
    await screen.findByText('Agent 工程化');

    await user.click(screen.getByRole('button', { name: 'Agent 工程化的更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '编辑' }));
    const editor = screen.getByRole('textbox', { name: '编辑兴趣 Agent 工程化' });
    await user.clear(editor);
    await user.type(editor, 'Agent 工程化与真实项目');
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    expect(changeInterest.mock.calls.at(-1)?.[0].payload).toEqual({
      interestId: 'interest:1', expectedRevision: 1,
      text: 'Agent 工程化与真实项目',
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('未能保存这次修改。');
    expect(alert).not.toHaveTextContent('raw host detail');
    expect(editor).toHaveValue('Agent 工程化与真实项目');
  });
  it('enables, disables, and deletes an interest through one Host operation', async () => {
    const user = userEvent.setup();
    render(<DiscoveryPage />);
    await user.click(screen.getByRole('button', { name: '管理兴趣与来源' }));
    await screen.findByText('Agent 工程化');

    await user.click(screen.getByRole('switch', { name: '暂停 Agent 工程化' }));
    expect(changeInterest.mock.calls.at(-1)?.[0].payload).toEqual({
      enabled: false,
      interestId: 'interest:1', expectedRevision: 1,
    });

    await user.click(screen.getByRole('switch', { name: '恢复 秋招信息' }));
    expect(changeInterest.mock.calls.at(-1)?.[0].payload).toEqual({
      enabled: true,
      interestId: 'interest:2', expectedRevision: 1,
    });

    await user.click(screen.getByRole('button', { name: 'Agent 工程化的更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '删除' }));
    expect(changeInterest.mock.calls.at(-1)?.[0].payload).toEqual({
      interestId: 'interest:1', expectedRevision: 1,
    });
  });
  it('explains a conflicting edit and reloads current interests without discarding the draft', async () => {
    const user = userEvent.setup();
    render(<DiscoveryPage />);
    await user.click(screen.getByRole('button', { name: '管理兴趣与来源' }));
    await screen.findByText('Agent 工程化');
    await user.click(screen.getByRole('button', { name: 'Agent 工程化的更多操作' }));
    await user.click(screen.getByRole('menuitem', { name: '编辑' }));
    const editor = screen.getByRole('textbox', { name: '编辑兴趣 Agent 工程化' });
    await user.clear(editor); await user.type(editor, '保留我的输入');
    changeInterest.mockResolvedValue({ok:false,data:{code:'REVISION_CONFLICT',message:'Interest changed'},meta:{}});
    listInterests.mockResolvedValue(ok({ interests: [{ id: 'interest:1', text: '其他设备的修改', enabled: true, revision: 2 }] }));
    await user.click(screen.getByRole('button', { name: '保存修改' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('已被修改');
    expect(editor).toHaveValue('保留我的输入');
    expect(await screen.findByRole('textbox', { name: '编辑兴趣 其他设备的修改' })).toHaveValue('保留我的输入');
  });
  it('reloads authoritative interests after a successful edit', async () => {
    const user = userEvent.setup();
    listInterests.mockResolvedValueOnce(ok({interests:savedInterests()})).mockResolvedValue(ok({interests:[{id:'interest:3',text:'只有这一条',enabled:true,revision:1}]}));
    render(<DiscoveryPage />);
    await user.click(screen.getByRole('button', { name: '管理兴趣与来源' }));
    await screen.findByText('Agent 工程化');

    await user.click(screen.getByRole('switch', { name: '暂停 Agent 工程化' }));

    expect(await screen.findByText('只有这一条')).toBeInTheDocument();
    expect(screen.queryByText('秋招信息')).not.toBeInTheDocument();
    expect(listInterests).toHaveBeenCalledTimes(2);
  });
  it('reports a rejected interest edit without inventing a saved interest', async () => {
    const user = userEvent.setup();
    changeInterest.mockResolvedValue({ok:false,data:{code:'INTEREST_NOT_FOUND',message:'Interest missing'},meta:{}});
    render(<DiscoveryPage />);
    await user.click(screen.getByRole('button', { name: '管理兴趣与来源' }));
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
    await user.click(screen.getByRole('button', { name: '管理兴趣与来源' }));
    await screen.findByText('Agent 工程化');

    await user.click(screen.getByRole('tab', { name: '内容来源' }));
    const source = screen.getByRole('switch', { name: '知乎' });
    expect(source).toHaveAttribute('aria-checked', 'true');

    await user.click(source);

    expect(updateConfiguration.mock.calls.at(-1)?.[0].payload).toEqual({ expectedRevision: 'config-1',changes:{enabledSources: []} });
    expect(await screen.findByRole('switch', { name: '知乎' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
  it('reloads a conflicting source configuration and uses its new revision on retry', async () => {
    render(<DiscoveryPage />);
    await userEvent.click(screen.getByRole('button', { name: '管理兴趣与来源' }));
    await screen.findByText('Agent 工程化');
    await userEvent.click(screen.getByRole('tab', { name: '内容来源' }));
    updateConfiguration.mockResolvedValueOnce({ ok: false, data: { code: 'REVISION_CONFLICT' } });
    getConfiguration.mockResolvedValue(ok({ ...configuration(), revision: 'config-2' }));
    await userEvent.click(screen.getByRole('switch', { name: '知乎' }));
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('switch', { name: '知乎' }));
    expect(updateConfiguration.mock.calls.at(-1)?.[0].payload.expectedRevision).toBe('config-2');
  });
  it('asks for first-supply consent once an enabled interest exists and defers without confirming', async () => {
    getConfiguration.mockResolvedValue(ok(configuration({ candidateSupplyConfirmed: false })));
    const user = userEvent.setup();
    render(<DiscoveryPage />);

    const dialog = await screen.findByRole('dialog', { name: '启用推荐' });
    expect(within(dialog).getByText(/启用后，Megumi 会将兴趣/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '暂不开始' }));

    expect(screen.queryByRole('dialog', { name: '启用推荐' })).not.toBeInTheDocument();
    expect(updateConfiguration).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '启用' })).toBeInTheDocument();
  });
  it('confirms the first supply through the Host and stops prompting', async () => {
    getConfiguration.mockResolvedValue(ok(configuration({ candidateSupplyConfirmed: false })));
    const user = userEvent.setup();
    render(<DiscoveryPage />);

    const prompt = await screen.findByRole('dialog', { name: '启用推荐' });
    await user.click(within(prompt).getByRole('button', { name: '暂不开始' }));
    await user.click(screen.getByRole('button', { name: '启用' }));
    const dialog = await screen.findByRole('dialog', { name: '启用推荐' });
    await user.click(within(dialog).getByRole('button', { name: '启用' }));

    expect(updateConfiguration).toHaveBeenCalledOnce();
    expect(updateConfiguration.mock.calls[0][0].meta.channel).toBe(
      'recommendation:update-configuration',
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '启用推荐' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: '启用' })).not.toBeInTheDocument();
  });
  it('keeps a failed confirmation open without rendering raw host details', async () => {
    getConfiguration.mockResolvedValue(ok(configuration({ candidateSupplyConfirmed: false })));
    updateConfiguration.mockResolvedValue({
      ok: false,
      data: { code: 'ipc_handler_failed', message: 'raw settings stack' },
      meta: {},
    });
    const user = userEvent.setup();
    render(<DiscoveryPage />);

    const dialog = await screen.findByRole('dialog', { name: '启用推荐' });
    await user.click(within(dialog).getByRole('button', { name: '启用' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('未能确认开始，请重试。');
    expect(dialog).not.toHaveTextContent('raw settings stack');
    expect(screen.getByRole('dialog', { name: '启用推荐' })).toBeInTheDocument();
  });
  it('does not ask for supply consent while every interest is disabled', async () => {
    listInterests.mockResolvedValue(ok({
      interests: [{ id: 'interest:2', text: '秋招信息', enabled: false, revision: 1 }],
    }));
    getConfiguration.mockResolvedValue(ok(configuration({ candidateSupplyConfirmed: false })));

    render(<DiscoveryPage />);

    await userEvent.click(screen.getByRole('button', { name: '管理兴趣与来源' }));
    expect(await screen.findByText('秋招信息')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '启用推荐' })).not.toBeInTheDocument();
    expect(updateConfiguration).not.toHaveBeenCalled();
  });
  it('reports a failed read without rendering raw host details', async () => {
    listInterests.mockResolvedValue({
      ok: false,
      data: { code: 'ipc_handler_failed', message: 'raw discovery stack' },
      meta: {},
    });

    render(<DiscoveryPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('无法加载兴趣。');
    expect(alert).not.toHaveTextContent('raw discovery stack');
    await userEvent.click(screen.getByRole('button', { name: '管理兴趣与来源' }));
    expect(screen.getByText('正在读取兴趣…')).toBeInTheDocument();
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
    revision:'config-1',config:{enabled: options.candidateSupplyConfirmed ?? true},
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
