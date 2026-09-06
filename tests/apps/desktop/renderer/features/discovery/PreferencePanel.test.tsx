/*
 * Verifies preference corrections preserve drafts and require an explicit deletion action.
 */
// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreferencePanel } from '@megumi/desktop/renderer/features/discovery/components/PreferencePanel';
import { initializeRendererI18n } from '@megumi/desktop/renderer/shared/i18n';

const getPreferenceDetails = vi.fn();
const editPreference = vi.fn();
const deletePreference = vi.fn();
beforeEach(async () => {
  await initializeRendererI18n('zh-CN');
  getPreferenceDetails.mockReset().mockResolvedValue({ ok: true, data: { details: { hasPendingLearning: true, scope: { scope: 'interest', interestId: 'i' }, preferences: [{ validity: 'effective', preference: { id: 'p', origin: 'learned', revision: 1, statement: '实测评测' } }] } } });
  editPreference.mockReset().mockResolvedValue({ ok: true, data: { status: 'revision_conflict' } });
  deletePreference.mockReset().mockResolvedValue({ ok: true, data: { status: 'deleted' } });
  Object.defineProperty(window, 'megumi', { configurable: true, value: { discovery: { getPreferenceDetails, editPreference, deletePreference } } });
});

it('waits for deletion confirmation and then refreshes the visible list', async () => {
  const user = userEvent.setup();
  render(<PreferencePanel scope={{ scope: 'interest', interestId: 'i' }} />);
  await user.click(screen.getByRole('button', { name: '内容偏好' }));
  await user.click(await screen.findByRole('button', { name: '删除' }));
  expect(deletePreference).not.toHaveBeenCalled();
  expect(screen.getByText(/原反馈保留/)).toBeInTheDocument();
  getPreferenceDetails.mockResolvedValueOnce({ ok: true, data: { details: { hasPendingLearning: true, scope: { scope: 'interest', interestId: 'i' }, preferences: [] } } });
  await user.click(screen.getByRole('button', { name: '确认删除偏好' }));
  expect(await screen.findByText('尚未形成偏好')).toBeInTheDocument();
  expect(deletePreference.mock.calls[0][0].payload).toEqual({ preferenceId: 'p', expectedRevision: 1 });
});

it('loads only when expanded and preserves the edit draft after a version conflict', async () => {
  const user = userEvent.setup();
  render(<PreferencePanel scope={{ scope: 'interest', interestId: 'i' }} />);
  expect(getPreferenceDetails).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '内容偏好' }));
  expect(await screen.findByText('将在下次推荐时更新')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '编辑' }));
  const editor = screen.getByRole('textbox', { name: '偏好描述' });
  await user.clear(editor);
  await user.type(editor, '保留用户原话');
  await user.click(screen.getByRole('button', { name: '保存修改' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('内容已变化');
  expect(editor).toHaveValue('保留用户原话');
});
