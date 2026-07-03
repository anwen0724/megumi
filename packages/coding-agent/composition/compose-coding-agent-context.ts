/*
 * Composes Context module services with existing Coding Agent persistence and prompt resources.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ContextRepository } from '../context/services/context-repository';
import { ContextService, type ContextInstructionSourcePort, type PromptLogPort } from '../context/services/context-service';
import { ContextUsageMonitor } from '../context/services/context-usage-monitor';
import { ContextCompactionService, type ContextSummaryModelCallPort } from '../context/services/context-compaction-service';
import type { ModelConfig } from '../context/contracts/context-usage-contracts';

export type DeveloperPromptLogger = {
  debug(event_name: 'context.prompt.built', payload: Parameters<PromptLogPort['writePrompt']>[0]): void;
};

export function composeCodingAgentContext(input: {
  sessionRepository: ConstructorParameters<typeof ContextRepository>[0]['sessionRepository'];
  runtimeEventRepository: ConstructorParameters<typeof ContextRepository>[0]['runtimeEventRepository'];
  agentInstructionSourceService?: ContextInstructionSourcePort;
  summaryModelCallPort?: ContextSummaryModelCallPort;
  modelConfigProvider?: (input: { session_id: string; workspace_id?: string }) => ModelConfig;
  developerPromptLogger?: DeveloperPromptLogger;
}) {
  const contextRepository = new ContextRepository({
    sessionRepository: input.sessionRepository,
    activePathRepository: input.sessionRepository,
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
  });
  const contextCompactionService = new ContextCompactionService({
    contextService,
    repository: contextRepository,
    modelCall: input.summaryModelCallPort,
    modelConfigProvider: input.modelConfigProvider,
    promptResources: { context_compaction_prompt: contextCompactionPromptText },
    promptLog: developerPromptLog,
  });

  return {
    contextRepository,
    contextService,
    contextUsageMonitor,
    contextCompactionService,
  };
}

function loadPromptResource(fileName: string): string {
  return readFileSync(path.join(process.cwd(), 'packages', 'prompts', fileName), 'utf8');
}
