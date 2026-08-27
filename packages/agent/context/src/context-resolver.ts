/* Selects the context-source resolver for one prompt build and exposes one resolved-context union. */
import type { Api, Message, Model } from '@megumi/ai';
import type { InstructionReader } from '@megumi/instructions';
import type { SessionHistory } from '@megumi/session';
import type { Skills } from '@megumi/skills';
import type { ToolDefinition } from '@megumi/tools';
import type {
  ContextFailure,
  CandidateSupplyContextMaterial,
  ContextWorkspaceSource,
  DailyDiscoveryContextMaterial,
  DailyRecommendationContextMaterial,
} from './context';
import {
  createConversationContextResolver,
  type ConversationResolvedContext,
} from './resolvers/conversation-context-resolver';
import {
  createDailyDiscoveryContextResolver,
  type DailyDiscoveryResolvedContext,
} from './resolvers/daily-discovery-context-resolver';
import {
  createDailyRecommendationContextResolver,
  type DailyRecommendationResolvedContext,
} from './resolvers/daily-recommendation-context-resolver';
import {
  createCandidateSupplyContextResolver,
  type CandidateSupplyResolvedContext,
} from './resolvers/candidate-supply-context-resolver';

export type ResolvedContext = ConversationResolvedContext | DailyDiscoveryResolvedContext
  | DailyRecommendationResolvedContext | CandidateSupplyResolvedContext;

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
      readonly kind: 'daily_discovery';
      readonly localDate: string;
      readonly material: DailyDiscoveryContextMaterial;
      readonly currentMessages: readonly Message[];
      readonly tools: readonly ToolDefinition[];
      readonly signal?: AbortSignal;
    }
  | {
      readonly kind: 'daily_recommendation';
      readonly localDate: string;
      readonly material: DailyRecommendationContextMaterial;
      readonly currentMessages: readonly Message[];
      readonly tools: readonly ToolDefinition[];
      readonly signal?: AbortSignal;
    }
  | {
      readonly kind: 'candidate_supply';
      readonly startedAt: string;
      readonly material: CandidateSupplyContextMaterial;
      readonly currentMessages: readonly Message[];
      readonly tools: readonly ToolDefinition[];
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
}

export function createContextResolver(dependencies: ContextResolverDependencies): ContextResolver {
  const conversation = createConversationContextResolver(dependencies);
  const dailyDiscovery = createDailyDiscoveryContextResolver({
    instructionReader: dependencies.instructionReader,
  });
  const dailyRecommendation = createDailyRecommendationContextResolver({
    instructionReader: dependencies.instructionReader,
  });
  const candidateSupply = createCandidateSupplyContextResolver({
    instructionReader: dependencies.instructionReader,
  });
  return {
    resolve(request) {
      if (request.kind === 'conversation') return conversation.resolve(request);
      if (request.kind === 'daily_discovery') return dailyDiscovery.resolve(request);
      return request.kind === 'daily_recommendation'
        ? dailyRecommendation.resolve(request)
        : candidateSupply.resolve(request);
    },
  };
}
