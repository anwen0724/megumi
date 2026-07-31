/* Locks released Database migrations while allowing only append-only upgrades. */
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const migrationsRoot = path.join(process.cwd(), 'packages/database/migrations');
const releasedMigrationHashes = {
  '0000_database_foundation_redesign.sql': '204d76f90cf9486ac055afcfea3ab2186155f5ccf67e59ec8c73089281898f3e',
  '0001_skill_system.sql': '54754c80fdf7d031ca5912d88adf0ccf48a7eeea0d67a7287517ff5fc6519b05',
  '0002_semantic_session_messages.sql': '5f6f317b8700880c2c6130395d9a682cfe18ba8b7724200aa53038305acd195a',
  '0003_finalize_business_tables.sql': '14749d0b68a4b10697b9556ff35710bb51242939503eabbd94758d22de0fd1aa',
  '0004_agent_final_reply_messages.sql': '518e6d51fb38d04d32001aa5129ea18ba37777612589d481e87fc91b472fe824',
  '0005_skill_path_availability.sql': '96e73a058db89dccbf1cfc222bde3cda8fa3d578534fd40eedbe9175f93b345c',
  '0006_remove_artifact_memory.sql': 'f54e8a028ad4a87cab5845b10d5964f3211d058210552dc55863f65b74e3632e',
} as const;

describe('released migration baseline', () => {
  it('keeps 0000-0006 byte-for-byte immutable', () => {
    for (const [name, expectedHash] of Object.entries(releasedMigrationHashes)) {
      const bytes = fs.readFileSync(path.join(migrationsRoot, name));
      expect(createHash('sha256').update(bytes).digest('hex'), name).toBe(expectedHash);
    }
  });
});
