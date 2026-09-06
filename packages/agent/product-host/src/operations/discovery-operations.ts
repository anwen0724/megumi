/* Adapts renderer-safe Discovery Host DTOs to the Discovery business owner. */
import type { Discovery } from '@megumi/discovery';
import type { DiscoveryFactsReader } from '@megumi/context';
import type { DiscoveryHost } from '../host/discovery-host';
import { DiscoveryPreferenceDetailsPayloadSchema, DiscoveryPreferenceEvidencePayloadSchema, DiscoveryPreferenceEditPayloadSchema, DiscoveryPreferenceDeletePayloadSchema } from '../host/discovery-host';
import {
  DiscoveryBackgroundWaitOptionsSchema,
  DiscoveryCandidateSupplyRequestSchema,
  DiscoveryRecommendationFactsQuerySchema,
  DiscoveryFactsResultSchema,
  DiscoveryInterestFactsPayloadSchema,
  DiscoveryInterestFactsResultSchema,
  DiscoveryPreferenceLearningQuerySchema,
} from '../host/discovery-host';

export function createDiscoveryOperations(
  agent: Pick<
    Discovery,
    | 'getPreferenceDetails' | 'getPreferenceEvidence' | 'editPreference' | 'deletePreference' | 'preparePreferencesForRecommendation'
    | 'changeInterest'
    | 'confirmCandidateSupply'
    | 'setInterestSessionSetting'
    | 'requestRecommendation'
    | 'waitRecommendation'
    | 'getTodayRecommendation'
    | 'getRecommendationCollection'
    | 'getRecommendationById'
    | 'getDiscoveryHome'
    | 'searchRecommendations'
    | 'updateRecommendationState'
    | 'getDiscoveryConfiguration'
    | 'updateDiscoveryConfiguration'
    | 'connectDiscoverySource'
    | 'refreshDiscoverySource'
    | 'refreshDiscoverySources'
    | 'getInterestFacts'
    | 'requestCandidateSupply'
    | 'getCandidatePool'
    | 'getPreferenceLearningCompletion'
    | 'getPreferenceLearningStatus'
  >,
  facts: DiscoveryFactsReader,
): DiscoveryHost {
  return {
    getPreferenceDetails: async (request) => ({ details: agent.getPreferenceDetails(DiscoveryPreferenceDetailsPayloadSchema.parse(request)) ?? null }),
    getPreferenceEvidence: async (request) => ({ details: agent.getPreferenceEvidence(DiscoveryPreferenceEvidencePayloadSchema.parse(request).preferenceId) ?? null }),
    editPreference: async (request) => agent.editPreference(DiscoveryPreferenceEditPayloadSchema.parse(request)),
    deletePreference: async (request) => agent.deletePreference(DiscoveryPreferenceDeletePayloadSchema.parse(request)),
    preparePreferencesForRecommendation: (request) => agent.preparePreferencesForRecommendation(request),
    confirmCandidateSupply: () => agent.confirmCandidateSupply(),
    getConfiguration: () => agent.getDiscoveryConfiguration(),
    updateConfiguration: (request) => agent.updateDiscoveryConfiguration(request),
    connectSource: (request) => agent.connectDiscoverySource(request),
    refreshSource: (request) => agent.refreshDiscoverySource(request),
    refreshSources: () => agent.refreshDiscoverySources(),
    changeInterest: (request) => agent.changeInterest(request),
    setInterestSessionSetting: (request) => agent.setInterestSessionSetting(request),
    requestRecommendation: (request) => agent.requestRecommendation(request),
    waitRecommendation: (request) => agent.waitRecommendation(request),
    getTodayRecommendation: () => Promise.resolve(agent.getTodayRecommendation()),
    getRecommendationCollection: (request) => Promise.resolve(
      agent.getRecommendationCollection(request.localDate, request.includeHidden) ?? null,
    ),
    getRecommendationById: (request) => Promise.resolve(
      agent.getRecommendationById(request.recommendationId) ?? null,
    ),
    getHome: (request) => agent.getDiscoveryHome(request),
    searchRecommendations: (request) => agent.searchRecommendations(request),
    updateRecommendationState: (request) => agent.updateRecommendationState(request),
    getInterestFacts(request) {
      const result = agent.getInterestFacts(DiscoveryInterestFactsPayloadSchema.parse(request));
      return Promise.resolve(DiscoveryInterestFactsResultSchema.parse(result));
    },
    async requestCandidateSupply(request = { trigger: 'supply_conditions_changed' }) {
      const parsed = DiscoveryCandidateSupplyRequestSchema.parse(request);
      const result = agent.requestCandidateSupply(parsed.trigger);
      if (!result) throw new Error('Candidate Supply is not configured.');
      return result;
    },
    getCandidatePool: () => Promise.resolve(agent.getCandidatePool() ?? null),
    async getRecommendationFacts(request) {
      const result = await facts.readRecommendationFacts(
        DiscoveryRecommendationFactsQuerySchema.parse(request),
      );
      DiscoveryFactsResultSchema.parse(result);
      return result;
    },
    getPreferenceLearning(request) {
      const parsed = DiscoveryPreferenceLearningQuerySchema.parse(request);
      return Promise.resolve(agent.getPreferenceLearningCompletion(parsed.recommendationId) ?? null);
    },
    getPreferenceLearningStatus(request) {
      return Promise.resolve(agent.getPreferenceLearningStatus(DiscoveryPreferenceLearningQuerySchema.parse(request).recommendationId));
    },
    waitPreferenceLearning: (request) => waitForBusinessFact({
      timeoutMs: DiscoveryBackgroundWaitOptionsSchema.parse({ timeoutMs: request.timeoutMs }).timeoutMs,
      read: () => agent.getPreferenceLearningCompletion(
        DiscoveryPreferenceLearningQuerySchema.parse({
          recommendationId: request.recommendationId,
        }).recommendationId,
      ),
      terminal: (value) => value.status === 'learned',
    }),
  };
}

async function waitForBusinessFact<T>(input: {
  readonly timeoutMs: number;
  readonly read: () => T | undefined;
  readonly terminal: (value: T) => boolean;
}): Promise<{ readonly status: 'completed'; readonly value: T } | { readonly status: 'timed_out' }> {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() <= deadline) {
    const value = input.read();
    if (value && input.terminal(value)) return { status: 'completed', value };
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(25, input.timeoutMs)));
  }
  return { status: 'timed_out' };
}
