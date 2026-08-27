/* Selects the context-source resolver for one prompt build and exposes one resolved-context union. */
import type { Api, Message, Model } from '@megumi/ai';
import type { InstructionReader } from '@megumi/instructions';
import type { SessionHistory } from '@megumi/session';
import type { Skills } from '@megumi/skills';
import type { ToolDefinition } from '@megumi/tools';
import type { ContextFailure, ContextWorkspaceSource } from './context';
import type { ContextDiscoverySourceRegistry, DiscoveryFactsReader } from './discovery-context';
import {
  createConversationContextResolver,
  type ConversationResolvedContext,
} from './resolvers/conversation-context-resolver';
import {
  createDailyRecommendationContextResolver,
  type DailyRecommendationResolvedContext,
} from './resolvers/daily-recommendation-context-resolver';
import {
  createCandidateSupplyContextResolver,
  type CandidateSupplyResolvedContext,
} from './resolvers/candidate-supply-context-resolver';
import {
  createPreferenceLearningContextResolver,
  type PreferenceLearningResolvedContext,
} from './resolvers/preference-learning-context-resolver';

export type ResolvedContext = ConversationResolvedContext
  | DailyRecommendationResolvedContext | CandidateSupplyResolvedContext
  | PreferenceLearningResolvedContext;

export type ResolveContextRequest =
  | {
      readonly kind: 'conversation';
      readonly sessionId: string;
      readonly workspaceId: string;
      readonly model: Model<Api>;
      readonly tools: readonly ToolDefinition[];
      readonly signal?: AbortSignal;
    }
  | {
      readonly kind: 'daily_recommendation';
      readonly executionId: string;
      readonly batchId: string;
      readonly localDate: string;
      readonly currentMessages: readonly Message[];
      readonly tools: readonly ToolDefinition[];
      readonly signal?: AbortSignal;
    }
  | {
      readonly kind: 'candidate_supply';
      readonly executionId: string;
      readonly startedAt: string;
      readonly trigger: string;
      readonly currentMessages: readonly Message[];
      readonly tools: readonly ToolDefinition[];
      readonly signal?: AbortSignal;
    }
  | {
      readonly kind: 'preference_learning';
      readonly batchId: string;
      readonly startedAt: string;
      readonly currentMessages: readonly Message[];
      readonly signal?: AbortSignal;
    };

export type ResolveContextResult =
  | { readonly status: 'resolved'; readonly context: ResolvedContext }
  | { readonly status: 'failed'; readonly failure: ContextFailure };

export interface ContextResolver {
  resolve(request: ResolveContextRequest): Promise<ResolveContextResult>;
}

export interface ContextResolverDependencies {
  readonly sessionHistory: Pick<SessionHistory, 'getActiveHistory'>;
  readonly workspaceSource: ContextWorkspaceSource;
  readonly instructionReader: InstructionReader;
  readonly skills: Pick<Skills, 'createView'>;
  readonly factsReader: DiscoveryFactsReader;
  readonly sourceRegistry: ContextDiscoverySourceRegistry;
}

export function createContextResolver(dependencies: ContextResolverDependencies): ContextResolver {
  const conversation = createConversationContextResolver(dependencies);
  const dailyRecommendation = createDailyRecommendationContextResolver({
    instructionReader: dependencies.instructionReader,
    factsReader: dependencies.factsReader,
  });
  const candidateSupply = createCandidateSupplyContextResolver({
    instructionReader: dependencies.instructionReader,
    factsReader: dependencies.factsReader,
    sourceRegistry: dependencies.sourceRegistry,
  });
  const preferenceLearning = createPreferenceLearningContextResolver({
    instructionReader: dependencies.instructionReader,
    factsReader: dependencies.factsReader,
  });
  return {
    resolve(request) {
      if (request.kind === 'conversation') return conversation.resolve(request);
      if (request.kind === 'daily_recommendation') return dailyRecommendation.resolve(request);
      return request.kind === 'candidate_supply'
        ? candidateSupply.resolve(request)
        : preferenceLearning.resolve(request);
    },
  };
}
