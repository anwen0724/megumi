// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TimelineAssistantMessage, TimelineUserMessage } from '@megumi/shared/timeline-message-blocks';
import { TimelineMessage } from '@megumi/desktop/renderer/features/chat/components/TimelineMessage';

const createdAt = '2026-05-24T12:00:00.000Z';

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
  it('renders user messages as right aligned plain text with the time below', () => {
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
    )).toBe(false);
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
    expect(assistantArticle.firstElementChild).toHaveClass('max-w-2xl');

    rerender(<TimelineMessage message={userMessage()} />);

    const userArticle = screen.getByRole('article', { name: 'User message' });
    expect(userArticle.firstElementChild).not.toHaveClass('w-full');
    expect(userArticle.firstElementChild).toHaveClass('max-w-2xl');
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

    expect(disclosure).toHaveTextContent('已处理');
    expect(disclosure).not.toHaveTextContent('live');
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(articleText.indexOf('已处理')).toBeLessThan(articleText.indexOf('你好！我是'));
    expect(article).not.toHaveTextContent('Answer started');
    expect(article).not.toHaveTextContent('model.step.completed');
    expect(article).not.toHaveTextContent('TOOL CALLS');
  });

  it('expands process disclosure and keeps thinking items collapsed by default', () => {
    render(<TimelineMessage message={assistantMessage()} />);

    fireEvent.click(screen.getByRole('button', { name: /Expand process disclosure/ }));

    expect(screen.getByText('让我看看。')).toBeInTheDocument();
    expect(screen.getByText('已读取 docs/README.md')).toBeInTheDocument();
    expect(screen.getByText('已批准 run_command npm test')).toBeInTheDocument();

    const thinkingToggle = screen.getByRole('button', { name: /Expand thinking item/ });
    expect(thinkingToggle).toHaveTextContent('思考完成');
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
      '已拒绝 C:/secret.txt',
      '已拒绝 run_command rm -rf',
      '审批已过期 run_command npm test',
      '审批已取消 run_command npm install',
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
    expect(disclosure).toHaveTextContent('已处理');
    expect(disclosure).not.toHaveTextContent('Compacted context');
    expect(screen.queryByText(/Compacted .* Retrying/)).not.toBeInTheDocument();

    fireEvent.click(disclosure);
    expect(screen.getByText('Compacted context')).toBeInTheDocument();
    expect(screen.getByText('Retry attempt 1 failed')).toBeInTheDocument();
    expect(screen.getByText('rate_limited')).toBeInTheDocument();
    expect(screen.getByText('Previous run was interrupted')).toBeInTheDocument();
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
});
