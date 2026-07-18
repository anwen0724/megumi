/*
 * Defines Agent built-in slash commands. These commands belong to the
 * product core and must not depend on Desktop, Electron, or UI shell modules.
 */

import type { CommandDefinition } from '../contracts/command-contracts';

export const built_in_commands: CommandDefinition[] = [
  {
    name: 'compact',
    description: 'Compact the current session context',
    source: { kind: 'built_in' },
    async execute(request) {
      const executionContext = request.execution_context;
      const contextService = executionContext?.services?.context;
      if (executionContext?.session_id && executionContext.workspace_id && executionContext.model_context && contextService) {
        const result = await contextService.compactSession({
          sessionId: executionContext.session_id,
          workspaceId: executionContext.workspace_id,
          modelContext: executionContext.model_context,
          imageInputSupport: executionContext.image_input_support ?? 'unknown',
        });

        if (result.status === 'failed') {
          return { type: 'error', message: result.failure.message };
        }

        if (result.status === 'nothing_to_compact') {
          return { type: 'completed', message: `Context compaction skipped: ${result.reason}` };
        }

        return { type: 'completed', message: 'Context compacted.' };
      }

      return {
        type: 'host_interaction_request',
        request: {
          kind: 'context_compaction',
        },
      };
    },
  },
  {
    name: 'review',
    description: 'Evaluate review feedback before implementing changes',
    source: { kind: 'built_in' },
    async execute({ invocation }) {
      return {
        type: 'agent_run',
        input: {
          raw_input: invocation.raw_input,
          command: {
            name: invocation.name,
            source: { kind: 'built_in' },
            arguments_input: invocation.arguments_input,
          },
        },
      };
    },
  },
];
