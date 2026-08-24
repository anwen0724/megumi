// Drizzle Kit configuration for the product Database schema.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './packages/agent/database/src/database-schema.ts',
  out: './packages/agent/database/migrations',
  dbCredentials: {
    url: './.megumi/sqlite/megumi.sqlite3',
  },
});
