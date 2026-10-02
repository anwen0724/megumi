/* Verifies recommendation admission and publication through the real shared runtime and storage. */
// @vitest-environment node
import type { DatabaseConnection } from '@megumi/application/storage/index';
import {
  createRecommendations,
  createSourceRegistry,
  type CreateRecommendationsOptions,
  type DiscoverySource,
} from '@megumi/application/discovery/index';
import { expect, it, onTestFinished, vi } from 'vitest';
import { createRuntimeFixture } from '../agent-runtime/runtime-fixture';
import { controlModelHttp, modelResponse } from '../agent-runtime/model-http-fixture';

const now = '2026-09-03T00:00:00.000Z';

it('waits for candidates without making a model request', async () => {
  const { business, http } = await setup(0);
  expect(await business.generate({ trigger: 'manual' })).toEqual({
    status: 'waiting_for_candidates',
    localDate: '2026-09-03',
  });
  expect(business.getToday()).toMatchObject({ status: 'waiting_for_candidates' });
  expect(http.requests).toHaveLength(0);
});

it('prepares preferences only after admission and exposes the preparation phase', async () => {
  const gate = Promise.withResolvers<void>();
  const { business, fixture, http } = await setup(0, {
    preparePreferences: async () => gate.promise,
  });
  onTestFinished(() => gate.resolve());
  await business.generate({ trigger: 'manual' });
  expect(business.getToday()).toMatchObject({ status: 'waiting_for_candidates' });
  seedCandidate(fixture.database, 1);
  expect(await business.generate({ trigger: 'manual' })).toMatchObject({
    status: 'started',
    phase: 'preparing_preferences',
  });
  expect(business.getToday()).toMatchObject({ status: 'running', phase: 'preparing_preferences' });
  expect(http.requests).toHaveLength(0);
  gate.resolve();
  await http.waitForRequest();
  expect(business.getToday()).toMatchObject({ status: 'running', phase: 'executing' });
});

it('rechecks locally when candidates arrive and keeps only one active run', async () => {
  const scheduled: Array<() => void> = [];
  const { business, fixture, http } = await setup(0, {
    timers: {
      setTimeout(callback) {
        scheduled.push(callback);
        return callback;
      },
      clearTimeout(handle) {
        const i = scheduled.indexOf(handle as () => void);
        if (i >= 0) scheduled.splice(i, 1);
      },
    },
  });
  await business.generate({ trigger: 'manual' });
  seedCandidate(fixture.database, 1);
  scheduled.shift()?.();
  await http.waitForRequest();
  expect(business.getToday()).toMatchObject({ status: 'running' });
  expect(await business.generate({ trigger: 'manual' })).toMatchObject({ status: 'in_progress' });
  expect(http.requests).toHaveLength(1);
});

it('joins concurrent requests during runtime admission', async () => {
  const { business, fixture } = await setup(1);
  const options = optionsFor(fixture);
  const joined = createRecommendations(options);
  onTestFinished(() => joined.shutdown());
  const first = joined.generate({ trigger: 'manual' });
  const second = joined.generate({ trigger: 'manual' });
  const accepted = await first;
  expect(accepted.status).toBe('started');
  expect(await second).toMatchObject({ status: 'in_progress', requestId: 'request:1' });
});

it.each(['shutdown', 'next_day'] as const)('discards waiting on %s', async (boundary) => {
  const scheduled: Array<() => void> = [];
  let currentTime = now;
  const { business, http } = await setup(0, {
    clock: { now: () => currentTime },
    timers: {
      setTimeout(callback) {
        scheduled.push(callback);
        return callback;
      },
      clearTimeout(handle) {
        const i = scheduled.indexOf(handle as () => void);
        if (i >= 0) scheduled.splice(i, 1);
      },
    },
  });
  await business.generate({ trigger: 'manual' });
  if (boundary === 'shutdown') await business.shutdown();
  else currentTime = '2026-09-04T00:00:00.000Z';
  scheduled.shift()?.();
  expect(scheduled).toHaveLength(0);
  expect(http.requests).toHaveLength(0);
});

it('does not restore manual waiting on restart before the scheduled time', async () => {
  const { fixture, business, http } = await setup(0);
  await business.generate({ trigger: 'manual' });
  await business.shutdown();
  const restarted = createRecommendations(optionsFor(fixture));
  onTestFinished(() => restarted.shutdown());
  await restarted.start();
  expect(restarted.getToday()).toMatchObject({ status: 'not_generated' });
  expect(http.requests).toHaveLength(0);
});

it('does not launch a model request after shutdown during model resolution', async () => {
  const { fixture, http } = await setup(1);
  const business = createRecommendations(optionsFor(fixture));
  const accepted = business.generate({ trigger: 'manual' });
  await business.shutdown();
  expect(await accepted).toMatchObject({ status: 'failed' });
  expect(http.requests).toHaveLength(0);
});

