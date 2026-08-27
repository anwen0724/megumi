/* Adapts renderer-safe Discovery Host DTOs to the Discovery business owner. */
import type { Discovery } from '@megumi/discovery';
import type { DiscoveryHost } from '../host/discovery-host';

export function createDiscoveryOperations(
  agent: Pick<
    Discovery,
    | 'changeInterest'
    | 'setSessionParticipation'
    | 'ensureDailyRecommendation'
    | 'getDiscoveryHome'
    | 'searchRecommendations'
    | 'updateRecommendationState'
    | 'getDiscoveryConfiguration'
    | 'updateDiscoveryConfiguration'
    | 'connectDiscoverySource'
    | 'refreshDiscoverySource'
    | 'refreshDiscoverySources'
  >,
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
    getHome: (request) => agent.getDiscoveryHome(request),
    searchRecommendations: (request) => agent.searchRecommendations(request),
    updateRecommendationState: (request) => agent.updateRecommendationState(request),
  };
}
