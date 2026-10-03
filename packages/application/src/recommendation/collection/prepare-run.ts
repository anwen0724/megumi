/* Prepares the selected model, policy and task-bound tools for Candidate collection. */
import type { AgentConfig, AgentExecutionPolicy } from '@megumi/agent';
import type { Api, Model } from '@megumi/ai';

import { createCollectionTools, type CollectionTools, type CreateCollectionToolsOptions } from './agent-tools';

export interface CollectionPreparation {
  readonly policy: AgentExecutionPolicy;
  readonly instructionDocuments: readonly { instructionId: string; sourcePath: string; }[];
  readonly resolveModel: (selection?: { providerId: string; modelId: string; }) => Promise<Model<Api> | undefined>;
}

/** Returns a complete configuration or reports that no configured model is available. */
export async function prepareCollectionRun(input: {
  readonly modelSelection?: { providerId: string; modelId: string; };
  readonly collection: CreateCollectionToolsOptions;
  readonly signal: AbortSignal;
}, dependencies: CollectionPreparation): Promise<{ readonly config: AgentConfig; readonly collection: CollectionTools; } | undefined> {
  const model = await dependencies.resolveModel(input.modelSelection);
  input.signal.throwIfAborted();
  if (!model) return undefined;
  const collection = createCollectionTools(input.collection);
  return {
    collection,
    config: {
      model,
      tools: collection.tools,
      permissionMode: 'auto',
      policy: { ...dependencies.policy },
    },
  };
}
