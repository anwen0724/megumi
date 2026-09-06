/*
 * Verifies preference control upgrades preserve user facts and reject invalid ownership states.
 */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { createDatabase, migrateDatabase } from '@megumi/database';
import { createDiscoveryRepository } from '@megumi/discovery';
import { seedRecommendation, setReaction, now } from '../discovery/preference-learning-fixtures';

it('upgrades version 25 without losing preference identities, evidence or feedback', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-preference-control-'));
  const database = createDatabase({ filename: ':memory:' });
  try {
    const source = path.join(process.cwd(), 'packages/agent/database/migrations');
    const entries = Array.from({ length: 26 }, (_, idx) => {
      const tag = fs.readdirSync(source).find((name) => name.startsWith(String(idx).padStart(4, '0') + '_'));
      if (!tag) throw new Error(`Missing migration ${idx}`);
      fs.copyFileSync(path.join(source, tag), path.join(root, tag));
      return { idx, version: '6', when: idx + 1, tag: tag.slice(0, -4), breakpoints: true };
    });
    fs.mkdirSync(path.join(root, 'meta'));
    // Use the actual journal timestamps so the upgrade only applies subsequent migrations.
    const journal: unknown = JSON.parse(fs.readFileSync(path.join(source, 'meta/_journal.json'), 'utf8'));
    const parsed = z.object({ entries: z.array(z.object({ idx: z.number(), when: z.number() }).passthrough()) }).passthrough().parse(journal);
    fs.writeFileSync(path.join(root, 'meta/_journal.json'), JSON.stringify({ ...parsed, entries: parsed.entries.slice(0, entries.length) }));
    migrateDatabase({ database, migrationsFolder: root });
    seedRecommendation(database, 1);
    setReaction(database, 1, 'liked');
    database.prepare({ sql: "INSERT INTO discovery_preference_sets VALUES ('set:old','interest','interest:agents',4,?,?)" }).run([now, now]);
    database.prepare({ sql: "INSERT INTO discovery_preferences VALUES ('preference:old','set:old','positive','topic','实测对比',?,?)" }).run([now, now]);
    database.prepare({ sql: "INSERT INTO discovery_preference_evidence VALUES ('evidence:old','preference:old','recommendation:1',1,'liked',?)" }).run([now]);

    migrateDatabase({ database });
    const repository = createDiscoveryRepository({ database });
    expect(repository.findPreferenceById('preference:old')).toMatchObject({ id: 'preference:old', origin: 'learned', status: 'needs_review', revision: 1 });
    expect(repository.findPreferenceSetById('set:old')).toMatchObject({ revision: 4, policyRevision: 0 });
    expect(repository.findPreferenceEvidenceById('evidence:old')).toMatchObject({ relation: 'support', recommendationId: 'recommendation:1' });
    expect(repository.findRecommendationById('recommendation:1')?.state).toMatchObject({ reaction: 'liked', reactionRevision: 1, reactionSequence: 1 });
    expect(database.prepare({ sql: 'PRAGMA foreign_key_check' }).all()).toEqual([]);
    expect(() => database.prepare({ sql: "UPDATE discovery_preferences SET origin='user' WHERE id='preference:old'" }).run()).toThrow();
    expect(migrateDatabase({ database }).appliedMigrations).toBe(0);
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
