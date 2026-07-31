/* Verifies the driver-neutral Database connection and transaction contract. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DatabaseStatementError,
  createDatabase,
} from '../../../packages/database/src';

describe('Database connection contract', () => {
  it('binds positional and named parameters without exposing driver statements', () => {
    const database = createDatabase({ filename: ':memory:' });
    try {
      database.prepare({ sql: 'CREATE TABLE probe (id TEXT PRIMARY KEY, value BLOB NOT NULL)' }).run();
      const insert = database.prepare({ sql: 'INSERT INTO probe (id, value) VALUES (?, ?)' });
      expect(insert.run(['row:1', new Uint8Array([1, 2, 3])]).changes).toBe(1);
      database.prepare({ sql: 'INSERT INTO probe (id, value) VALUES (@id, @value)' }).run({
        id: 'row:2',
        value: new Uint8Array([4, 5]),
      });

      const row = database.prepare<{ id: string; value: Uint8Array }>({
        sql: 'SELECT id, value FROM probe WHERE id = ?',
      }).get(['row:1']);
      expect(row?.id).toBe('row:1');
      expect([...row!.value]).toEqual([1, 2, 3]);
      expect(database.prepare<{ id: string }>({ sql: 'SELECT id FROM probe ORDER BY id' }).all())
        .toEqual([{ id: 'row:1' }, { id: 'row:2' }]);
      expect('source' in insert).toBe(false);
      expect('database' in insert).toBe(false);
    } finally {
      database.close();
    }
  });

  it('commits successful transactions and rolls back failed operations', () => {
    const database = createDatabase({ filename: ':memory:' });
    try {
      database.prepare({ sql: 'CREATE TABLE probe (id TEXT PRIMARY KEY)' }).run();
      database.transaction({
        operation: () => database.prepare({ sql: 'INSERT INTO probe (id) VALUES (?)' }).run(['kept']),
      });

      expect(() => database.transaction({
        operation: () => {
          database.prepare({ sql: 'INSERT INTO probe (id) VALUES (?)' }).run(['rolled-back']);
          throw new Error('business failure');
        },
      })).toThrow('business failure');

      expect(database.prepare<{ id: string }>({ sql: 'SELECT id FROM probe ORDER BY id' }).all())
        .toEqual([{ id: 'kept' }]);
    } finally {
      database.close();
    }
  });

  it('enables foreign keys, normalizes statement errors, and closes idempotently', () => {
    const database = createDatabase({ filename: ':memory:' });
    expect(database.prepare<{ foreign_keys: number }>({ sql: 'PRAGMA foreign_keys' }).get())
      .toEqual({ foreign_keys: 1 });
    expect(() => database.prepare({ sql: 'SELECT FROM invalid' })).toThrow(DatabaseStatementError);

    database.close();
    database.close();
  });
});
