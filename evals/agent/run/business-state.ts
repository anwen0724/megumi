/* Reads actual isolated business facts through their owning persistence contracts. */
import { createDatabase } from '@megumi/application/storage/index';
import { getDiscoveryState } from '@megumi/application/recommendation/recommendation-storage';
import { createSessionStore } from '@megumi/application/coding/sessions/session-storage';

/** Captures Session and Discovery facts without applying active-pool or other mutating read policies. */
export function getCaseBusinessState(databasePath: string, workspaceId: string) {
  const database = createDatabase({ filename: databasePath });
  try {
    const store = createSessionStore({ database });
    return database.transaction({ operation: () => ({
      discovery: getDiscoveryState(database),
      sessions: store.listSessionsByWorkspaceId(workspaceId).map((session) => {
        const messages = store.listMessagesBySessionId(session.session_id);
        return { session, messages, entries: store.listEntriesBySessionId(session.session_id),
          attachments: store.listAttachmentsByMessageIds(messages.map(({ message_id }) => message_id)),
          compactions: store.listCompactionsBySessionId(session.session_id),
        };
      }),
    }) });
  } finally { database.close(); }
}
