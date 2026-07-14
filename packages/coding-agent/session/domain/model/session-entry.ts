/* Defines Session Entry Graph and compaction facts. */
import type { SessionMessage } from './session-message';
import type { SessionMessageAttachment } from './session-attachment';

export type SessionEntry = {
  entry_id: string;
  session_id: string;
  parent_entry_id?: string;
  entry_type: 'message' | 'compaction';
  message_id?: string;
  compaction_id?: string;
  created_at: string;
};

export type SessionCompactionSummary = {
  compaction_id: string;
  session_id: string;
  summary_text: string;
  covered_until_entry_id: string;
  first_kept_entry_id?: string;
  created_at: string;
};

export type SessionHistoryItem =
  | {
      type: 'message';
      entry: SessionEntry;
      message: SessionMessage;
      attachments: SessionMessageAttachment[];
    }
  | {
      type: 'compaction';
      entry: SessionEntry;
      compaction: SessionCompactionSummary;
    };
