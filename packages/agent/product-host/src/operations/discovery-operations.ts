/* Adapts renderer-safe Discovery Host DTOs to the Discovery business owner. */
import type { Discovery } from '@megumi/discovery';
import type { DiscoveryHost } from '../host/discovery-host';

export function createDiscoveryOperations(
  agent: Pick<
    Discovery,
    | 'changeInterest'
    | 'setSessionParticipation'
    | 'ensureDailyDiscovery'
    | 'getDiscoveryHome'
    | 'searchRecommendations'
    | 'updateRecommendationState'
    | 'getDiscoveryConfiguration'
    | 'updateDiscoveryConfiguration'
    | 'connectDiscoverySource'
  >,
): DiscoveryHost {
  return {
    getConfiguration: () => agent.getDiscoveryConfiguration(),
    updateConfiguration: (request) => agent.updateDiscoveryConfiguration(request),
    connectSource: (request) => agent.connectDiscoverySource(request),
    changeInterest: (request) => agent.changeInterest(request),
    setSessionParticipation: (request) => agent.setSessionParticipation(request),
    ensureDaily: (request) => agent.ensureDailyDiscovery(request),
    getHome: (request) => agent.getDiscoveryHome(request),
    searchRecommendations: (request) => agent.searchRecommendations(request),
    updateRecommendationState: (request) => agent.updateRecommendationState(request),
  };
}
