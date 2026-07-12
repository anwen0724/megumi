/*
 * Projects Session-owned message pairs and Agent Run-owned transcripts into complete Context turns.
 */
import type { ContentBlock } from '@megumi/ai';
import type { RunModelTranscript } from '../../../agent-run';
import type {
  SessionHistoryItem,
  SessionMessageAttachment,
} from '../../../session';
import type { ConversationTurn } from '../../domain/model/conversation-turn';

export type BuildConversationTurnsRequest = {
  history: SessionHistoryItem[];
  transcriptsByRunId: ReadonlyMap<string, RunModelTranscript>;
};

export type ConversationTurnBuildFailure = {
  code: 'invalid_historical_turn' | 'missing_historical_transcript';
  message: string;
  runId?: string;
};

export type BuildConversationTurnsResult =
  | { status: 'built'; turns: ConversationTurn[] }
  | { status: 'failed'; failure: ConversationTurnBuildFailure };

type MessageHistoryItem = Extract<SessionHistoryItem, { type: 'message' }>;

export function buildConversationTurns(
  request: BuildConversationTurnsRequest,
): BuildConversationTurnsResult {
  const messages = historyAfterEffectiveCompaction(request.history).filter(
    (item): item is MessageHistoryItem => item.type === 'message',
  );
  const turns: ConversationTurn[] = [];

  for (let index = 0; index < messages.length; index += 2) {
    const user = messages[index];
    const assistant = messages[index + 1];
    const validationFailure = validateMessagePair(user, assistant);
    if (validationFailure) return { status: 'failed', failure: validationFailure };

    const runId = user.message.run_id!;
    const transcript = request.transcriptsByRunId.get(runId);
    if (!transcript || transcript.runId !== runId) {
      return {
        status: 'failed',
        failure: {
          code: 'missing_historical_transcript',
          runId,
          message: `Completed historical run ${runId} has no usable transcript.`,
        },
      };
    }

    turns.push({
      source: {
        runId,
        userEntryId: user.entry.entry_id,
        userMessageId: user.message.message_id,
        assistantEntryId: assistant.entry.entry_id,
        assistantMessageId: assistant.message.message_id,
      },
      userMessage: {
        type: 'user_message',
        content: messageContent(user.message.content_text, user.attachments),
      },
      responseItems: [
        ...transcript.items,
        {
          type: 'assistant_message',
          content: [{ type: 'text', text: assistant.message.content_text }],
        },
      ],
    });
  }

  return { status: 'built', turns };
}

function validateMessagePair(
  user: MessageHistoryItem | undefined,
  assistant: MessageHistoryItem | undefined,
): ConversationTurnBuildFailure | undefined {
  if (!user || user.message.role !== 'user' || !user.message.run_id) {
    return invalidHistory('Historical messages must start with a User Message carrying a runId.');
  }
  if (!assistant || assistant.message.role !== 'assistant') {
    return invalidHistory(
      `Historical run ${user.message.run_id} is missing its final Assistant Message.`,
      user.message.run_id,
    );
  }
  if (assistant.message.run_id !== user.message.run_id) {
    return invalidHistory(
      `Historical User and Assistant Messages do not share runId ${user.message.run_id}.`,
      user.message.run_id,
    );
  }
  return undefined;
}

function invalidHistory(message: string, runId?: string): ConversationTurnBuildFailure {
  return { code: 'invalid_historical_turn', message, ...(runId ? { runId } : {}) };
}

function messageContent(
  text: string,
  attachments: SessionMessageAttachment[],
): ContentBlock[] {
  return [
    { type: 'text', text },
    ...attachments.map(attachmentContent),
  ];
}

function historyAfterEffectiveCompaction(
  history: SessionHistoryItem[],
): SessionHistoryItem[] {
  // The last compaction on the active path is the effective rolling Summary.
  // Earlier messages are already represented by it and must not be sent twice.
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].type === 'compaction') return history.slice(index + 1);
  }
  return history;
}

function attachmentContent(attachment: SessionMessageAttachment): ContentBlock {
  if (attachment.type === 'image') {
    return {
      type: 'image',
      source: attachment.source_type === 'local_file'
        ? { type: 'local_file', path: attachment.source_value }
        : { type: 'host_reference', referenceId: attachment.source_value },
    };
  }

  return {
    type: 'file',
    // fileId is the canonical Session attachment identity. Host/AI resolves its
    // Session-owned source later without leaking source fields into ContentBlock.
    fileId: attachment.attachment_id,
    ...(attachment.name ? { name: attachment.name } : {}),
    ...(attachment.mime_type ? { mediaType: attachment.mime_type } : {}),
  };
}
