/* Verifies local interest revisions through the management boundary. */
// @vitest-environment node
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/application/storage/index';
import { createInterestStorage } from '@megumi/application/recommendation/interests/interest-storage';
import { createInterestManagement, hashEnabledInterests } from '@megumi/application/recommendation/interests/manage-interests';
import { createCandidateStorage } from '@megumi/application/recommendation/candidates/candidate-storage';
import { afterEach, expect, it } from 'vitest';
let database: DatabaseConnection;
afterEach(() => database?.close());

it('identifies an enabled interest set by sorted identities and revisions', () => {
  const snapshot = { interests: [{ id: 'b', text: 'B', enabled: true, revision: 1 }, { id: 'disabled', text: '不参与', enabled: false, revision: 9 }, { id: 'a', text: 'A', enabled: true, revision: 2 }] };
  expect(hashEnabledInterests(snapshot)).toBe('0658e466e8922f1446a0cf87a9a2a2c43d106f93daee34f0396c06ee73707579');
});

it('keeps the revision for equal values and rejects edits based on an older revision', async () => {
  database = createDatabase({ filename: ':memory:' });
  migrateDatabase({ database });
  const interests = createInterestManagement({
    storage: createInterestStorage(database),
    newInterestId: () => 'i1',
    now: () => 100
  });
  const created = await interests.createInterest({ text: '  找工作，准备面试  ' });
  expect(created).toMatchObject({ status: 'created', interest: { text: '找工作，准备面试', revision: 1 } });
  expect(await interests.updateInterest({ interestId: 'i1', expectedRevision: 1, text: '找工作，准备面试' })).toMatchObject({ status: 'unchanged', interest: { revision: 1 } });
  expect(await interests.updateInterest({ interestId: 'i1', expectedRevision: 1, enabled: false })).toMatchObject({ status: 'updated', interest: { revision: 2 } });
  expect(await interests.updateInterest({ interestId: 'i1', expectedRevision: 1, text: '其他' })).toMatchObject({ status: 'revision_conflict' });
  expect((await interests.listInterests()).interests).toEqual([{ id: 'i1', text: '找工作，准备面试', enabled: false, revision: 2 }]);
});

it('counts Unicode code points and keeps deletion idempotent with revision conflicts', async () => {
  database = createDatabase({ filename: ':memory:' }); migrateDatabase({ database });
  const interests = createInterestManagement({
    storage: createInterestStorage(database),
    newInterestId: () => 'i1',
    now: () => 100
  });
  expect((await interests.createInterest({ text: '🙂'.repeat(1001) })).status).toBe('invalid_request');
  expect((await interests.createInterest({ text: '🙂'.repeat(1000) })).status).toBe('created');
  expect((await interests.deleteInterest({ interestId: 'i1', expectedRevision: 2 })).status).toBe('revision_conflict');
  expect((await interests.deleteInterest({ interestId: 'i1', expectedRevision: 1 })).status).toBe('deleted');
  expect((await interests.deleteInterest({ interestId: 'i1', expectedRevision: 1 })).status).toBe('already_deleted');
});

it('rejects a late match after the interest is disabled and enabled again', async () => {
  database = createDatabase({ filename: ':memory:' });
  migrateDatabase({ database });
  const interests = createInterestManagement({
    storage: createInterestStorage(database),
    newInterestId: () => 'i1',
    now: () => 100
  });
  await interests.createInterest({ text: '面试' });
  database.prepare({
    sql: "INSERT INTO contents (id,source,canonical_url,text,created_at,updated_at) VALUES ('c1','web','https://example.com/1','材料',0,0)"
  }).run();
  await interests.updateInterest({ interestId: 'i1', expectedRevision: 1, enabled: false });
  await interests.updateInterest({ interestId: 'i1', expectedRevision: 2, enabled: true });
  const committed = createCandidateStorage(database).commitRelations({
    contentId: 'c1',
    matches: [{ interestId: 'i1', expectedText: '面试', expectedRevision: 1, relation: 'direct' }],
    pools: [],
    now: 100
  });
  expect(committed.committedInterestIds).toEqual([]);
  expect(committed.skippedInterestIds).toEqual(['i1']);
});
