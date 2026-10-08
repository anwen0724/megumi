/* Owns original interest text and revision. Derived rows belong to their consumers. */
import type { DatabaseConnection, DatabaseRow } from '../../storage/index';
import type { Interest, UpdateInterestResult, DeleteInterestResult } from './interest-contracts';

interface InterestRow extends DatabaseRow {
  id: string;
  text: string;
  enabled: number;
  revision: number;
  created_at: number;
  updated_at: number;
}

export interface InterestStorage {
  /** Reads saved interests in stable creation order. */
  list(): readonly Interest[];
  /** Creates an enabled interest at revision one. */
  create(input: { id: string; text: string; now: number }): Interest;
  /** Atomically compares the saved revision before changing original state. */
  update(input: {
    interestId: string;
    expectedRevision: number;
    text?: string;
    enabled?: boolean;
    now: number;
  }): UpdateInterestResult;
  /** Removes original state; database reference rules own dependent cleanup. */
  remove(input: { interestId: string; expectedRevision: number }): DeleteInterestResult;
}

/** Creates local persistence; this boundary never calls sources or models. */
export function createInterestStorage(database: DatabaseConnection): InterestStorage {
  const read = (id: string) => {
    const row = database
      .prepare<InterestRow>({ sql: 'SELECT * FROM interests WHERE id = ?' })
      .get([id]);
    return row ? toInterest(row) : undefined;
  };
  return {
    list() {
      return database
        .prepare<InterestRow>({ sql: 'SELECT * FROM interests ORDER BY created_at, id' })
        .all()
        .map(toInterest);
    },

    create(input) {
      database
        .prepare({
          sql: 'INSERT INTO interests (id, text, enabled, revision, created_at, updated_at) VALUES (?, ?, 1, 1, ?, ?)',
        })
        .run([input.id, input.text, input.now, input.now]);
      return {
        id: input.id,
        text: input.text,
        enabled: true,
        revision: 1,
        createdAt: input.now,
        updatedAt: input.now,
      };
    },

    update(input) {
      return database.transaction({
        operation: () => {
          const current = read(input.interestId);
          if (!current) return { status: 'not_found' };
          if (current.revision !== input.expectedRevision) return { status: 'revision_conflict' };

          const text = input.text ?? current.text;
          const enabled = input.enabled ?? current.enabled;
          if (text === current.text && enabled === current.enabled)
            return {
              status: 'unchanged',
              interest: current,
            };

          database
            .prepare({
              sql: 'UPDATE interests SET text = ?, enabled = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?',
            })
            .run([text, enabled ? 1 : 0, input.now, input.interestId, input.expectedRevision]);

          return {
            status: 'updated',
            interest: {
              ...current,
              text,
              enabled,
              revision: current.revision + 1,
              updatedAt: input.now,
            },
          };
        },
      });
    },

    remove(input) {
      return database.transaction({
        operation: () => {
          const current = read(input.interestId);
          if (!current) return { status: 'already_deleted' };
          if (current.revision !== input.expectedRevision) return { status: 'revision_conflict' };

          database.prepare({ sql: 'DELETE FROM interests WHERE id = ?' }).run([input.interestId]);

          return { status: 'deleted' };
        },
      });
    },
  };
}

function toInterest(row: InterestRow): Interest {
  return {
    id: row.id,
    text: row.text,
    enabled: row.enabled === 1,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