it('publishes the configured ordered selection after successful run completion', async () => {
  const { fixture, business, http } = await setup(3);
  const accepted = await business.generate({ trigger: 'manual' });
  if (accepted.status !== 'started') throw new Error('Expected admission');
  await http.waitForRequest();
  expect(fixture.recommendationAttempts.getSnapshot(accepted.executionId!)).toMatchObject({
    actualTarget: 2,
    workingSetCount: 2,
  });
  http.respond(modelResponse(selection));
  expect(await business.wait({ requestId: accepted.requestId, timeoutMs: 2000 })).toMatchObject({
    status: 'published',
    collection: {
      items: [{ candidateId: 'candidate:1' }, { candidateId: 'candidate:2' }],
    },
  });
  expect(fixture.runtime.getRun(accepted.executionId!)?.status).toBe('completed');
  expect(fixture.recommendationAttempts.getSnapshot(accepted.executionId!)).toBeUndefined();
  expect(http.requests).toHaveLength(1);
});

it('allows correction of an invalid selection before accepting the draft', async () => {
  const { business, http } = await setup(2);
  const accepted = await business.generate({ trigger: 'manual' });
  if (accepted.status !== 'started') throw new Error('Expected admission');
  http.respond(
    modelResponse({
      name: 'submit_recommendations',
      arguments: { items: [{ candidateId: 'candidate:1', recommendationReason: 'One.' }] },
    }),
  );
  await http.waitForRequest(2);
  expect(business.getToday()).toMatchObject({ status: 'running' });
  http.respond(modelResponse(selection));
  expect(await business.wait({ requestId: accepted.requestId, timeoutMs: 2000 })).toMatchObject({
    status: 'published',
  });
  expect(http.requests).toHaveLength(2);
});

it('does not publish when the model finishes without submitting a draft', async () => {
  const { business, fixture, http } = await setup(2);
  const accepted = await business.generate({ trigger: 'manual' });
  if (accepted.status !== 'started') throw new Error('Expected admission');
  http.respond(modelResponse('Done.'));
  expect(await business.wait({ requestId: accepted.requestId, timeoutMs: 2000 })).toMatchObject({
    status: 'failed',
  });
  expect(fixture.repository.getCollection('2026-09-03', true)).toBeUndefined();
});

it('keeps publication atomic when the database rejects a recommendation insert', async () => {
  const { business, fixture, http } = await setup(2);
  fixture.database
    .prepare({
      sql: `CREATE TRIGGER reject_recommendation BEFORE INSERT ON discovery_recommendations
    WHEN NEW.candidate_id = 'candidate:2'
    BEGIN SELECT RAISE(ABORT, 'publication storage unavailable'); END`,
    })
    .run();
  const accepted = await business.generate({ trigger: 'manual' });
  if (accepted.status !== 'started') throw new Error('Expected a recommendation task.');
  http.respond(
    modelResponse({
      name: 'submit_recommendations',
      arguments: {
        items: [
          { candidateId: 'candidate:1', recommendationReason: 'Relevant one.' },
          { candidateId: 'candidate:2', recommendationReason: 'Relevant two.' },
        ],
      },
    }),
  );
  expect(await business.wait({ requestId: accepted.requestId, timeoutMs: 2000 })).toMatchObject({
    status: 'failed',
  });
  expect(fixture.repository.getCollection('2026-09-03', true)).toBeUndefined();
});

it('cancels an active recommendation task on shutdown without publishing', async () => {
  const { business, fixture, http } = await setup(2);
  const accepted = await business.generate({ trigger: 'manual' });
  if (accepted.status !== 'started') throw new Error('Expected a recommendation task.');
  await http.waitForRequest();
  await business.shutdown();
  expect(await business.wait({ requestId: accepted.requestId, timeoutMs: 2000 })).toMatchObject({
    status: 'cancelled',
  });
  expect(fixture.repository.getCollection('2026-09-03', true)).toBeUndefined();
});

it('checks current candidate availability before publication', async () => {
  const { business, fixture, http } = await setup(2);
  const accepted = await business.generate({ trigger: 'manual' });
  if (accepted.status !== 'started') throw new Error('Expected admission');
  await http.waitForRequest();
  fixture.database
    .prepare({ sql: "UPDATE discovery_candidates SET status = 'expired' WHERE id = 'candidate:1'" })
    .run();
  http.respond(modelResponse(selection));
  expect(await business.wait({ requestId: accepted.requestId, timeoutMs: 2000 })).toMatchObject({
    status: 'failed',
    failure: { code: 'publication_conflict' },
  });
  expect(fixture.repository.getCollection('2026-09-03', true)).toBeUndefined();
});

