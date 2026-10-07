/* Builds isolated migration chains for recommendation foundation rehearsals. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {onTestFinished} from 'vitest';

/** Opens the historical pre-switch schema only when a test explicitly seeds legacy facts. */
export function legacyMigrationFolder() {
  const directory=rehearsalFolder();
  const journalPath=path.join(directory,'meta/_journal.json');
  const journal=JSON.parse(fs.readFileSync(journalPath,'utf8'));
  journal.entries=journal.entries.filter((entry:{idx:number})=>entry.idx<=33);
  fs.writeFileSync(journalPath,JSON.stringify(journal));
  onTestFinished(()=>fs.rmSync(directory,{recursive:true,force:true}));
  return directory;
}

/** Copies the production migration chain and registers the pending migration only for a rehearsal. */
export function rehearsalFolder() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recommendation-migration-'));
  const source = path.resolve('packages/application/resources/migrations');
  fs.cpSync(source, directory, { recursive: true });
  return directory;
}
