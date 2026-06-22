// Opens the Desktop Main SQLite database used by Megumi local persistence.
import Database from 'better-sqlite3';

export type MegumiDatabase = Database.Database;

let singletonDatabase: MegumiDatabase | null = null;

export function createDatabase(filename = ':memory:'): MegumiDatabase {
  const database = new Database(filename);
  database.pragma('foreign_keys = ON');
  return database;
}

export function getDatabase(filename: string): MegumiDatabase {
  if (!singletonDatabase) {
    singletonDatabase = createDatabase(filename);
  }

  return singletonDatabase;
}

export function closeDatabase(): void {
  singletonDatabase?.close();
  singletonDatabase = null;
}
