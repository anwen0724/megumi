/* Adapts renderer-safe Discovery Host DTOs to the Discovery business owner. */
import type { Discovery } from '@megumi/discovery';
import type { DiscoveryFactsReader } from '@megumi/context';
import type { DiscoveryHost } from '../host/discovery-host';
import {
  DiscoveryBackgroundWaitOptionsSchema,
  DiscoveryCandidateSupplyRequestSchema,
  DiscoveryDailyRecommendationFactsQuerySchema,
  DiscoveryPreferenceLearningFactsQuerySchema,
  DiscoveryFactsResultSchema,
  DiscoveryInterestFactsPayloadSchema,
  DiscoveryInterestFactsResultSchema,
  DiscoveryPreferenceLearningQuerySchema,
} from '../host/discovery-host';

export function createDiscoveryOperations(
  agent: Pick<
    Discovery,
    | 'changeInterest'
    | 'setSessionParticipation'
    | 'ensureDailyRecommendation'
    | 'getDailyRecommendationBatch'
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
    | 'getCandidatePoolSnapshot'
    | 'getPreferenceLearningBatch'
    | 'getPreferenceLearningCompletion'
  >,
  facts: DiscoveryFactsReader,
): DiscoveryHost {
  return {
    getConfiguration: () => agent.getDiscoveryConfiguration(),
    updateConfiguration: (request) => agent.updateDiscoveryConfiguration(request),
    connectSource: (request) => agent.connectDiscoverySource(request),
    refreshSource: (request) => agent.refreshDiscoverySource(request),
    refreshSources: () => agent.refreshDiscoverySources(),
    changeInterest: (request) => agent.changeInterest(request),
    setSessionParticipation: (request) => agent.setSessionParticipation(request),
    ensureDaily: (request) => agent.ensureDailyRecommendation(request),
    getDailyBatch: (request) => Promise.resolve(
      agent.getDailyRecommendationBatch(request.localDate) ?? null,
    ),
    waitDailyBatch: (request) => waitForBusinessFact({
      timeoutMs: DiscoveryBackgroundWaitOptionsSchema.parse({ timeoutMs: request.timeoutMs }).timeoutMs,
      read: () => agent.getDailyRecommendationBatch(request.localDate),
      terminal: (value) => value.status === 'published' || value.status === 'failed',
    }),
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
    getCandidatePool: () => Promise.resolve(agent.getCandidatePoolSnapshot() ?? null),
    async getDailyRecommendationFacts(request) {
      const result = await facts.readDailyRecommendationFacts(
        DiscoveryDailyRecommendationFactsQuerySchema.parse(request),
      );
      DiscoveryFactsResultSchema.parse(result);
      return result;
    },
    getPreferenceLearningBatch: (batchId) => Promise.resolve(
      agent.getPreferenceLearningBatch(batchId) ?? null,
    ),
    getPreferenceLearning(request) {
      const parsed = DiscoveryPreferenceLearningQuerySchema.parse(request);
      return Promise.resolve(agent.getPreferenceLearningCompletion(parsed.feedbackChangeId) ?? null);
    },
    async getPreferenceLearningFacts(request) {
      const result = await facts.readPreferenceLearningFacts(
        DiscoveryPreferenceLearningFactsQuerySchema.parse(request),
      );
      DiscoveryFactsResultSchema.parse(result);
      return result;
    },
    waitPreferenceLearning: (request) => waitForBusinessFact({
      timeoutMs: DiscoveryBackgroundWaitOptionsSchema.parse({ timeoutMs: request.timeoutMs }).timeoutMs,
      read: () => agent.getPreferenceLearningCompletion(
        DiscoveryPreferenceLearningQuerySchema.parse({
          feedbackChangeId: request.feedbackChangeId,
        }).feedbackChangeId,
      ),
      terminal: (value) => ['learned', 'superseded', 'ignored', 'failed'].includes(value.status),
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
