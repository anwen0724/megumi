// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  TimelineAssistantMessage,
  TimelineActivityMessage,
  TimelineSeparatorMessage,
  TimelineUserMessage,
} from '@megumi/coding-agent/projections/timeline';
import { TimelineMessage } from '@megumi/desktop/renderer/features/chat/components/TimelineMessage';
import { WorkspaceChangeFooter } from '@megumi/desktop/renderer/features/chat/components/WorkspaceChangeFooter';
import { ToastViewport, useToastStore } from '@megumi/desktop/renderer/shared/ui';

const createdAt = '2026-05-24T12:00:00.000Z';

beforeEach(() => {
  useToastStore.getState().clearToasts();
});

afterEach(() => {
  vi.restoreAllMocks();
  useToastStore.getState().clearToasts();
});

function userMessage(): TimelineUserMessage {
  return {
    messageId: 'message-user-1',
    role: 'user',
    projectId: 'project-1',
    sessionId: 'session-1',
    createdAt,
    blocks: [{
      blockId: 'user-text-1',
      kind: 'user_text',
      text: '你是谁',
      format: 'plain',
    }],
  };
}

function assistantMessage(overrides: Partial<TimelineAssistantMessage> = {}): TimelineAssistantMessage {
  return {
    messageId: 'assistant:run-1',
    role: 'assistant',
    projectId: 'project-1',
    sessionId: 'session-1',
    runId: 'run-1',
    createdAt,
    blocks: [
      {
        blockId: 'process:run-1',
        kind: 'process_disclosure',
        runId: 'run-1',
        status: 'completed',
        startedAt: '2026-05-24T12:00:00.000Z',
        endedAt: '2026-05-24T12:00:03.000Z',
        items: [
          {
            itemId: 'thinking:thinking-1',
            kind: 'thinking',
            thinkingId: 'thinking-1',
            status: 'completed',
            text: 'The user is asking about identity.',
            format: 'plain',
          },
          {
            itemId: 'prelude:text-prelude-1',
            kind: 'assistant_text',
            textId: 'text-prelude-1',
            phase: 'prelude',
            status: 'completed',
            text: '让我看看。',
            format: 'markdown',
          },
          {
            itemId: 'tool:tool-use-1',
            kind: 'tool_activity',
            toolCallId: 'tool-use-1',
            toolName: 'read_file',
            inputSummary: 'docs/README.md',
            resultSummary: '读取成功',
            status: 'succeeded',
          },
          {
            itemId: 'approval:approval-1',
            kind: 'approval_activity',
            approvalId: 'approval-1',
            scope: 'run',
            status: 'approved',
            title: 'run_command npm test',
            subjectSummary: 'npm test',
          },
        ],
      },
      {
        blockId: 'answer:run-1',
        kind: 'answer_text',
        runId: 'run-1',
        textId: 'text-answer-1',
        status: 'completed',
        text: '你好！我是 **Megumi**。\n\n- 可以读项目\n- 可以运行工具',
        format: 'markdown',
      },
    ],
    ...overrides,
  };
}

