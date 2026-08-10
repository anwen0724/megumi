/* Projects only the latest Session turn for the compact Character window; it never owns history. */
import type {
  ProcessDisclosureBlock,
  TimelineMessage,
  TimelineUserMessage,
  ToolActivityItem,
} from '../session-timeline';

export interface CurrentInteraction {
  readonly runId: string;
  readonly status: ProcessDisclosureBlock['status'];
  readonly userText?: string;
  readonly replyText?: string;
  readonly activeTool?: ToolActivityItem;
  readonly approval?: ToolActivityItem;
  readonly error?: string;
}

export function projectCurrentInteraction(messages: readonly TimelineMessage[]): CurrentInteraction | null {
  let assistantIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') {
      assistantIndex = index;
      break;
    }
  }
  if (assistantIndex < 0) return null;

  const assistant = messages[assistantIndex];
  if (!assistant || assistant.role !== 'assistant') return null;
  const process = assistant.blocks.find((block): block is ProcessDisclosureBlock => block.kind === 'process_disclosure');
  const answer = [...assistant.blocks].reverse().find((block) => block.kind === 'answer_text');
  const tools = process?.items.filter((item): item is ToolActivityItem => item.kind === 'tool_activity') ?? [];
  const approval = [...tools].reverse().find((item) => item.status === 'awaiting_approval' && item.approval);
  const activeTool = approval ?? [...tools].reverse().find((item) => (
    item.status === 'requested' || item.status === 'queued' || item.status === 'running'
  ));
  const error = [...(process?.items ?? [])].reverse().find((item) => item.kind === 'error_activity');

  return {
    runId: assistant.runId,
    status: process?.status ?? (answer?.status === 'streaming' ? 'running' : answer?.status === 'failed' ? 'failed' : 'completed'),
    userText: findCurrentUserText(messages, assistantIndex),
    replyText: answer?.text || undefined,
    activeTool,
    approval,
    error: error?.kind === 'error_activity' ? error.errorMessage : undefined,
  };
}

function findCurrentUserText(messages: readonly TimelineMessage[], assistantIndex: number): string | undefined {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') continue;
    return userText(message);
  }
  return undefined;
}

function userText(message: TimelineUserMessage): string | undefined {
  const text = message.blocks
    .filter((block) => block.kind === 'user_text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  return text || undefined;
}