it('keeps the business request while retrying failed runs with new snapshots', async () => {
  const retry = Promise.withResolvers<{ callback: () => void; delay: number }>();
  const { business, fixture, http } = await setup(2, {
    timers: {
      setTimeout(callback, delay) {
        retry.resolve({ callback, delay });
        return callback;
      },
      clearTimeout() {},
    },
  });
  const first = await business.generate({ trigger: 'manual' });
  if (first.status !== 'started') throw new Error('Expected admission');
  http.respond(
    new Response(JSON.stringify({ error: { message: 'Temporary failure.' } }), { status: 503 }),
  );
  const scheduled = await retry.promise;
  expect(scheduled.delay).toBe(5000);
  expect(fixture.runtime.getRun(first.executionId!)?.status).toBe('failed');
  scheduled.callback();
  await http.waitForRequest(2);
  const current = business.getToday();
  expect(current).toMatchObject({ status: 'running', requestId: first.requestId });
  if (current.status !== 'running') throw new Error('Expected retry');
  expect(current.executionId).not.toBe(first.executionId);
  http.respond(modelResponse(selection));
  expect(await business.wait({ requestId: first.requestId, timeoutMs: 2000 })).toMatchObject({
    status: 'published',
  });
});

it('replaces a previous failure with waiting when no candidate remains eligible', async () => {
  const { business, fixture, http } = await setup(2);
  const accepted = await business.generate({ trigger: 'manual' });
  if (accepted.status !== 'started') throw new Error('Expected admission');
  http.respond(
    new Response(JSON.stringify({ error: { message: 'Insufficient balance.' } }), { status: 402 }),
  );
  expect(await business.wait({ requestId: accepted.requestId, timeoutMs: 2000 })).toMatchObject({
    status: 'failed',
  });
  fixture.repository.applyInterestChange({ action: 'pause', interestId: 'interest:1', now });
  expect(await business.generate({ trigger: 'manual' })).toMatchObject({
    status: 'waiting_for_candidates',
  });
  expect(business.getToday()).toMatchObject({ status: 'waiting_for_candidates' });
  expect(http.requests).toHaveLength(1);
});

const selection = {
  name: 'submit_recommendations',
  arguments: {
    items: [
      { candidateId: 'candidate:1', recommendationReason: 'Reason one.' },
      { candidateId: 'candidate:2', recommendationReason: 'Reason two.' },
    ],
  },
};

async function setup(candidates: number, overrides: Partial<CreateRecommendationsOptions> = {}) {
  const fixture = await createRuntimeFixture({ now: () => now });
  seedInterest(fixture.database);
  for (let index = 1; index <= candidates; index++) seedCandidate(fixture.database, index);
  const http = controlModelHttp();
  const business = createRecommendations({ ...optionsFor(fixture), ...overrides });
  onTestFinished(async () => {
    await business.shutdown();
    await fixture.cleanup();
    http.restore();
  });
  return { fixture, business, http };
}

function optionsFor(
  fixture: Awaited<ReturnType<typeof createRuntimeFixture>>,
): CreateRecommendationsOptions {
  const baseline = fixture.settings.readSettings();
  if (baseline.status !== 'ok') throw new Error('Invalid test configuration');
  fixture.settings.updateSettings({
    patch: {
      discovery: {
        recommendationTargetCount: 2,
        recommendationWorkingSetCount: 2,
        candidatePoolMinimumCount: 1,
      },
    },
    expectedRevision: baseline.settings.revision,
  });
  let id = 0;
  return {
    repository: fixture.repository,
    attempts: fixture.recommendationAttempts,
    runtime: fixture.runtime,
    sourceRegistry: createSourceRegistry([source()]),
    settings: fixture.settings,
    clock: { now: () => now },
    timezone: { get: () => 'UTC' },
    ids: { createRequestId: () => 'request:' + ++id },
  };
}

function seedInterest(database: DatabaseConnection): void {
  database
    .prepare({
      sql: `
    INSERT INTO discovery_interests (
      id, revision, description, status, created_from, user_managed_at, created_at, updated_at
    ) VALUES ('interest:1', 1, 'Agent architecture', 'active', 'manual', ?, ?, ?)
  `,
    })
    .run([now, now, now]);
}

function seedCandidate(database: DatabaseConnection, index: number): void {
  database
    .prepare({
      sql: `
    INSERT INTO discovery_candidates (
      id, content_identity, source_id, canonical_url, content_type, title,
      content_summary, content_truncated, status, created_at, expires_at
    ) VALUES (?, ?, 'source:1', ?, 'article', ?, ?, 0, 'available', ?, ?)
  `,
    })
    .run([
      `candidate:${index}`,
      `identity:${index}`,
      `https://example.com/${index}`,
      `Candidate ${index}`,
      `Summary ${index}`,
      now,
      '2026-09-04T00:00:00.000Z',
    ]);
  database
    .prepare({
      sql: `
    INSERT INTO discovery_candidate_interest_matches (
      id, candidate_id, interest_id, relevance, match_reason
    ) VALUES (?, ?, 'interest:1', 'direct', 'Direct match.')
  `,
    })
    .run([`match:${index}`, `candidate:${index}`]);
}

function source(): DiscoverySource {
  return {
    descriptor: {
      id: 'source:1',
      name: 'Source One',
      access: 'public_http',
      supportedModes: ['relevance'],
      supportsRead: false,
    },
    getAvailability: () => ({ state: 'ready' }),
    search: async () => ({ status: 'success', items: [] }),
  };
}
