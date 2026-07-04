/*
 * Implements pure Session active path rules. It never reads or writes the
 * database and is not exported from the Session public entrypoint.
 */
import type { SessionEntry } from '../contracts/session-contracts';

export type BuildActivePathInput = {
  session_id: string;
  active_entry_id?: string;
  entries: SessionEntry[];
};

export function buildActivePath(input: BuildActivePathInput): SessionEntry[] {
  if (!input.active_entry_id) {
    return [];
  }

  const entriesById = new Map(input.entries.map((entry) => [entry.entry_id, entry]));
  const path: SessionEntry[] = [];
  const seen = new Set<string>();
  let currentId: string | undefined = input.active_entry_id;

  while (currentId) {
    if (seen.has(currentId)) {
      throw new Error(`Cycle detected in session active path for ${input.session_id}: ${currentId}`);
    }
    seen.add(currentId);

    const entry = entriesById.get(currentId);
    if (!entry) {
      throw new Error(`Active path parent entry ${currentId} was not found in session ${input.session_id}`);
    }
    if (entry.session_id !== input.session_id) {
      throw new Error(`Active path entry ${entry.entry_id} does not belong to session ${input.session_id}`);
    }

    path.unshift(entry);
    currentId = entry.parent_entry_id;
  }

  return path;
}

export function validateSessionEntry(entry: SessionEntry): { status: 'ok' } | { status: 'failed'; message: string } {
  if (entry.entry_type === 'message') {
    return entry.message_id && !entry.compaction_id
      ? { status: 'ok' }
      : { status: 'failed', message: 'message entry must have message_id and must not have compaction_id' };
  }

  return entry.compaction_id && !entry.message_id
    ? { status: 'ok' }
    : { status: 'failed', message: 'compaction entry must have compaction_id and must not have message_id' };
}
