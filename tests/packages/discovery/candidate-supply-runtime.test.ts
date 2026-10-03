import fs from 'node:fs';
import path from 'node:path';
/* Verifies candidate supply against real runtime, tools and isolated storage. */
// @vitest-environment node
import { expect, it, onTestFinished } from 'vitest';
import { createCandidates, type CreateCandidatesOptions } from '@megumi/application/recommendation/collection/collect-candidates';
import { createSourceRegistry, type DiscoverySource } from '@megumi/application/recommendation/sources/source-catalog';
import { createTraceRecorder } from '@megumi/application/observability/trace/trace-recorder';
import type { TraceJournalRecord } from '@megumi/application/observability/persistence/trace-journal-record';
import { createHttpProductFixture } from '../recommendation/http-product-fixture';
import { controlModelHttp, modelResponse } from '../recommendation/model-http-fixture';

const now = '2026-09-03T00:00:00.000Z';

it.each([false, true])(
  'does not start without active interests (confirmed=%s)',
  async (confirmed) => {
    const { supply, http } = await setup({ interest: false, confirmed });
    expect(await supply.ensureSupply('startup')).toMatchObject({
      status: 'not_needed',
      reason: 'no_active_interest',
      addedCandidateCount: 0,
      addedInterestMatchCount: 0,
    });
    expect(http.requests).toHaveLength(0);
  },
);

it('does not start when the pool meets its minimum', async () => {
  const { supply, fixture, http } = await setup();
  for (const url of ['https://example.com/one', 'https://example.com/two'])
    addCandidate(fixture, url);
  expect(await supply.ensureSupply('scheduled')).toMatchObject({
    status: 'not_needed',
    reason: 'no_gap',
  });
  expect(http.requests).toHaveLength(0);
});

it.each(['startup', 'scheduled', 'interest_changed', 'supply_conditions_changed'] as const)(
  'requires confirmation before %s',
  async (trigger) => {
    const { supply, http } = await setup({ confirmed: false });
    expect(await supply.ensureSupply(trigger)).toMatchObject({
      status: 'not_needed',
      reason: 'confirmation_required',
    });
    expect(http.requests).toHaveLength(0);
  },
);

it('persists confirmation and returns while the actual run is still pending', async () => {
  const { supply, http, readSettings } = await setup({ confirmed: false });
  await Promise.all([supply.confirm(), supply.confirm()]);
  expect(readSettings().candidateSupplyConfirmed).toBe(true);
  await http.waitForRequest();
  expect(supply.getStatus()).toMatchObject({ status: 'running' });
  expect(await supply.confirm()).toMatchObject({ status: 'already_confirmed' });
  expect(http.requests).toHaveLength(1);
});

it('does not confirm or run when settings cannot be saved', async () => {
  const { supply, http, fixture } = await setup({ confirmed: false });
  fs.renameSync(fixture.globalSettingsPath, fixture.globalSettingsPath + '.backup');
  fs.mkdirSync(fixture.globalSettingsPath);
  await expect(supply.confirm()).rejects.toThrow();
  expect(
    JSON.parse(fs.readFileSync(fixture.globalSettingsPath + '.backup', 'utf8')).discovery
      .candidateSupplyConfirmed,
  ).toBe(false);
  expect(http.requests).toHaveLength(0);
});

it('does not confirm or launch after shutdown', async () => {
  const { supply, http, readSettings } = await setup({ confirmed: false });
  await supply.shutdown();
  await expect(supply.confirm()).rejects.toThrow('shutting down');
  expect(readSettings().candidateSupplyConfirmed).toBe(false);
  expect(http.requests).toHaveLength(0);
});

it('settles fulfillment from the actual submitted candidates', async () => {
  const { supply, http } = await setup({ source: searchSource(4) });
  const completion = supply.ensureSupply('interest_changed');
  await submitSourceResults(http);
  http.respond(modelResponse('Completed.'));
  expect(await completion).toMatchObject({
    status: 'fulfilled',
    availableCount: 4,
    remainingReplenishmentCount: 0,
    addedCandidateCount: 4,
  });
});

