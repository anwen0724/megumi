/* Builds isolated migration chains for recommendation foundation rehearsals. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Copies the production migration chain and registers the pending migration only for a rehearsal. */
export function rehearsalFolder() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recommendation-migration-'));
  const source = path.resolve('packages/application/resources/migrations');
  fs.cpSync(source, directory, { recursive: true });
  const journalPath = path.join(directory, 'meta/_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  journal.entries.push({
    idx: 34,
    version: '6',
    when: 1791500000000,
    tag: '0034_recommendation_foundation',
    breakpoints: true
  });
  const pending = path.join(source, 'pending/0034_recommendation_foundation.sql');
  fs.writeFileSync(path.join(directory, '0034_recommendation_foundation.sql'), fs.readFileSync(pending));
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  return directory;
}
