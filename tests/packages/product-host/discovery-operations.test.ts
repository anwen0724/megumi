/* Verifies the Product Host exposes Interest and Candidate Supply configuration without owning their state. */
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { SupplyConfigurationViewSchema } from '@megumi/application/contracts';
import {
  composeTestApplication,
  type TestApplication,
} from '../composition/compose-test-application';

let application: TestApplication | undefined;
afterEach(async () => { await application?.cleanup(); application = undefined; });

describe('Discovery Product Host operations', () => {
  it('creates, edits, pauses, resumes, and deletes one Interest', async () => {
    application = composeTestApplication();
    await expect(application.runtime.discovery.listInterests()).resolves.toEqual({ interests: [] });

    const created = await application.runtime.discovery.changeInterest({
      action: 'create', description: 'TypeScript architecture',
    });
    if (created.status !== 'changed') throw new Error('Expected the Interest to be created.');
    const [interest] = created.interests;
    if (!interest) throw new Error('Expected one saved Interest.');
    expect(interest).toMatchObject({ text: 'TypeScript architecture', enabled: true });
    await expect(application.runtime.discovery.listInterests())
      .resolves.toEqual({ interests: [interest] });

    await expect(application.runtime.discovery.changeInterest({
      action: 'update', interestId: interest.id, description: 'TypeScript module design',
    })).resolves.toEqual({
      status: 'changed',
      interests: [{ id: interest.id, text: 'TypeScript module design', enabled: true }],
    });

    await expect(application.runtime.discovery.changeInterest({
      action: 'pause', interestId: interest.id,
    })).resolves.toEqual({
      status: 'changed',
      interests: [{ id: interest.id, text: 'TypeScript module design', enabled: false }],
    });

    await expect(application.runtime.discovery.changeInterest({
      action: 'resume', interestId: interest.id,
    })).resolves.toEqual({
      status: 'changed',
      interests: [{ id: interest.id, text: 'TypeScript module design', enabled: true }],
    });

    await expect(application.runtime.discovery.changeInterest({
      action: 'delete', interestId: interest.id,
    })).resolves.toEqual({ status: 'changed', interests: [] });
    await expect(application.runtime.discovery.listInterests()).resolves.toEqual({ interests: [] });
  });

  it('separates an unknown Interest id from a payload the Interest rules reject', async () => {
    application = composeTestApplication();
    await expect(application.runtime.discovery.changeInterest({
      action: 'update', interestId: 'interest:missing', description: 'Anything',
    })).resolves.toEqual({ status: 'not_found' });
    await expect(application.runtime.discovery.changeInterest({
      action: 'pause', interestId: 'interest:missing',
    })).resolves.toEqual({ status: 'not_found' });
    await expect(application.runtime.discovery.changeInterest({
      action: 'resume', interestId: 'interest:missing',
    })).resolves.toEqual({ status: 'not_found' });
    await expect(application.runtime.discovery.changeInterest({
      action: 'delete', interestId: 'interest:missing',
    })).resolves.toEqual({ status: 'not_found' });

    await expect(application.runtime.discovery.changeInterest({
      action: 'create', description: '   ',
    })).resolves.toMatchObject({ status: 'invalid_request' });
    await expect(application.runtime.discovery.changeInterest({
      action: 'update', interestId: 'interest:missing', description: '   ',
    })).resolves.toMatchObject({ status: 'invalid_request' });
    // A rejected payload never reaches saved state.
    await expect(application.runtime.discovery.listInterests()).resolves.toEqual({ interests: [] });
  });

  it('reads and round-trips the Candidate Supply configuration', async () => {
    application = composeTestApplication();
    const initial = SupplyConfigurationViewSchema.parse(
      await application.runtime.discovery.getConfiguration(),
    );
    expect(initial).toEqual({
      candidateSupplyConfirmed: false,
      sources: [{ sourceId: 'zhihu', name: 'Zhihu', enabled: true, credentialConfigured: false }],
    });

    const [source] = initial.sources;
    await expect(application.runtime.discovery.updateConfiguration({ enabledSources: ['zhihu'] }))
      .resolves.toEqual(initial);
    await expect(application.runtime.discovery.updateConfiguration({ enabledSources: [] }))
      .resolves.toEqual({ ...initial, sources: [{ ...source, enabled: false }] });
    expect(application.runtime.settings.readSettings()).toMatchObject({
      status: 'ok',
      settings: { config: { discovery: { enabledSources: [] } } },
    });
  });

  it('confirms Candidate Supply once and reports every later confirmation as already confirmed', async () => {
    application = composeTestApplication();
    await expect(application.runtime.discovery.confirmCandidateSupply())
      .resolves.toEqual({ status: 'confirmed' });
    await expect(application.runtime.discovery.confirmCandidateSupply())
      .resolves.toEqual({ status: 'already_confirmed' });
    await expect(application.runtime.discovery.getConfiguration())
      .resolves.toMatchObject({ candidateSupplyConfirmed: true });
  });
});
