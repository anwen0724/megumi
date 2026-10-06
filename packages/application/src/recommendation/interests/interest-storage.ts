/*
 * Owns the `interests` table plus the matches and queries bound to one
 * interest's identity. A change that alters the description or the enabled
 * state clears that interest's matches and retires its active queries in the
 * same transaction, so no caller has to assemble a half-saved interest change.
 */
import type { DatabaseConnection, DatabaseRow } from '../../storage/index';
import type { Interest } from './interest-contracts';

interface InterestRow extends DatabaseRow {
  readonly id: string;
  readonly text: string;
  readonly enabled: number;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface InterestStorage {
  list(): readonly Interest[];
  create(input: { id: string; text: string; now: number }): Interest;
  /** Returns the saved interest, or undefined when the id is unknown. */
  update(input: { id: string; text?: string; enabled?: boolean; now: number }): Interest | undefined;
  /** Returns false when the id is unknown. */
  remove(id: string): boolean;
}

export function createInterestStorage(database: DatabaseConnection): InterestStorage {
  return {
    list() {
      return database
        .prepare<InterestRow>({
          sql: 'SELECT id, text, enabled, created_at, updated_at FROM interests ORDER BY created_at, id',
        })
        .all()
        .map(toInterest);
    },

    create(input) {
      database
        .prepare({
          sql: 'INSERT INTO interests (id, text, enabled, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
        })
        .run([input.id, input.text, input.now, input.now]);
      return {
        id: input.id,
        text: input.text,
        enabled: true,
        createdAt: input.now,
        updatedAt: input.now,
      };
    },

    update(input) {
      const current = readInterest(database, input.id);
      if (!current) return undefined;
      const text = input.text ?? current.text;
      const enabled = input.enabled ?? current.enabled;
      if (text === current.text && enabled === current.enabled) return current;

      database.transaction({
        operation: () => {
          database
            .prepare({
              sql: 'UPDATE interests SET text = ?, enabled = ?, updated_at = ? WHERE id = ?',
            })
            .run([text, enabled ? 1 : 0, input.now, input.id]);
          clearInterestRelations(database, input.id);
        },
      });
      return { ...current, text, enabled, updatedAt: input.now };
    },

    remove(id) {
      if (!readInterest(database, id)) return false;
      database.transaction({
        operation: () => {
          clearInterestRelations(database, id);
          database.prepare({ sql: 'DELETE FROM interests WHERE id = ?' }).run([id]);
        },
      });
      return true;
    },
  };
}

/**
 * Drops every saved relation for one interest and retires its active queries.
 * Search history keeps its rows: the query rows stay as `retired` records.
 */
function clearInterestRelations(database: DatabaseConnection, interestId: string): void {
  database
    .prepare({ sql: 'DELETE FROM content_interest_matches WHERE interest_id = ?' })
    .run([interestId]);
  database
    .prepare({
      sql: "UPDATE search_queries SET status = 'retired', interest_id = NULL WHERE interest_id = ? AND status = 'active'",
    })
    .run([interestId]);
}

function readInterest(database: DatabaseConnection, id: string): Interest | undefined {
  const row = database
    .prepare<InterestRow>({
      sql: 'SELECT id, text, enabled, created_at, updated_at FROM interests WHERE id = ?',
    })
    .get([id]);
  return row ? toInterest(row) : undefined;
}

function toInterest(row: InterestRow): Interest {
  return {
    id: row.id,
    text: row.text,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