describe('TimelineMessage canonical block rendering', () => {
  it('renders user text and user attachment blocks from session timeline facts', () => {
    render(<TimelineMessage message={{
      ...userMessage(),
      blocks: [
        {
          blockId: 'user-text-1',
          kind: 'user_text',
          text: '解释这张图',
          format: 'plain',
        },
        {
          blockId: 'user-attachment-1',
          kind: 'user_attachment',
          attachmentId: 'attachment-1',
          name: 'error.png',
          mediaType: 'image/png',
          sizeBytes: 1024,
          source: 'screenshot',
        },
      ],
    }} />);

    expect(screen.getByText('解释这张图')).toBeInTheDocument();
    expect(screen.getByText('error.png')).toBeInTheDocument();
  });

  it('renders branch separators from session branch facts', () => {
    const separator: TimelineSeparatorMessage = {
      messageId: 'separator:branch-marker-1',
      role: 'separator',
      projectId: 'project-1',
      sessionId: 'session-1',
      createdAt,
      blocks: [{
        blockId: 'branch-separator:branch-marker-1',
        kind: 'branch_separator',
        branchMarkerId: 'branch-marker-1',
        sourceMessageId: 'message-user-1',
        label: 'Branch from 00:57',
      }],
    };

    render(<TimelineMessage message={separator} />);

    expect(screen.getByRole('separator', { name: 'Branch from 00:57' })).toBeInTheDocument();
    expect(screen.getByText('Branch from 00:57')).toBeInTheDocument();
  });

  it('renders workspace change footer outside timeline message blocks', () => {
    render(<TimelineMessage
      message={assistantMessage()}
      afterContent={<WorkspaceChangeFooter
        footer={{
          runId: 'run-1',
          sessionId: 'session-1',
          updatedAt: '2026-06-06T10:00:01.000Z',
          changeSets: [{
            changeSetId: 'workspace-change-set-1',
            changedFileCount: 1,
            files: [{
              changedFileId: 'workspace-changed-file-1',
              workspacePath: 'src/app.ts',
              changeKind: 'modified',
            }],
          }],
        }}
        onOpenFile={() => undefined}
      />}
    />);

    expect(screen.getByLabelText('Workspace changes for this turn')).toBeInTheDocument();
    expect(document.querySelector('[data-workspace-open-file-row="true"]')).toBeInTheDocument();
    expect(document.querySelector('[data-workspace-change-file-row="true"]')).toBeInTheDocument();
    expect(screen.getByText('app.ts')).toBeInTheDocument();
  });

  it('renders a Session compaction activity as an independent Timeline row', () => {
    const activity: TimelineActivityMessage = {
      messageId: 'session-compaction:request-1',
      role: 'activity',
      projectId: 'project-1',
      sessionId: 'session-1',
      createdAt,
      blocks: [{
        blockId: 'session-compaction-activity:request-1',
        kind: 'session_compaction_activity',
        activityId: 'request-1',
        status: 'running',
        label: '正在压缩上下文',
      }],
    };

    render(<TimelineMessage message={activity} />);

    expect(screen.getByRole('status', { name: '正在压缩上下文' })).toBeInTheDocument();
    expect(screen.getByText('正在压缩上下文')).toBeInTheDocument();
    expect(screen.queryByText('Megumi')).not.toBeInTheDocument();
  });

  it('renders user messages as a lightweight right aligned card with the time below', () => {
    render(<TimelineMessage message={userMessage()} />);

    const article = screen.getByRole('article', { name: 'User message' });
    const text = screen.getByText('你是谁');
    const time = article.querySelector('time');

    expect(article).toHaveClass('justify-end');
    expect(screen.queryByText('You')).not.toBeInTheDocument();
    expect(text).toBeInTheDocument();
    expect(article.textContent).toContain('你是谁');
    expect([...article.querySelectorAll('*')].some((element) =>
      element.classList.contains('bg-[var(--color-accent-soft)]'),
    )).toBe(true);
    expect(text.closest('[data-testid="user-message-card"]')).toHaveClass('rounded-md');
    expect(time).toHaveAttribute('dateTime', createdAt);
    expect(text.compareDocumentPosition(time!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('keeps assistant content width stable without widening user bubbles', () => {
    const { rerender } = render(<TimelineMessage message={assistantMessage({
      blocks: [{
        blockId: 'process:run-1',
        kind: 'process_disclosure',
        runId: 'run-1',
        status: 'running',
        startedAt: '2026-05-24T12:00:00.000Z',
        items: [],
      }],
    })} />);

    const assistantArticle = screen.getByRole('article', { name: 'Megumi message' });
    expect(assistantArticle.firstElementChild).toHaveClass('w-full');
    expect(assistantArticle.firstElementChild).toHaveClass('max-w-3xl');

    rerender(<TimelineMessage message={userMessage()} />);

    const userArticle = screen.getByRole('article', { name: 'User message' });
    expect(userArticle.firstElementChild).not.toHaveClass('w-full');
    expect(userArticle.firstElementChild).toHaveClass('max-w-3xl');
  });

  it('uses focus-thread motion classes without adding a timeline rail or assistant card', () => {
    render(<TimelineMessage message={assistantMessage()} />);

    const article = screen.getByRole('article', { name: 'Megumi message' });
    expect(article).toHaveClass('animate-[megumi-message-in_160ms_ease-out]');
    expect(article.firstElementChild).toHaveClass('w-full');
    expect(article.firstElementChild).not.toHaveClass('rounded-lg');
    expect(article.querySelector('[data-testid="timeline-rail"]')).toBeNull();
  });

  it('renders completed process disclosure collapsed before final answer', () => {
    render(<TimelineMessage message={assistantMessage()} />);

    const article = screen.getByRole('article', { name: 'Megumi message' });
    const disclosure = within(article).getByRole('button', { name: /Expand process disclosure/ });
    const articleText = article.textContent ?? '';

    expect(disclosure).toHaveTextContent('Processed');
    expect(disclosure).not.toHaveTextContent('live');
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(articleText.indexOf('Processed')).toBeLessThan(articleText.indexOf('你好！我是'));
    expect(article).not.toHaveTextContent('Answer started');
    expect(article).not.toHaveTextContent('model.step.completed');
    expect(article).not.toHaveTextContent('TOOL CALLS');
  });

  it('keeps active thinking expanded and collapses it after completion', () => {
    const { rerender } = render(<TimelineMessage message={assistantMessage({
      blocks: [
        {
          blockId: 'process:run-1',
          kind: 'process_disclosure',
          runId: 'run-1',
          status: 'running',
          startedAt: '2026-05-24T12:00:00.000Z',
          items: [{
            itemId: 'thinking:thinking-1',
            kind: 'thinking',
            thinkingId: 'thinking-1',
            status: 'streaming',
            text: 'The user is asking about identity.',
            format: 'plain',
            createdAt: '2026-05-24T12:00:01.000Z',
            updatedAt: '2026-05-24T12:00:01.000Z',
          }],
        },
      ],
    })} />);

    let thinkingToggle = screen.getByRole('button', { name: /Collapse thinking item/ });
    expect(thinkingToggle).toHaveTextContent('Thinking');
    expect(thinkingToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('The user is asking about identity.')).toBeInTheDocument();

    rerender(<TimelineMessage message={assistantMessage({
      blocks: [
        {
          blockId: 'process:run-1',
          kind: 'process_disclosure',
          runId: 'run-1',
          status: 'completed',
          startedAt: '2026-05-24T12:00:00.000Z',
          endedAt: '2026-05-24T12:00:03.000Z',
          items: [{
            itemId: 'thinking:thinking-1',
            kind: 'thinking',
            thinkingId: 'thinking-1',
            status: 'completed',
            text: 'The user is asking about identity.',
            format: 'plain',
            createdAt: '2026-05-24T12:00:01.000Z',
            updatedAt: '2026-05-24T12:00:03.000Z',
          }],
        },
      ],
    })} />);

    fireEvent.click(screen.getByRole('button', { name: /Expand process disclosure/ }));

    thinkingToggle = screen.getByRole('button', { name: /Expand thinking item/ });
    expect(thinkingToggle).toHaveTextContent('Thinking complete');
    expect(thinkingToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('The user is asking about identity.')).not.toBeInTheDocument();

    fireEvent.click(thinkingToggle);
    expect(screen.getByText('The user is asking about identity.')).toBeInTheDocument();
  });

  it('supports completed process disclosure while the answer is still streaming', () => {
    render(<TimelineMessage message={assistantMessage({
      blocks: [
        {
          blockId: 'process:run-1',
          kind: 'process_disclosure',
          runId: 'run-1',
          status: 'completed',
          startedAt: '2026-05-24T12:00:00.000Z',
          endedAt: '2026-05-24T12:00:03.000Z',
          items: [],
        },
        {
          blockId: 'answer:run-1',
          kind: 'answer_text',
          runId: 'run-1',
          textId: 'text-answer-1',
          status: 'streaming',
          text: '正在流式输出最终回复',
          format: 'markdown',
        },
      ],
    })} />);

    expect(screen.getByRole('button', { name: /Expand process disclosure/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('正在流式输出最终回复')).toBeInTheDocument();
    expect(screen.queryByText('Streaming')).not.toBeInTheDocument();
  });

  it('wraps long unbroken process and answer text without widening the timeline', () => {
    const longProcessText = `context:${'x'.repeat(180)}:${'y'.repeat(180)}`;
    const longAnswerText = `result:${'a'.repeat(180)}:${'b'.repeat(180)}`;

    render(<TimelineMessage message={assistantMessage({
      blocks: [
        {
          blockId: 'process:run-1',
          kind: 'process_disclosure',
          runId: 'run-1',
          status: 'running',
          startedAt: '2026-05-24T12:00:00.000Z',
          items: [{
            itemId: 'thinking:thinking-1',
            kind: 'thinking',
            thinkingId: 'thinking-1',
            status: 'streaming',
            text: longProcessText,
            format: 'plain',
          }],
        },
        {
          blockId: 'answer:run-1',
          kind: 'answer_text',
          runId: 'run-1',
          textId: 'text-answer-1',
          status: 'completed',
          text: longAnswerText,
          format: 'markdown',
        },
      ],
    })} />);

    expect(screen.getByText(longProcessText)).toHaveClass('break-words');
    expect(screen.getByText(longProcessText)).toHaveClass('[overflow-wrap:anywhere]');
    expect(screen.getByText(longAnswerText).closest('p')).toHaveClass('break-words');
    expect(screen.getByText(longAnswerText).closest('p')).toHaveClass('[overflow-wrap:anywhere]');
  });

  it('does not reset a manually collapsed running process disclosure on answer text rerender', () => {
    const { rerender } = render(<TimelineMessage message={assistantMessage({
      blocks: [
        {
          blockId: 'process:run-1',
          kind: 'process_disclosure',
          runId: 'run-1',
          status: 'running',
          startedAt: '2026-05-24T12:00:00.000Z',
          items: [{
            itemId: 'tool:tool-use-1',
            kind: 'tool_activity',
            toolCallId: 'tool-use-1',
            toolName: 'read_file',
            inputSummary: 'docs/README.md',
            status: 'running',
          }],
        },
        {
          blockId: 'answer:run-1',
          kind: 'answer_text',
          runId: 'run-1',
          textId: 'text-answer-1',
          status: 'streaming',
          text: 'First chunk',
          format: 'markdown',
        },
      ],
    })} />);

    const disclosure = screen.getByRole('button', { name: /Collapse process disclosure/ });
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(disclosure);
    expect(screen.getByRole('button', { name: /Expand process disclosure/ })).toHaveAttribute('aria-expanded', 'false');

    rerender(<TimelineMessage message={assistantMessage({
      blocks: [
        {
          blockId: 'process:run-1',
          kind: 'process_disclosure',
          runId: 'run-1',
          status: 'running',
          startedAt: '2026-05-24T12:00:00.000Z',
          items: [{
            itemId: 'tool:tool-use-1',
            kind: 'tool_activity',
            toolCallId: 'tool-use-1',
            toolName: 'read_file',
            inputSummary: 'docs/README.md',
            status: 'running',
          }],
        },
        {
          blockId: 'answer:run-1',
          kind: 'answer_text',
          runId: 'run-1',
          textId: 'text-answer-1',
          status: 'streaming',
          text: 'First chunk plus second chunk',
          format: 'markdown',
        },
      ],
    })} />);

    expect(screen.getByRole('button', { name: /Expand process disclosure/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders external model-visible tool activity without canonical identity', () => {
    render(<TimelineMessage message={assistantMessage({
      blocks: [
        {
          blockId: 'process:run-1',
          kind: 'process_disclosure',
          runId: 'run-1',
          status: 'running',
          startedAt: '2026-06-14T12:00:00.000Z',
          items: [{
            itemId: 'tool:tool-call-demo-echo',
            kind: 'tool_activity',
            toolCallId: 'tool-call-demo-echo',
            toolExecutionId: 'tool-execution-demo-echo',
            toolResultId: 'tool-result-demo-echo',
            toolName: 'demo_echo',
            displayName: 'Demo echo',
            inputSummary: 'hello',
            resultSummary: 'hello',
            status: 'succeeded',
          }],
        },
      ],
    })} />);

    expect(screen.getByText('Completed hello')).toBeInTheDocument();
    expect(screen.queryByText('external_test:demo:echo')).not.toBeInTheDocument();
  });

  it('renders built-in tool activity with tool-specific labels and hides raw result summaries', () => {
    render(<TimelineMessage message={assistantMessage({
      blocks: [
        {
          blockId: 'process:run-1',
          kind: 'process_disclosure',
          runId: 'run-1',
          status: 'completed',
          startedAt: '2026-06-14T12:00:00.000Z',
          endedAt: '2026-06-14T12:00:03.000Z',
          items: [
            {
              itemId: 'tool:list-directory',
              kind: 'tool_activity',
              toolCallId: 'tool-call-list-directory',
              toolName: 'list_directory',
              inputSummary: '工作区目录',
              resultSummary: '{"path":".","entries":[{"name":"README.md"}]}',
              status: 'succeeded',
            },
            {
              itemId: 'tool:read-file',
              kind: 'tool_activity',
              toolCallId: 'tool-call-read-file',
              toolName: 'read_file',
              inputSummary: 'Claude自我介绍.md',
              resultSummary: '# Claude 自我介绍',
              status: 'succeeded',
            },
            {
              itemId: 'tool:glob',
              kind: 'tool_activity',
              toolCallId: 'tool-call-glob',
              toolName: 'glob',
              inputSummary: '**/*.md',
              status: 'succeeded',
            },
            {
              itemId: 'tool:search',
              kind: 'tool_activity',
              toolCallId: 'tool-call-search',
              toolName: 'search_text',
              inputSummary: 'Spring Boot',
              status: 'succeeded',
            },
            {
              itemId: 'tool:edit',
              kind: 'tool_activity',
              toolCallId: 'tool-call-edit',
              toolName: 'edit_file',
              inputSummary: 'README.md',
              status: 'succeeded',
            },
            {
              itemId: 'tool:write',
              kind: 'tool_activity',
              toolCallId: 'tool-call-write',
              toolName: 'write_file',
              inputSummary: 'notes.md',
              status: 'succeeded',
            },
            {
              itemId: 'tool:command',
              kind: 'tool_activity',
              toolCallId: 'tool-call-command',
              toolName: 'run_command',
              inputSummary: 'npm test',
              status: 'succeeded',
            },
          ],
        },
      ],
    })} />);

    fireEvent.click(screen.getByRole('button', { name: /Expand process disclosure/ }));

    expect(screen.getByText('Viewed 工作区目录')).toBeInTheDocument();
    expect(screen.getByText('Read Claude自我介绍.md')).toBeInTheDocument();
    expect(screen.getByText('Found **/*.md')).toBeInTheDocument();
    expect(screen.getByText('Searched Spring Boot')).toBeInTheDocument();
    expect(screen.getByText('Edited README.md')).toBeInTheDocument();
    expect(screen.getByText('Wrote notes.md')).toBeInTheDocument();
    expect(screen.getByText('Ran command npm test')).toBeInTheDocument();
    expect(screen.queryByText(/"entries"/)).not.toBeInTheDocument();
    expect(screen.queryByText('# Claude 自我介绍')).not.toBeInTheDocument();
  });

  it('renders italic markdown in answer text without literal delimiters', () => {
    render(<TimelineMessage message={assistantMessage({
      blocks: [
        {
          blockId: 'answer:run-1',
          kind: 'answer_text',
          runId: 'run-1',
          textId: 'text-answer-1',
          status: 'completed',
          text: '这是 *斜体* 文本',
          format: 'markdown',
        },
      ],
    })} />);

    expect(screen.getByText('斜体').tagName).toBe('EM');
    expect(screen.queryByText('*斜体*')).not.toBeInTheDocument();
  });

  it('only makes allowed markdown link schemes clickable', () => {
    render(<TimelineMessage message={assistantMessage({
      blocks: [
        {
          blockId: 'answer:run-1',
          kind: 'answer_text',
          runId: 'run-1',
          textId: 'text-answer-1',
          status: 'completed',
          text: [
            '[safe](https://example.com/docs)',
            '[mail](mailto:hello@example.com)',
            '[script](javascript:alert(1))',
            '[file](file:///C:/secret.txt)',
            '[custom](vscode://file/C:/secret.txt)',
          ].join(' '),
          format: 'markdown',
        },
      ],
    })} />);

    expect(screen.getByRole('link', { name: 'safe' })).toHaveAttribute('href', 'https://example.com/docs');
    expect(screen.getByRole('link', { name: 'mail' })).toHaveAttribute('href', 'mailto:hello@example.com');
    expect(screen.queryByRole('link', { name: 'script' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'file' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'custom' })).not.toBeInTheDocument();
    expect(screen.getByText('script')).toBeInTheDocument();
    expect(screen.getByText('file')).toBeInTheDocument();
    expect(screen.getByText('custom')).toBeInTheDocument();
  });

  it('does not use success icons for denied or rejected approval process states', () => {
    render(<TimelineMessage message={assistantMessage({
      blocks: [
        {
          blockId: 'process:run-1',
          kind: 'process_disclosure',
          runId: 'run-1',
          status: 'running',
          startedAt: '2026-05-24T12:00:00.000Z',
          items: [
            {
              itemId: 'tool:tool-use-denied',
              kind: 'tool_activity',
              toolCallId: 'tool-use-denied',
              toolName: 'read_file',
              inputSummary: 'C:/secret.txt',
              status: 'denied',
            },
            {
              itemId: 'approval:approval-rejected',
              kind: 'approval_activity',
              approvalId: 'approval-rejected',
              scope: 'run',
              status: 'rejected',
              title: 'run_command rm -rf',
            },
            {
              itemId: 'approval:approval-expired',
              kind: 'approval_activity',
              approvalId: 'approval-expired',
              scope: 'run',
              status: 'expired',
              title: 'run_command npm test',
            },
            {
              itemId: 'approval:approval-cancelled',
              kind: 'approval_activity',
              approvalId: 'approval-cancelled',
              scope: 'run',
              status: 'cancelled',
              title: 'run_command npm install',
            },
          ],
        },
      ],
    })} />);

    for (const label of [
      'Declined to read C:/secret.txt',
      'Declined run_command rm -rf',
      'Approval expired: run_command npm test',
      'Approval cancelled: run_command npm install',
    ]) {
      const row = screen.getByText(label).closest('div');
      expect(row?.querySelector('svg')?.getAttribute('class')).not.toContain('text-[var(--color-success)]');
    }
  });

  it('renders compaction retry and recovery process items without collapsing them into the top label', () => {
    render(<TimelineMessage message={assistantMessage({
      blocks: [{
        blockId: 'process:run-1',
        kind: 'process_disclosure',
        runId: 'run-1',
        status: 'completed',
        startedAt: '2026-06-01T10:00:00.000Z',
        endedAt: '2026-06-01T10:00:04.000Z',
        items: [
          {
            itemId: 'compaction:1',
            kind: 'compaction_activity',
            status: 'completed',
            label: 'Compacted context',
          },
          {
            itemId: 'retry:1',
            kind: 'retry_activity',
            retryAttemptId: 'retry-1',
            attemptNumber: 1,
            status: 'failed',
            label: 'Retry attempt 1 failed',
            reason: 'rate_limited',
          },
          {
            itemId: 'recovery:1',
            kind: 'recovery_activity',
            status: 'interrupted',
            label: 'Previous run was interrupted',
          },
        ],
      }],
    })} />);

    const disclosure = screen.getByRole('button', { name: /Expand process disclosure/ });
    expect(disclosure).toHaveTextContent('Processed');
    expect(disclosure).not.toHaveTextContent('Compacted context');
    expect(screen.queryByText(/Compacted .* Retrying/)).not.toBeInTheDocument();

    fireEvent.click(disclosure);
    expect(screen.getByText('Context compacted')).toBeInTheDocument();
    expect(screen.getByText('Retry attempt 1 failed')).toBeInTheDocument();
    expect(screen.getByText('rate_limited')).toBeInTheDocument();
    expect(screen.getByText('Previous run was interrupted')).toBeInTheDocument();
  });

  it('renders all runtime process item kinds inside the process disclosure', () => {
    render(<TimelineMessage message={assistantMessage({
      blocks: [
        {
          blockId: 'process:run-1',
          kind: 'process_disclosure',
          runId: 'run-1',
          status: 'completed',
          startedAt: '2026-06-01T10:00:00.000Z',
          endedAt: '2026-06-01T10:00:04.000Z',
          items: [
            {
              itemId: 'thinking:1',
              kind: 'thinking',
              thinkingId: 'thinking-1',
              status: 'completed',
              text: 'I should inspect the workspace.',
              format: 'plain',
            },
            {
              itemId: 'tool:1',
              kind: 'tool_activity',
              toolCallId: 'tool-call-1',
              toolName: 'read_file',
              inputSummary: 'README.md',
              resultSummary: 'Read file.',
              status: 'succeeded',
            },
            {
              itemId: 'approval:1',
              kind: 'approval_activity',
              approvalId: 'approval-1',
              scope: 'once',
              status: 'approved',
              title: 'Read file',
              subjectSummary: 'README.md',
            },
            {
              itemId: 'error:1',
              kind: 'error_activity',
              errorCode: 'provider_failed',
              errorMessage: 'Provider failed.',
              recoverable: true,
            },
            {
              itemId: 'cancelled:1',
              kind: 'cancelled_activity',
              reason: 'user_requested',
            },
            {
              itemId: 'compaction:1',
              kind: 'compaction_activity',
              compactionId: 'compaction-1',
              status: 'completed',
              label: 'Compacted context',
            },
            {
              itemId: 'retry:1',
              kind: 'retry_activity',
              retryAttemptId: 'retry-1',
              attemptNumber: 1,
              status: 'completed',
              label: 'Model call retry 1 completed',
            },
            {
              itemId: 'recovery:1',
              kind: 'recovery_activity',
              status: 'interrupted',
              label: 'Run was interrupted',
            },
          ],
        },
        {
          blockId: 'answer:run-1',
          kind: 'answer_text',
          runId: 'run-1',
          textId: 'text-answer-1',
          status: 'completed',
          text: 'Final answer.',
          format: 'markdown',
        },
      ],
    })} />);

    fireEvent.click(screen.getByRole('button', { name: /Expand process disclosure/ }));

    expect(screen.getByText('Thinking complete')).toBeInTheDocument();
    expect(screen.getByText('Read README.md')).toBeInTheDocument();
    expect(screen.getByText('Approved Read file')).toBeInTheDocument();
    expect(screen.getByText('Provider failed.')).toBeInTheDocument();
    expect(screen.getByText('user_requested')).toBeInTheDocument();
    expect(screen.getByText('Context compacted')).toBeInTheDocument();
    expect(screen.getByText('Model call retry 1 completed')).toBeInTheDocument();
    expect(screen.getByText('Run was interrupted')).toBeInTheDocument();
    expect(screen.getByText('Final answer.')).toBeInTheDocument();
  });

  it('does not use success icons for failed retry or non-success recovery process states', () => {
    render(<TimelineMessage message={assistantMessage({
      blocks: [{
        blockId: 'process:run-1',
        kind: 'process_disclosure',
        runId: 'run-1',
        status: 'running',
        startedAt: '2026-06-01T10:00:00.000Z',
        items: [
          {
            itemId: 'retry:failed',
            kind: 'retry_activity',
            retryAttemptId: 'retry-failed',
            attemptNumber: 1,
            status: 'failed',
            label: 'Retry attempt 1 failed',
          },
          {
            itemId: 'retry:exhausted',
            kind: 'retry_activity',
            retryAttemptId: 'retry-exhausted',
            attemptNumber: 2,
            status: 'exhausted',
            label: 'Retry attempts exhausted',
          },
          {
            itemId: 'recovery:interrupted',
            kind: 'recovery_activity',
            status: 'interrupted',
            label: 'Previous run was interrupted',
          },
          {
            itemId: 'recovery:marked-cancelled',
            kind: 'recovery_activity',
            status: 'marked_cancelled',
            label: 'Run marked cancelled',
          },
        ],
      }],
    })} />);

    for (const label of [
      'Retry attempt 1 failed',
      'Retry attempts exhausted',
      'Previous run was interrupted',
      'Run marked cancelled',
    ]) {
      const row = screen.getByText(label).closest('div');
      expect(row?.querySelector('svg')?.getAttribute('class')).not.toContain('text-[var(--color-success)]');
    }
  });

  it('keeps rendering safe blocks when one answer block is malformed', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <>
        <ToastViewport />
        <TimelineMessage message={assistantMessage({
          blocks: [
            {
              blockId: 'answer-bad',
              kind: 'answer_text',
              runId: 'run-1',
              textId: 'text-bad',
              status: 'completed',
              text: undefined,
              format: 'markdown',
              createdAt,
            } as never,
            {
              blockId: 'answer-1',
              kind: 'answer_text',
              runId: 'run-1',
              textId: 'text-1',
              status: 'completed',
              text: 'Final answer remains visible.',
              format: 'markdown',
              createdAt,
            },
          ],
        })} />
      </>,
    );

    expect(screen.getByText('Final answer remains visible.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Assistant response could not be displayed');
  });
});