it('joins supply checks without launching a second run', async () => {
  const { supply, http } = await setup();
  const first = supply.ensureSupply('startup');
  await http.waitForRequest();
  expect(await supply.ensureSupply('supply_conditions_changed')).toMatchObject({
    status: 'not_needed',
    reason: 'supply_in_progress',
  });
  http.respond(modelResponse('No candidates found.'));
  await first;
  expect(http.requests).toHaveLength(1);
});

it('waits for the active run during shutdown', async () => {
  const { supply, http } = await setup();
  const work = supply.ensureSupply('startup');
  await http.waitForRequest();
  let stopped = false;
  const shutdown = supply.shutdown().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  http.respond(modelResponse('No candidates found.'));
  await Promise.all([work, shutdown]);
  expect(stopped).toBe(true);
});

it('reports unavailable sources without starting a run', async () => {
  const { supply, http } = await setup({ overrides: { sourceRegistry: createSourceRegistry([]) } });
  expect(await supply.ensureSupply('startup')).toMatchObject({
    status: 'unfulfilled',
    reason: 'no_available_source',
    availableCount: 0,
    remainingReplenishmentCount: 4,
  });
  expect(http.requests).toHaveLength(0);
});

it('keeps already submitted candidates when the subsequent model call fails', async () => {
  const { supply, fixture, http } = await setup({ source: searchSource(1) });
  const completion = supply.ensureSupply('startup');
  await submitSourceResults(http);
  http.respond(
    new Response(JSON.stringify({ error: { message: 'Insufficient balance' } }), { status: 402 }),
  );
  expect(await completion).toMatchObject({
    status: 'failed',
    availableCount: 1,
    remainingReplenishmentCount: 3,
    addedCandidateCount: 1,
    failure: { code: 'MODEL_CALL_FAILED' },
  });
  expect(fixture.repository.getCandidatePoolSnapshot(poolSettings()).availableCount).toBe(1);
});

it('records enabled, unavailable and disabled sources without changing selection', async () => {
  const records: TraceJournalRecord[] = [];
  const observability = createTraceRecorder({
    enqueue: (record) => {
      records.push(record);
    },
  });
  const registry = createSourceRegistry([
    source(),
    { ...source(), descriptor: { ...source().descriptor, id: 'disabled' } },
    {
      ...source(),
      descriptor: { ...source().descriptor, id: 'xiaohongshu' },
      getAvailability: () => ({ state: 'login_required' }),
    },
  ]);
  const { supply, http } = await setup({
    overrides: { sourceRegistry: registry, observability },
    enabledSources: ['source:1', 'xiaohongshu'],
  });
  const work = supply.ensureSupply('startup');
  http.respond(modelResponse('No candidates found.'));
  await work;
  expect(records).toContainEqual(
    expect.objectContaining({
      type: 'content.recorded',
      kind: 'source.selection',
      content: expect.objectContaining({
        mode: 'inline',
        value: [
          expect.objectContaining({ sourceId: 'source:1', selected: true, reason: 'ready' }),
          expect.objectContaining({ sourceId: 'disabled', selected: false, reason: 'disabled' }),
          expect.objectContaining({
            sourceId: 'xiaohongshu',
            selected: false,
            reason: 'login_required',
          }),
        ],
      }),
    }),
  );
});

