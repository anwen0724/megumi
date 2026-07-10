// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TimelineAssistantMessage } from '@megumi/coding-agent/projections/timeline';
import { MessageColumn } from '@megumi/desktop/renderer/features/chat/layout/MessageColumn';

describe('MessageColumn', () => {
  it('renders workspace change footer from canonical workspacePath facts', () => {
    render(
      <MessageColumn
        timelineMessages={[assistantMessageWithFooter()]}
        bottomSpacerHeight={0}
        canShowBranchAction={() => false}
        onBranchFromMessage={() => undefined}
        onOpenWorkspaceChangedFile={vi.fn()}
      />,
    );

    expect(screen.getByRole('region', { name: '本轮工作区变更' })).toBeInTheDocument();
    expect(screen.getByText('已改动 1 个文件')).toBeInTheDocument();
    expect(screen.getAllByText('hollow-world.md').length).toBeGreaterThanOrEqual(1);
  });

  it('renders assistant message actions below the message content and copies the reply text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const onBranchFromMessage = vi.fn();
    render(
      <MessageColumn
        timelineMessages={[assistantMessageWithFooter()]}
        bottomSpacerHeight={0}
        canShowBranchAction={() => true}
        onBranchFromMessage={onBranchFromMessage}
        onOpenWorkspaceChangedFile={vi.fn()}
      />,
    );

    const article = screen.getByRole('article', { name: 'Megumi message' });
    const actions = within(article).getByTestId('assistant-message-actions');
    expect(article.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(within(actions).getByRole('button', { name: 'Copy reply' }));
    expect(writeText).toHaveBeenCalledWith('文件写好了。');

    await userEvent.click(within(actions).getByRole('button', { name: 'Branch from this reply' }));
    expect(onBranchFromMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'message-assistant-1',
    }));
  });
});

function assistantMessageWithFooter(): TimelineAssistantMessage {
  return {
    messageId: 'message-assistant-1',
    role: 'assistant',
    projectId: 'workspace-1',
    sessionId: 'session-1',
    runId: 'run-1',
    createdAt: '2026-07-09T03:13:25.326Z',
    blocks: [{
      blockId: 'answer:message-assistant-1',
      kind: 'answer_text',
      runId: 'run-1',
      textId: 'text:message-assistant-1',
      status: 'completed',
      text: '文件写好了。',
      format: 'markdown',
    }],
    workspaceChangeFooter: {
      runId: 'run-1',
      sessionId: 'session-1',
      updatedAt: '2026-07-09T03:13:25.335Z',
      changeSets: [{
        changeSetId: 'workspace-change-set-1',
        changedFileCount: 1,
        files: [{
          changedFileId: 'workspace-changed-file-1',
          workspacePath: 'hollow-world.md',
          changeKind: 'created',
        }],
      }],
    },
  };
}
