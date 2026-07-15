import type { TimelineMessage } from '@megumi/product/runtime-timeline';

export interface BranchDraftViewInput {
  messageId: string;
  sourceKind: 'reply' | 'input';
  preview: string;
}

export function createBranchDraftViewInput(
  message: TimelineMessage,
  timelineMessages: TimelineMessage[],
): BranchDraftViewInput {
  const replyPreview = extractMessagePreview(message);
  if (replyPreview) {
    return {
      messageId: message.messageId,
      sourceKind: 'reply',
      preview: replyPreview,
    };
  }

  const sourceInput = findSourceUserInput(message, timelineMessages);
  return {
    messageId: message.messageId,
    sourceKind: 'input',
    preview: sourceInput ? extractMessagePreview(sourceInput) : '',
  };
}

function findSourceUserInput(
  message: TimelineMessage,
  timelineMessages: TimelineMessage[],
): TimelineMessage | null {
  if ('runId' in message) {
    const sameRunUserMessage = timelineMessages.find((candidate) =>
      candidate.role === 'user' && candidate.runId === message.runId,
    );
    if (sameRunUserMessage) return sameRunUserMessage;
  }

  const index = timelineMessages.findIndex((item) => item.messageId === message.messageId);
  for (let currentIndex = index - 1; currentIndex >= 0; currentIndex -= 1) {
    const candidate = timelineMessages[currentIndex];
    if (candidate?.role === 'user') return candidate;
  }
  return null;
}

function extractMessagePreview(message: TimelineMessage): string {
  const text = message.blocks
    .flatMap((block) => {
      if (block.kind === 'answer_text') return [block.text];
      if (block.kind === 'user_text') return [block.text];
      return [];
    })
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}
