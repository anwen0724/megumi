// Drizzle Kit configuration for the Coding Agent SQLite schema.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './packages/coding-agent/persistence/schema/drizzle-schema.ts',
  out: './packages/coding-agent/persistence/migrations',
  dbCredentials: {
    url: './.megumi/sqlite/megumi.sqlite3',
  },
});
