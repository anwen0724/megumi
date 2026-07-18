// Drizzle Kit configuration for the Agent SQLite schema.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './packages/agent/persistence/schema/drizzle-schema.ts',
  out: './packages/agent/persistence/migrations',
  dbCredentials: {
    url: './.megumi/sqlite/megumi.sqlite3',
  },
});