async function setup(
  options: {
    interest?: boolean;
    confirmed?: boolean;
    source?: DiscoverySource;
    enabledSources?: string[];
    overrides?: Partial<CreateCandidatesOptions>;
  } = {},
) {
  const fixture = createHttpProductFixture(() => now);
  if (options.interest !== false)
    fixture.repository.applyInterestChange({
      action: 'create',
      interestId: 'interest:1',
      description: 'Agent architecture',
      now,
    });
  const http = controlModelHttp();
  const discovery = {
    conversationRecognitionEnabled: true,
    candidateSupplyConfirmed: options.confirmed ?? true,
    recommendationCandidateCheckIntervalSeconds: 60,
    recommendationGenerationTime: '08:00',
    recommendationTargetCount: 2,
    recommendationWorkingSetCount: 2,
    enabledSources: options.enabledSources ?? ['source:1'],
    candidatePoolMinimumCount: 2,
    candidatePoolMaximumCount: 5,
    candidateValidityDays: 30,
    candidateContentExcerptMaxCharacters: 8000,
    candidateSupplyCheckIntervalMinutes: 360,
  };
  const baseline = fixture.settings.readSettings();
  if (baseline.status !== 'ok') throw new Error('Invalid test configuration');
  const saved = fixture.settings.updateSettings({
    patch: { discovery },
    expectedRevision: baseline.settings.revision,
  });
  if (saved.status === 'rejected') throw new Error(saved.error.message);
  let id = 0;
  const supply = createCandidates({
    repository: fixture.repository,
    agent: fixture.agent,
    preparation: fixture.preparation,
    sourceRegistry: createSourceRegistry([options.source ?? source()]),
    settings: fixture.settings,
    now: () => now,
    ids: { createRequestId: () => 'supply:' + ++id },
    ...options.overrides,
  });
  onTestFinished(async () => {
    await supply.shutdown();
    await fixture.cleanup();
    http.restore();
  });
  return {
    fixture,
    supply,
    http,
    readSettings: () => {
      const result = fixture.settings.readSettings();
      if (result.status !== 'ok') throw new Error(result.error.message);
      return result.settings.config.discovery;
    },
  };
}

function addCandidate(fixture: Awaited<ReturnType<typeof createHttpProductFixture>>, url: string) {
  fixture.repository.submitCandidate({
    content: content(url),
    contentSummary: 'Related content.',
    matches: [{ interestId: 'interest:1', relevance: 'direct', matchReason: 'Related.' }],
    settings: poolSettings(),
  });
}

function searchSource(count: number): DiscoverySource {
  return {
    ...source(),
    search: async () => ({
      status: 'success',
      items: Array.from({ length: count }, (_, i) => content('https://example.com/' + i)),
    }),
  };
}

async function submitSourceResults(http: ReturnType<typeof controlModelHttp>) {
  http.respond(
    modelResponse({
      name: 'search_content',
      arguments: {
        sourceId: 'source:1',
        query: 'Agent',
        mode: 'relevance',
        limit: 10,
        targetInterestIds: ['interest:1'],
      },
    }),
  );
  await http.waitForRequest(2);
  // Result IDs are read from the external model request rather than assuming an internal ID format.
  const request = http.requests.at(-1) as { messages: Array<{ role: string; content: string }> };
  const message = request.messages.find((message) => message.role === 'tool');
  const results = JSON.parse(message?.content ?? '{}').results as Array<{ resultId: string }>;
  http.respond(
    modelResponse({
      name: 'submit_candidates',
      arguments: {
        items: results.map(({ resultId }) => ({
          resultId,
          contentSummary: 'Related content.',
          matches: [{ interestId: 'interest:1', relevance: 'direct', matchReason: 'Related.' }],
        })),
      },
    }),
  );
  await http.waitForRequest(3);
}

function poolSettings() {
  return {
    minimumCount: 2,
    targetCount: 4,
    maximumCount: 5,
    candidateValidityDays: 30,
    candidateContentExcerptMaxCharacters: 8_000,
  };
}

function source(): DiscoverySource {
  return {
    descriptor: {
      id: 'source:1',
      name: 'Source 1',
      access: 'public_http',
      supportedModes: ['relevance', 'recent'],
      supportsRead: false,
    },
    getAvailability: () => ({ state: 'ready' }),
    search: async () => ({ status: 'success', items: [] }),
  };
}

function content(url = 'https://example.com/article') {
  return {
    sourceId: 'source:1',
    sourceName: 'Source 1',
    sourceContentId: url.split('/').at(-1),
    canonicalUrl: url,
    contentType: 'article' as const,
    title: 'Agent architecture in practice',
    description: 'Concrete implementation patterns.',
  };
}
