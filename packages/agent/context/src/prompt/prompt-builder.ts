/*
 * Builds the final provider-neutral Prompt from one complete ResolvedContext:
 * System Prompt via SystemPromptBuilder, messages via ContextMessageBuilder and
 * tools verbatim from the already-decided ModelCall facts. Returns the Prompt
 * together with the MaterializedHistory compaction needs. Reads no external
 * sources and depends on neither ModelCallContext nor the full Model.
 */

import type { Message } from '@megumi/ai';
import type { SessionAttachmentReader } from '@megumi/session';
import type { ContextFailure, Prompt } from '../context';
import type { ResolvedContext } from '../context-resolver';
import type { ConversationResolvedContext } from '../resolvers/conversation-context-resolver';
import type { RecommendationResolvedContext } from '../resolvers/recommendation-context-resolver';
import type { CandidateSupplyResolvedContext } from '../resolvers/candidate-supply-context-resolver';
import type { PreferenceLearningResolvedContext } from '../resolvers/preference-learning-context-resolver';
import { buildContextMessages, type MaterializedHistory } from './context-message-builder';
import { escapeXmlText } from './prompt-markup-formatter';
import { buildSystemPrompt } from './system-prompt-builder';

export interface PromptBuilderDependencies {
  readonly attachmentReader: Pick<SessionAttachmentReader, 'readAttachmentContent'>;
}

export type BuildPromptResult =
  | {
      readonly status: 'built';
      readonly kind: 'conversation';
      readonly prompt: Prompt;
      readonly materializedHistory: MaterializedHistory;
    }
  | {
      readonly status: 'built';
      readonly kind: 'recommendation';
      readonly prompt: Prompt;
    }
  | {
      readonly status: 'built';
      readonly kind: 'candidate_supply';
      readonly prompt: Prompt;
    }
  | {
      readonly status: 'built';
      readonly kind: 'preference_learning';
      readonly prompt: Prompt;
    }
  | { readonly status: 'failed'; readonly failure: ContextFailure };

export interface PromptBuilder {
  build(request: {
    readonly context: ResolvedContext;
    readonly signal?: AbortSignal;
  }): Promise<BuildPromptResult>;
}

export function createPromptBuilder(dependencies: PromptBuilderDependencies): PromptBuilder {
  return {
    async build(request) {
      if (request.context.kind === 'conversation') {
        return buildConversationPrompt(request.context, dependencies, request.signal);
      }
      if (request.context.kind === 'recommendation') {
        return buildRecommendationPrompt(request.context);
      }
      return request.context.kind === 'candidate_supply'
        ? buildCandidateSupplyPrompt(request.context)
        : buildPreferenceLearningPrompt(request.context);
    },
  };
}

function buildPreferenceLearningPrompt(
  context: PreferenceLearningResolvedContext,
): BuildPromptResult {
  return {
    status: 'built',
    kind: 'preference_learning',
    prompt: {
      systemPrompt: buildSystemPrompt({
        systemInstructions: context.systemInstructions,
        preferenceLearningMaterial: {
          startedAt: context.startedAt,
          material: context.material,
        },
        tools: [],
      }),
      messages: [...context.currentMessages],
      tools: [],
    },
  };
}

function buildCandidateSupplyPrompt(
  context: CandidateSupplyResolvedContext,
): BuildPromptResult {
  return {
    status: 'built',
    kind: 'candidate_supply',
    prompt: {
      systemPrompt: buildSystemPrompt({
        systemInstructions: context.systemInstructions,
        tools: context.tools,
        includeAvailableTools: false,
      }),
      messages: buildCandidateSupplyMessages(context),
      tools: [...context.tools],
    },
  };
}

/** Replaces the internal kickoff placeholder with the current execution facts. */
function buildCandidateSupplyMessages(
  context: CandidateSupplyResolvedContext,
): readonly Message[] {
  const taskMessage: Message = {
    role: 'user',
    content: renderCandidateSupplyTask(context),
    timestamp: context.currentMessages[0]?.timestamp ?? Date.parse(context.startedAt),
  };
  return [taskMessage, ...context.currentMessages.slice(1)];
}

function renderCandidateSupplyTask(context: CandidateSupplyResolvedContext): string {
  const material = context.material;
  return [
    'Execute the following Candidate Supply task.',
    '',
    '<candidate_supply_material>',
    `  <started_at>${escapeXmlText(context.startedAt)}</started_at>`,
    `  <execution>${escapeXmlText(JSON.stringify(material.execution))}</execution>`,
    `  <pool>${escapeXmlText(JSON.stringify(material.pool))}</pool>`,
    `  <interests>${escapeXmlText(JSON.stringify(material.interests))}</interests>`,
    `  <sources>${escapeXmlText(JSON.stringify(material.sources))}</sources>`,
    '</candidate_supply_material>',
  ].join('\n');
}

async function buildConversationPrompt(
  context: ConversationResolvedContext,
  dependencies: PromptBuilderDependencies,
  signal?: AbortSignal,
): Promise<BuildPromptResult> {
  const converted = await buildContextMessages({
    history: context.activeSessionHistory,
    attachmentReader: dependencies.attachmentReader,
    imageInputSupport: context.imageInputSupport,
    signal,
  });
  if (converted.status === 'failed') return converted;
  return {
    status: 'built',
    kind: 'conversation',
    prompt: {
      systemPrompt: buildSystemPrompt({
        systemInstructions: context.systemInstructions,
        effectiveInstructions: context.effectiveInstructions,
        skills: context.skillView,
        executionEnvironment: context.executionEnvironment,
        tools: context.tools,
      }),
      messages: converted.materialized.messages,
      tools: [...context.tools],
    },
    materializedHistory: converted.materialized,
  };
}

function buildRecommendationPrompt(
  context: RecommendationResolvedContext,
): BuildPromptResult {
  return {
    status: 'built',
    kind: 'recommendation',
    prompt: {
      systemPrompt: buildSystemPrompt({
        systemInstructions: context.systemInstructions,
        tools: context.tools,
        includeAvailableTools: false,
      }),
      messages: buildRecommendationMessages(context),
      tools: [...context.tools],
    },
  };
}

/** Replaces the internal kickoff placeholder with the frozen Recommendation task. */
function buildRecommendationMessages(
  context: RecommendationResolvedContext,
): readonly Message[] {
  const taskMessage: Message = {
    role: 'user',
    content: renderRecommendationTask(context),
    timestamp: context.currentMessages[0]?.timestamp
      ?? Date.parse(`${context.localDate}T00:00:00.000Z`),
  };
  return [taskMessage, ...context.currentMessages.slice(1)];
}

function renderRecommendationTask(context: RecommendationResolvedContext): string {
  const material = context.material;
  return [
    'Execute the following Recommendation task.',
    '',
    '<recommendation_material>',
    `  <local_date>${escapeXmlText(context.localDate)}</local_date>`,
    `  <execution>${escapeXmlText(JSON.stringify(material.execution))}</execution>`,
    `  <interests>${escapeXmlText(JSON.stringify(material.interests))}</interests>`,
    `  <preferences>${escapeXmlText(JSON.stringify(material.preferences))}</preferences>`,
    `  <candidates>${escapeXmlText(JSON.stringify(material.candidates))}</candidates>`,
    `  <recent_recommendations>${escapeXmlText(JSON.stringify(material.recentRecommendations))}</recent_recommendations>`,
    '</recommendation_material>',
  ].join('\n');
}
