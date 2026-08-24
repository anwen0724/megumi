/*
 * Creates the built-in commands with explicit composition-time dependencies.
 */
import type { Api, Model } from "@megumi/ai";
import type { CommandDefinition } from "./commands";

export interface ContextCompactor {
  compact(
    request: {
      readonly sessionId: string;
      readonly workspaceId: string;
      readonly model: Model<Api>;
    },
    options?: { readonly signal?: AbortSignal },
  ): Promise<
    | { readonly status: "compacted" }
    | { readonly status: "nothing_to_compact"; readonly reason: string }
    | {
        readonly status: "failed";
        readonly failure: { readonly code?: string; readonly message: string };
      }
  >;
}

export function createBuiltInCommands(options: {
  readonly compact?: ContextCompactor["compact"];
} = {}): readonly CommandDefinition[] {
  return [
    {
      name: "compact",
      description: "Compact the current session context",
      requiresSession: true,
      async handle({ context }, operationOptions) {
        if (operationOptions?.signal?.aborted) return { type: "cancelled" };
        if (!context.sessionId || !context.model || !options.compact) {
          return {
            type: "host_interaction_request",
            request: { kind: "context_compaction" },
          };
        }
        const result = await options.compact({
          sessionId: context.sessionId,
          workspaceId: context.workspaceId,
          model: context.model,
        }, operationOptions);
        if (operationOptions?.signal?.aborted) return { type: "cancelled" };
        if (result.status === "failed") {
          return result.failure.code === "cancelled"
            ? { type: "cancelled" }
            : { type: "error", message: result.failure.message };
        }
        if (result.status === "nothing_to_compact") {
          return { type: "completed", message: `Context compaction skipped: ${result.reason}` };
        }
        return { type: "completed", message: "Context compacted." };
      },
    },
  ];
}
