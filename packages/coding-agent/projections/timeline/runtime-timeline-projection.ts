import type { RuntimeEvent } from '../../events';
import type {
  AnswerTextBlock,
  ApprovalActivityItem,
  AssistantTextItem,
  CancelledActivityItem,
  CompactionActivityItem,
  ErrorActivityItem,
  ProcessDisclosureBlock,
  RecoveryActivityItem,
  RetryActivityItem,
  ThinkingItem,
  TimelineAssistantMessage,
  TimelineMessage,
  ToolActivityItem,
} from './timeline-message-blocks';

/*
 * Projects backend RuntimeEvent envelopes into the chat timeline model.
 * The renderer consumes this directly; no secondary event adapter layer is involved.
 */
export function reduceRuntimeTimelineEvent(
  messages: TimelineMessage[],
  event: RuntimeEvent,
): TimelineMessage[] {
  const nextMessages = cloneMessages(messages);

  if (!event.runId || !event.sessionId) {
    return nextMessages;
  }

  if (event.eventType === 'run.started') {
    const assistant = ensureAssistantMessage(nextMessages, event);
    ensureProcessBlock(assistant, event).status = 'running';
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'model_call.started') {
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    process.status = 'running';
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'model_call.text_delta') {
    const payload = event.payload as { modelCallId?: string; delta?: string };
    const assistant = ensureAssistantMessage(nextMessages, event);
    if (hasCompletedAnswerBlock(assistant)) {
      assistant.updatedAt = event.createdAt;
      return nextMessages;
    }
    const answer = ensureAnswerBlock(assistant, event, payload.modelCallId ?? event.runId);
    answer.text += payload.delta ?? '';
    answer.status = 'streaming';
    answer.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'model.thinking.started') {
    const payload = event.payload as { modelStepId?: string };
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureThinkingItem(process, payload.modelStepId ?? event.eventId, event.createdAt);
    item.status = 'streaming';
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'model.thinking.delta') {
    const payload = event.payload as { modelStepId?: string; delta?: string };
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureThinkingItem(process, payload.modelStepId ?? event.eventId, event.createdAt);
    item.text += payload.delta ?? '';
    item.status = 'streaming';
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'model.thinking.completed') {
    const payload = event.payload as { modelStepId?: string };
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureThinkingItem(process, payload.modelStepId ?? event.eventId, event.createdAt);
    item.status = 'completed';
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'model_call.tool_call') {
    const payload = event.payload as {
      toolCallId?: string;
      toolName?: string;
      input?: unknown;
      modelCallId?: string;
    };
    const assistant = ensureAssistantMessage(nextMessages, event);
    moveAnswerIntoProcess(assistant, event, payload.modelCallId ?? event.runId);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureToolItem(process, payload.toolCallId ?? event.eventId, event.createdAt);
    item.toolName = payload.toolName ?? 'unknown_tool';
    item.inputSummary = summarizeToolTarget(item.toolName, payload.input);
    item.status = 'running';
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'tool_call.started') {
    const payload = event.payload as { toolCallId?: string; toolExecutionId?: string; toolName?: string; input?: unknown };
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureToolItem(process, payload.toolCallId ?? event.eventId, event.createdAt);
    item.toolExecutionId = payload.toolExecutionId;
    item.toolName = payload.toolName ?? item.toolName;
    item.inputSummary = item.inputSummary ?? summarizeToolTarget(item.toolName, payload.input);
    item.status = 'running';
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'tool_call.completed' || event.eventType === 'tool_call.failed') {
    const payload = event.payload as { toolCallId?: string; toolExecutionId?: string; toolName?: string; error?: { message?: string } };
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureToolItem(process, payload.toolCallId ?? event.eventId, event.createdAt);
    item.toolExecutionId = payload.toolExecutionId;
    item.toolName = payload.toolName ?? item.toolName;
    item.status = event.eventType === 'tool_call.completed' ? 'succeeded' : 'failed';
    item.resultSummary = payload.error?.message ?? item.resultSummary;
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'tool_result.created') {
    const payload = event.payload as {
      toolCallId?: string;
      toolExecutionId?: string;
      toolResultId?: string;
      toolName?: string;
      kind?: string;
      summary?: string;
    };
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureToolItem(process, payload.toolCallId ?? event.eventId, event.createdAt);
    item.toolExecutionId = payload.toolExecutionId;
    item.toolResultId = payload.toolResultId;
    item.toolName = payload.toolName ?? item.toolName;
    item.status = payload.kind === 'success' ? 'succeeded' : payload.kind === 'policy_denied' || payload.kind === 'user_rejected' ? 'denied' : 'failed';
    item.resultSummary = undefined;
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'approval.requested') {
    const payload = event.payload as {
      approvalRequest?: {
        approvalRequestId?: string;
        toolCallId?: string;
        toolExecutionId?: string;
        requestedScope?: string;
        title?: string;
        summary?: string;
        preview?: { action?: string };
      };
    };
    const approval = payload.approvalRequest;
    const approvalId = approval?.approvalRequestId ?? event.eventId;
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureApprovalItem(process, approvalId, event.createdAt);
    item.toolCallId = approval?.toolCallId;
    item.toolExecutionId = approval?.toolExecutionId;
    item.scope = approval?.requestedScope ?? item.scope;
    item.status = 'pending';
    item.title = approval?.title ?? approval?.preview?.action ?? item.title;
    item.description = approval?.summary ?? item.description;
    item.subjectSummary = approval?.summary ?? item.subjectSummary;
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'approval.resolved') {
    const payload = event.payload as { approvalRequestId?: string; decision?: string; scope?: string };
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureApprovalItem(process, payload.approvalRequestId ?? event.eventId, event.createdAt);
    item.status = approvalStatusFromDecision(payload.decision);
    item.scope = payload.scope ?? item.scope;
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'context.compaction.started'
    || event.eventType === 'context.compaction.completed'
    || event.eventType === 'context.compaction.failed') {
    const payload = event.payload as { compactionId?: string; error?: { message?: string } };
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureCompactionItem(process, payload.compactionId ?? event.eventId, event.createdAt);
    item.status = event.eventType === 'context.compaction.completed' ? 'completed' : 'boundary_unresolved';
    item.label = compactionLabel(event.eventType, payload.error?.message);
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'retry.started'
    || event.eventType === 'retry.completed'
    || event.eventType === 'retry.failed') {
    const payload = event.payload as { retryRequestId?: string; error?: { message?: string } };
    const retryRequestId = payload.retryRequestId ?? event.eventId;
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureRetryItem(process, retryRequestId, event.createdAt);
    item.status = retryStatusFromEvent(event.eventType);
    item.label = retryLabel(event.eventType, item.attemptNumber);
    item.reason = payload.error?.message;
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'run.interrupted'
    || event.eventType === 'run.resume.requested'
    || event.eventType === 'run.resumed'
    || event.eventType === 'run.resume.failed') {
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureRecoveryItem(process, `recovery:${event.eventType}:${event.eventId}`, event.createdAt);
    item.status = recoveryStatusFromEvent(event.eventType);
    item.label = recoveryLabel(event.eventType, (event.payload as { error?: { message?: string } }).error?.message);
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'model_call.completed') {
    const payload = event.payload as { modelCallId?: string; finishReason?: string };
    const assistant = ensureAssistantMessage(nextMessages, event);
    const answer = findAnswerBlock(assistant, payload.modelCallId ?? event.runId);
    if (answer && payload.finishReason !== 'tool_calls') {
      answer.status = payload.finishReason === 'failed' ? 'failed' : 'completed';
      answer.updatedAt = event.createdAt;
    }
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'run.completed') {
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const answer = assistant.blocks.find((block): block is AnswerTextBlock => block.kind === 'answer_text');
    process.status = 'completed';
    process.endedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    if (answer) {
      answer.status = 'completed';
      answer.updatedAt = event.createdAt;
    }
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'run.failed' || event.eventType === 'run.cancelled') {
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    if (event.eventType === 'run.failed') {
      const payload = event.payload as { error?: { code?: string; message?: string; retryable?: boolean } };
      process.items.push({
        itemId: `error:${event.eventId}`,
        kind: 'error_activity',
        errorCode: payload.error?.code,
        errorMessage: payload.error?.message ?? 'Run failed.',
        recoverable: payload.error?.retryable,
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
      });
    } else {
      const payload = event.payload as { reason?: string; error?: { message?: string } };
      process.items.push({
        itemId: `cancelled:${event.eventId}`,
        kind: 'cancelled_activity',
        reason: payload.reason ?? payload.error?.message,
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
      });
    }
    process.status = event.eventType === 'run.failed' ? 'failed' : 'cancelled';
    process.endedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  return nextMessages;
}

function cloneMessages(messages: TimelineMessage[]): TimelineMessage[] {
  return JSON.parse(JSON.stringify(messages)) as TimelineMessage[];
}

function ensureAssistantMessage(messages: TimelineMessage[], event: RuntimeEvent): TimelineAssistantMessage {
  const existing = messages.find(
    (message): message is TimelineAssistantMessage =>
      message.role === 'assistant' && message.runId === event.runId,
  );
  if (existing) return existing;

  const assistant: TimelineAssistantMessage = {
    messageId: event.messageId ?? `assistant:${event.runId}`,
    role: 'assistant',
    projectId: 'runtime',
    sessionId: event.sessionId ?? 'session:unknown',
    runId: event.runId ?? event.eventId,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    turnOrder: 1,
    blocks: [],
  };
  messages.push(assistant);
  return assistant;
}

function ensureProcessBlock(assistant: TimelineAssistantMessage, event: RuntimeEvent): ProcessDisclosureBlock {
  const existing = assistant.blocks.find((block): block is ProcessDisclosureBlock => block.kind === 'process_disclosure');
  if (existing) return existing;
  const block: ProcessDisclosureBlock = {
    blockId: `process:${event.runId}`,
    kind: 'process_disclosure',
    runId: event.runId ?? event.eventId,
    status: 'running',
    startedAt: event.createdAt,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    items: [],
  };
  assistant.blocks.unshift(block);
  return block;
}

function ensureAnswerBlock(
  assistant: TimelineAssistantMessage,
  event: RuntimeEvent,
  textId: string,
): AnswerTextBlock {
  const existing = findAnswerBlock(assistant, textId);
  if (existing) return existing;
  const block: AnswerTextBlock = {
    blockId: `answer:${event.runId}`,
    kind: 'answer_text',
    runId: event.runId ?? event.eventId,
    textId: `text:${textId}`,
    status: 'streaming',
    text: '',
    format: 'markdown',
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
  };
  assistant.blocks.push(block);
  return block;
}

function findAnswerBlock(assistant: TimelineAssistantMessage, textId: string): AnswerTextBlock | undefined {
  return assistant.blocks.find(
    (block): block is AnswerTextBlock =>
      block.kind === 'answer_text' && (block.textId === `text:${textId}` || block.runId === textId),
  );
}

function moveAnswerIntoProcess(assistant: TimelineAssistantMessage, event: RuntimeEvent, textId: string): void {
  const answer = findAnswerBlock(assistant, textId);
  if (!answer || !answer.text || answer.status === 'completed') return;

  const process = ensureProcessBlock(assistant, event);
  const item: AssistantTextItem = {
    itemId: `prelude:${textId}`,
    kind: 'assistant_text',
    textId: `prelude:${textId}`,
    phase: 'prelude',
    status: 'completed',
    text: answer.text,
    format: 'markdown',
    createdAt: answer.createdAt,
    updatedAt: event.createdAt,
  };
  process.items.push(item);
  assistant.blocks = assistant.blocks.filter((block) => block !== answer);
}

function hasCompletedAnswerBlock(assistant: TimelineAssistantMessage): boolean {
  return assistant.blocks.some(
    (block) => block.kind === 'answer_text' && block.status === 'completed',
  );
}

function ensureToolItem(process: ProcessDisclosureBlock, toolCallId: string, createdAt: string): ToolActivityItem {
  const existing = process.items.find(
    (item): item is ToolActivityItem => item.kind === 'tool_activity' && item.toolCallId === toolCallId,
  );
  if (existing) return existing;
  const item: ToolActivityItem = {
    itemId: `tool:${toolCallId}`,
    kind: 'tool_activity',
    toolCallId,
    toolName: 'unknown_tool',
    status: 'running',
    createdAt,
    updatedAt: createdAt,
  };
  process.items.push(item);
  return item;
}

function ensureThinkingItem(process: ProcessDisclosureBlock, thinkingId: string, createdAt: string): ThinkingItem {
  const existing = process.items.find(
    (item): item is ThinkingItem => item.kind === 'thinking' && item.thinkingId === thinkingId,
  );
  if (existing) return existing;
  const item: ThinkingItem = {
    itemId: `thinking:${thinkingId}`,
    kind: 'thinking',
    thinkingId,
    status: 'streaming',
    text: '',
    format: 'plain',
    createdAt,
    updatedAt: createdAt,
  };
  process.items.push(item);
  return item;
}

function ensureApprovalItem(process: ProcessDisclosureBlock, approvalId: string, createdAt: string): ApprovalActivityItem {
  const existing = process.items.find(
    (item): item is ApprovalActivityItem => item.kind === 'approval_activity' && item.approvalId === approvalId,
  );
  if (existing) return existing;
  const item: ApprovalActivityItem = {
    itemId: `approval:${approvalId}`,
    kind: 'approval_activity',
    approvalId,
    scope: 'once',
    status: 'pending',
    title: 'Approval required',
    createdAt,
    updatedAt: createdAt,
  };
  process.items.push(item);
  return item;
}

function ensureCompactionItem(process: ProcessDisclosureBlock, compactionId: string, createdAt: string): CompactionActivityItem {
  const existing = process.items.find(
    (item): item is CompactionActivityItem => item.kind === 'compaction_activity' && item.compactionId === compactionId,
  );
  if (existing) return existing;
  const item: CompactionActivityItem = {
    itemId: `compaction:${compactionId}`,
    kind: 'compaction_activity',
    compactionId,
    status: 'boundary_unresolved',
    label: 'Compacting context',
    createdAt,
    updatedAt: createdAt,
  };
  process.items.push(item);
  return item;
}

function ensureRetryItem(process: ProcessDisclosureBlock, retryRequestId: string, createdAt: string): RetryActivityItem {
  const existing = process.items.find(
    (item): item is RetryActivityItem => item.kind === 'retry_activity' && item.retryAttemptId === retryRequestId,
  );
  if (existing) return existing;
  const item: RetryActivityItem = {
    itemId: `retry:${retryRequestId}`,
    kind: 'retry_activity',
    retryAttemptId: retryRequestId,
    attemptNumber: retryAttemptNumber(retryRequestId),
    status: 'started',
    label: 'Model call retry started',
    createdAt,
    updatedAt: createdAt,
  };
  process.items.push(item);
  return item;
}

function ensureRecoveryItem(process: ProcessDisclosureBlock, itemId: string, createdAt: string): RecoveryActivityItem {
  const existing = process.items.find(
    (item): item is RecoveryActivityItem => item.kind === 'recovery_activity' && item.itemId === itemId,
  );
  if (existing) return existing;
  const item: RecoveryActivityItem = {
    itemId,
    kind: 'recovery_activity',
    status: 'interrupted',
    label: 'Run recovery event',
    createdAt,
    updatedAt: createdAt,
  };
  process.items.push(item);
  return item;
}

function approvalStatusFromDecision(decision: string | undefined): ApprovalActivityItem['status'] {
  if (decision === 'approved') return 'approved';
  if (decision === 'rejected' || decision === 'denied') return 'rejected';
  if (decision === 'expired') return 'expired';
  if (decision === 'cancelled') return 'cancelled';
  return 'approved';
}

function compactionLabel(eventType: RuntimeEvent['eventType'], failureMessage: string | undefined): string {
  if (eventType === 'context.compaction.completed') return 'Compacted context';
  if (eventType === 'context.compaction.failed') return failureMessage ? `Context compaction failed: ${failureMessage}` : 'Context compaction failed';
  return 'Compacting context';
}

function retryStatusFromEvent(eventType: RuntimeEvent['eventType']): RetryActivityItem['status'] {
  if (eventType === 'retry.completed') return 'completed';
  if (eventType === 'retry.failed') return 'failed';
  return 'started';
}

function retryLabel(eventType: RuntimeEvent['eventType'], attemptNumber: number): string {
  if (eventType === 'retry.completed') return `Model call retry ${attemptNumber} completed`;
  if (eventType === 'retry.failed') return `Model call retry ${attemptNumber} failed`;
  return `Model call retry ${attemptNumber} started`;
}

function retryAttemptNumber(retryRequestId: string): number {
  const last = retryRequestId.split(':').at(-1);
  const parsed = Number.parseInt(last ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function recoveryStatusFromEvent(eventType: RuntimeEvent['eventType']): RecoveryActivityItem['status'] {
  if (eventType === 'run.interrupted') return 'interrupted';
  if (eventType === 'run.resume.failed') return 'marked_cancelled';
  return 'manual_retry_requested';
}

function recoveryLabel(eventType: RuntimeEvent['eventType'], failureMessage: string | undefined): string {
  if (eventType === 'run.interrupted') return 'Run was interrupted';
  if (eventType === 'run.resume.requested') return 'Run resume requested';
  if (eventType === 'run.resumed') return 'Run resumed';
  return failureMessage ? `Run resume failed: ${failureMessage}` : 'Run resume failed';
}

function summarizeToolTarget(toolName: string, input: unknown): string | undefined {
  const data = isRecord(input) ? input : {};
  if (toolName === 'list_directory') return displayPath(stringField(data, 'path'));
  if (toolName === 'read_file') return displayPath(stringField(data, 'path'));
  if (toolName === 'glob') return stringField(data, 'pattern');
  if (toolName === 'search_text') return stringField(data, 'query');
  if (toolName === 'edit_file') return displayPath(stringField(data, 'path'));
  if (toolName === 'write_file') return displayPath(stringField(data, 'path'));
  if (toolName === 'run_command') return stringField(data, 'command');
  return undefined;
}

function displayPath(path: string | undefined): string | undefined {
  if (!path || path === '.') return '工作区目录';
  return path;
}

function stringField(data: Record<string, unknown>, field: string): string | undefined {
  const value = data[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
