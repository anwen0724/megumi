/* Creates real Recommendation storage and settings with a controlled external model provider. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDatabase, migrateDatabase } from '@megumi/application/storage';
import { createSettings } from '@megumi/application/settings/settings-store';
import { createDiscoveryRepository } from '@megumi/application/recommendation/recommendation-storage';
import { createSourceRegistry } from '@megumi/application/recommendation/sources/source-catalog';
import { fixture } from '../agent/agent-fixture';

export const now = '2026-10-03T00:00:00.000Z';
export const poolSettings = { minimumCount: 2, maximumCount: 5, targetCount: 4,
  candidateValidityDays: 30, candidateContentExcerptMaxCharacters: 8000 };

export function recommendationFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'megumi-recommendation-'));
  const database = createDatabase({ filename: ':memory:' });
  migrateDatabase({ database });
  const repository = createDiscoveryRepository({ database, clock: { now: () => now } });
  repository.applyInterestChange({ action: 'create', interestId: 'interest:1', description: 'Agent architecture', now });
  const settings = createSettings({ globalSettingsPath: path.join(root, 'settings.json'),
    credentialsPath: path.join(root, 'credentials.json'), readEnvironment: () => undefined });
  const current = settings.readSettings();
  if (current.status !== 'ok') throw new Error(current.error.message);
  const saved = settings.updateSettings({ expectedRevision: current.settings.revision, patch: { discovery: { candidateSupplyConfirmed: true,
    enabledSources: ['open_web'], candidatePoolMinimumCount: 2, candidatePoolMaximumCount: 5,
    recommendationTargetCount: 2, recommendationWorkingSetCount: 2 } } });
  if (saved.status === 'rejected') throw new Error(saved.error.message);
  const sourceRegistry = createSourceRegistry([{
    descriptor: { id: 'open_web', name: 'Web', access: 'public_http', supportedModes: ['relevance', 'recent'], supportsRead: false },
    getAvailability: () => ({ state: 'ready' }),
    async search() { return { status: 'success', items: [{ sourceId: 'open_web', sourceName: 'Web',
      canonicalUrl: 'https://example.com/agent', contentType: 'article', title: 'Agent architecture',
      description: 'Concrete implementation patterns.' }] }; },
  }]);
  const ai = fixture();
  return { ...ai, repository, settings, sourceRegistry, database,
    preparation: { policy: ai.config.policy, instructionDocuments: [], async resolveModel() { return ai.config.model; } },
    seedCandidates(count: number) {
      return Array.from({ length: count }, (_, index) => {
        const result = repository.submitCandidate({
          content: { sourceId: 'open_web', sourceName: 'Web', canonicalUrl: `https://example.com/${index}`,
            contentType: 'article', title: `Agent architecture ${index}` },
          contentSummary: 'Agent implementation patterns.', settings: poolSettings,
          matches: [{ interestId: 'interest:1', relevance: 'direct', matchReason: 'Explains Agent architecture.' }],
        });
        if (result.status === 'ignored') throw new Error('Fixture candidate was rejected.');
        return result.candidate.id;
      });
    },
    cleanup() { database.close(); rmSync(root, { recursive: true, force: true }); },
  };
}
