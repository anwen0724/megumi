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
            toolUseId: 'tool-use-1',
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
  it('renders user messages as right aligned lightweight bubbles', () => {
    render(<TimelineMessage message={userMessage()} />);

    const article = screen.getByRole('article', { name: 'User message' });
    expect(article).toHaveClass('justify-end');
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('你是谁')).toBeInTheDocument();
    expect(screen.getByText('你是谁').closest('div')).toHaveClass('bg-[var(--color-accent-soft)]');
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
              toolUseId: 'tool-use-denied',
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
});
