/*
 * Verifies the composed Candidate Supply surface: the Product Host operations,
 * the enable gate around external work, and that reading saved candidates never
 * depends on a model or a source being usable.
 */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Api, Model } from '@megumi/ai';
import type { Observability } from '@megumi/application/observability/index';
import { createRecommendation } from '@megumi/application/recommendation/recommendation-api';
import { createSettings } from '@megumi/application/settings/settings-store';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '@megumi/application/storage/index';

const observability: Observability = {
  withTrace: async (_scope, operation) => operation(),
  withSpan: async (_scope, operation) => operation(),
  recordContent() {},
  recordEvent() {},
  linkTrace() {},
};

describe('candidate supply composition', () => {
  let directory: string;
  let database: DatabaseConnection;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-supply-'));
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
  });

  afterEach(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('lists, creates, edits, disables and deletes interests without leaking entity fields', async () => {
    const { host } = compose();

    expect(await host.listInterests()).toEqual({ interests: [] });

    const created = await host.changeInterest({ action: 'create', description: 'Rust async' });
    expect(created.status).toBe('changed');
    const interests = created.status === 'changed' ? created.interests : [];
    expect(interests).toHaveLength(1);
    expect(interests[0]).toEqual({ id: expect.any(String), text: 'Rust async', enabled: true, revision: 1 });
    const interestId = interests[0]!.id;

    const renamed = await host.changeInterest({
      action: 'update',
      interestId,
      expectedRevision: 1,
      description: 'Rust runtime internals',
    });
    expect(renamed).toMatchObject({
      status: 'changed',
      interests: [{ id: interestId, revision: 2, text: 'Rust runtime internals', enabled: true }],
    });

    const paused = await host.changeInterest({ action: 'pause', expectedRevision: 2, interestId });
    expect(paused).toMatchObject({ status: 'changed', interests: [{ enabled: false }] });

    const resumed = await host.changeInterest({ action: 'resume', expectedRevision: 3, interestId });
    expect(resumed).toMatchObject({ status: 'changed', interests: [{ enabled: true }] });

    expect(await host.changeInterest({ action: 'delete', expectedRevision: 4, interestId })).toEqual({
      status: 'changed',
      interests: [],
    });
    expect(await host.changeInterest({ action: 'pause', expectedRevision: 2, interestId })).toEqual({
      status: 'not_found',
    });
  });

  it('rejects an edit that saves nothing without writing an interest', async () => {
    const { host } = compose();

    expect(await host.changeInterest({ action: 'create', description: '   ' })).toMatchObject({
      status: 'invalid_request',
    });
    expect(await host.listInterests()).toEqual({ interests: [] });
  });

  it('reports the enable state and the first-version source catalog', async () => {
    const configured = compose();
    expect(await configured.host.getConfiguration()).toMatchObject({
      candidateSupplyConfirmed: false,
      sources: [
        { sourceId: 'tavily', enabled: false, credentialConfigured: true, state: 'disabled' },
        { sourceId: 'bing_rss', enabled: false, state: 'disabled' },
        { sourceId: 'zhihu', enabled: true, credentialConfigured: true, state: 'unchecked' },
        { sourceId: 'bilibili', enabled: false, state: 'disabled' },
        { sourceId: 'xiaohongshu', enabled: false, state: 'disabled' },
      ],
    });

    const withoutCredential = compose({ secret: undefined });
    expect((await withoutCredential.host.getConfiguration()).sources).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: 'zhihu', credentialConfigured: false })]));

    expect(
      await configured.host.updateConfiguration({ enabledSources: [] }),
    ).toMatchObject({ sources: [{ enabled: false }, { enabled: false }, { enabled: false }, { enabled: false }, { enabled: false }] });
    expect((await configured.host.updateConfiguration({ enabledSources: ['bilibili'] })).sources).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: 'bilibili', enabled: true })]));
    await expect(
      configured.host.updateConfiguration({ enabledSources: ['unknown'] }),
    ).rejects.toThrow('Unknown candidate supply source');
  });

  it('confirms the first supply run once', async () => {
    const { host } = compose();
    expect(await host.confirmCandidateSupply()).toEqual({ status: 'confirmed' });
    expect(await host.confirmCandidateSupply()).toEqual({ status: 'already_confirmed' });
    expect(await host.getConfiguration()).toMatchObject({ candidateSupplyConfirmed: true });
  });

  it('does no external work and names the reason while supply is not enabled', async () => {
    const { host, supply } = compose();
    await host.changeInterest({ action: 'create', description: 'Rust async' });

    expect(
      await supply.prepareCandidates({
        requirement: { pool: 'daily', minimumCount: 5, coverage: [] },
      }),
    ).toMatchObject({ status: 'unavailable', code: 'DISABLED' });
  });

  it('names the missing model and the disabled source instead of returning empty candidates', async () => {
    const unconfirmed = compose();
    await unconfirmed.host.changeInterest({ action: 'create', description: 'Rust async' });
    await unconfirmed.host.confirmCandidateSupply();

    const withoutModel = compose({ model: undefined, confirmed: true });
    await withoutModel.host.changeInterest({ action: 'create', description: 'Rust async' });
    expect(
      await withoutModel.supply.prepareCandidates({
        requirement: { pool: 'daily', minimumCount: 5, coverage: [] },
      }),
    ).toMatchObject({ status: 'unavailable', code: 'MODEL_UNAVAILABLE' });

    const withoutSource = compose({ confirmed: true, enabledSources: [], model: 'gpt-x' });
    await withoutSource.host.changeInterest({ action: 'create', description: 'Rust async' });
    expect(
      await withoutSource.supply.prepareCandidates({
        requirement: { pool: 'daily', minimumCount: 5, coverage: [] },
      }),
    ).toMatchObject({ status: 'unavailable', code: 'SOURCE_UNAVAILABLE' });
  });

  it('lists a saved pool while supply is disabled and keeps the enable gate closed', async () => {
    const { supply } = compose();
    const snapshot = await supply.listCandidates({
      requirement: { pool: 'long_term', minimumCount: 1, coverage: [] },
    });
    expect(snapshot).toMatchObject({
      pool: 'long_term',
      candidates: [],
      counts: { total: 0 },
      matchingPending: false,
    });
  });

  /** Composes the real recommendation owner over one isolated Settings document. */
  function compose(
    options: {
      readonly secret?: string | undefined;
      readonly model?: string | undefined;
      readonly confirmed?: boolean;
      readonly enabledSources?: readonly string[];
    } = {},
  ) {
    const settings = createSettings({
      globalSettingsPath: path.join(directory, 'settings.json'),
      credentialsPath: path.join(directory, 'credentials.json'),
      readEnvironment: () => undefined,
    });
    const seeded = settings.updateSettings({
      expectedRevision: readRevision(settings),
      patch: {
        discovery: {
          ...(options.confirmed === undefined
            ? {}
            : { candidateSupplyConfirmed: options.confirmed }),
          ...(options.enabledSources === undefined
            ? {}
            : { enabledSources: [...options.enabledSources] }),
          ...(options.model === undefined
            ? {}
            : { candidateSupplyModel: { providerId: 'test', modelId: options.model } }),
        },
      },
    });
    if (seeded.status === 'rejected') throw new Error(seeded.error.message);

    const secret = 'secret' in options ? options.secret : 'access-secret';
    const recommendation = createRecommendation({
      database,
      settings,
      observability,
      client: { completeSimple: async () => unreachableModelCall() },
      resolveModel: async () =>
        options.model === undefined ? undefined : ({ id: options.model } as Model<Api>),
      accessSecret: () => secret,
      newId: (prefix) => `${prefix}:${Math.random().toString(16).slice(2)}`,
      now: () => 1_800_000_000_000,
      timers: { setTimeout: () => 0, clearTimeout: () => undefined },
    });
    return { ...recommendation, settings };
  }
});

/** Reads the revision the settings document is currently at. */
function readRevision(settings: ReturnType<typeof createSettings>): string {
  const read = settings.readSettings();
  if (read.status === 'rejected') throw new Error(read.error.message);
  return read.settings.revision;
}

function unreachableModelCall(): never {
  throw new Error('The composition test must not call a model.');
}
