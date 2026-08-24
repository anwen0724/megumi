/*
 * Builds the final provider-neutral Prompt from one complete ResolvedContext:
 * System Prompt via SystemPromptBuilder, messages via ContextMessageBuilder and
 * tools verbatim from the already-decided ModelCall facts. Returns the Prompt
 * together with the MaterializedHistory compaction needs. Reads no external
 * sources and depends on neither ModelCallContext nor the full Model.
 */

import type { SessionAttachmentReader } from '@megumi/session';
import type { ContextFailure, Prompt } from '../context';
import type { ResolvedContext } from '../context-resolver';
import type { ConversationResolvedContext } from '../resolvers/conversation-context-resolver';
import type { DailyDiscoveryResolvedContext } from '../resolvers/daily-discovery-context-resolver';
import { buildContextMessages, type MaterializedHistory } from './context-message-builder';
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
      readonly kind: 'daily_discovery';
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
      return request.context.kind === 'conversation'
        ? buildConversationPrompt(request.context, dependencies, request.signal)
        : buildDailyDiscoveryPrompt(request.context);
    },
  };
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

function buildDailyDiscoveryPrompt(
  context: DailyDiscoveryResolvedContext,
): BuildPromptResult {
  return {
    status: 'built',
    kind: 'daily_discovery',
    prompt: {
      systemPrompt: buildSystemPrompt({
        systemInstructions: context.systemInstructions,
        dailyDiscoveryMaterial: {
          localDate: context.localDate,
          material: context.material,
        },
        tools: context.tools,
      }),
      messages: [...context.currentMessages],
      tools: [...context.tools],
    },
  };
}
