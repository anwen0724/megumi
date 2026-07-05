/*
 * Composes Context module services with existing Coding Agent persistence and prompt resources.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ContextRepository } from './context-repository';
import {
  ContextCompactionService,
  ContextService,
  ContextUsageMonitor,
  type ContextInstructionSourcePort,
  type ContextSummaryModelCallPort,
  type ContextUsageSignal,
  type ContextUsageWindow,
  type PromptLogPort,
} from '../context';
import type { SessionService } from '../session';

export type DeveloperPromptLogger = {
  debug(event_name: 'context.prompt.built', payload: Parameters<PromptLogPort['writePrompt']>[0]): void;
};

export type ContextUsageSignalBus = {
  publish(input: { subscription_id: string; signal: ContextUsageSignal }): Promise<void>;
  subscribe(
    signalKind: ContextUsageSignal['kind'],
    handler: (signal: ContextUsageSignal) => void | Promise<void>,
  ): () => void;
};

export function createContextUsageSignalBus(): ContextUsageSignalBus {
  const handlers = new Map<ContextUsageSignal['kind'], Set<(signal: ContextUsageSignal) => void | Promise<void>>>();

  return {
    async publish(input) {
      for (const handler of handlers.get(input.signal.kind) ?? []) {
        await handler(input.signal);
      }
    },
    subscribe(signalKind, handler) {
      const signalHandlers = handlers.get(signalKind) ?? new Set();
      signalHandlers.add(handler);
      handlers.set(signalKind, signalHandlers);
      return () => {
        signalHandlers.delete(handler);
      };
    },
  };
}

export function composeCodingAgentContext(input: {
  sessionService: Pick<SessionService, 'getActiveHistory' | 'saveCompactionSummary'>;
  runtimeEventRepository: ConstructorParameters<typeof ContextRepository>[0]['runtimeEventRepository'];
  agentInstructionSourceService?: ContextInstructionSourcePort;
  summaryModelCallPort: ContextSummaryModelCallPort;
  modelConfigProvider: (input: { session_id: string; workspace_id?: string }) => ContextUsageWindow;
  developerPromptLogger?: DeveloperPromptLogger;
}) {
  const contextUsageSignalBus = createContextUsageSignalBus();
  const internalAutoCompactionSubscriptionIds = new Set<string>();
  const contextRepository = new ContextRepository({
    sessionService: input.sessionService,
    runtimeEventRepository: input.runtimeEventRepository,
  });
  const systemPromptText = loadPromptResource('system-prompt.md');
  const contextCompactionPromptText = loadPromptResource('context-compaction-prompt.md');
  const developerPromptLog: PromptLogPort | undefined = input.developerPromptLogger
    ? {
        writePrompt(prompt) {
          input.developerPromptLogger?.debug('context.prompt.built', prompt);
        },
      }
    : undefined;
  const contextService = new ContextService({
    repository: contextRepository,
    instructionSource: input.agentInstructionSourceService,
    promptResources: { system_prompt: systemPromptText },
    promptLog: developerPromptLog,
  });
  const contextUsageMonitor = new ContextUsageMonitor({
    contextService,
    fixedPromptText: systemPromptText,
    signalSink: async (signalInput) => {
      if (internalAutoCompactionSubscriptionIds.has(signalInput.subscription_id)) {
        await contextUsageSignalBus.publish(signalInput);
      }
    },
  });
  const contextCompactionService = new ContextCompactionService({
    contextService,
    repository: contextRepository,
    modelCall: input.summaryModelCallPort,
    modelConfigProvider: input.modelConfigProvider,
    promptResources: { context_compaction_prompt: contextCompactionPromptText },
    promptLog: developerPromptLog,
  });
  const originalStart = contextUsageMonitor.start.bind(contextUsageMonitor);
  contextUsageMonitor.start = async (request) => {
    const result = await originalStart(request);
    if (result.status === 'ok') {
      const subscription = contextUsageMonitor.subscribe({
        session_id: request.session_id,
        ...(request.workspace_id ? { workspace_id: request.workspace_id } : {}),
        signal_kinds: ['auto_compaction_needed'],
      });
      if (subscription.status === 'ok') {
        internalAutoCompactionSubscriptionIds.add(subscription.subscription_id);
      }
    }
    return result;
  };
  return {
    contextRepository,
    contextService,
    contextUsageMonitor,
    contextUsageSignalBus,
    contextCompactionService,
  };
}

function loadPromptResource(fileName: string): string {
  return readFileSync(path.join(process.cwd(), 'packages', 'prompts', fileName), 'utf8');
}
