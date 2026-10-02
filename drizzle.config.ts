// Drizzle Kit configuration for the product Database schema.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './packages/application/src/storage/database-schema.ts',
  out: './packages/application/resources/migrations',
  dbCredentials: {
    url: './.megumi/sqlite/megumi.sqlite3',
  },
});
