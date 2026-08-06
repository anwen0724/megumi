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
import { buildContextMessages, type MaterializedHistory } from './context-message-builder';
import { buildSystemPrompt } from './system-prompt-builder';

export interface PromptBuilderDependencies {
  readonly attachmentReader: Pick<SessionAttachmentReader, 'readAttachmentContent'>;
}

export type BuildPromptResult =
  | { readonly status: 'built'; readonly prompt: Prompt; readonly materializedHistory: MaterializedHistory }
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
      const converted = await buildContextMessages({
        history: request.context.activeSessionHistory,
        attachmentReader: dependencies.attachmentReader,
        imageInputSupport: request.context.imageInputSupport,
        signal: request.signal,
      });
      if (converted.status === 'failed') return converted;
      const systemPrompt = buildSystemPrompt({
        baseInstructions: request.context.baseInstructions,
        effectiveInstructions: request.context.effectiveInstructions,
        skills: request.context.skillView,
        executionEnvironment: request.context.executionEnvironment,
      });
      return {
        status: 'built',
        prompt: {
          systemPrompt,
          messages: converted.materialized.messages,
          tools: [...request.context.tools],
        },
        materializedHistory: converted.materialized,
      };
    },
  };
}
