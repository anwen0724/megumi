// Replays provider reasoning state as model-visible continuation context.
import type { ModelStepProviderState } from '@megumi/shared/model';

import type { ModelInputContextPartDraft } from '../context-budget';

export function providerStateParts(
  providerStates: ModelStepProviderState[] | undefined,
  builtAt: string,
): ModelInputContextPartDraft[] {
  return (providerStates ?? []).map((providerState, index): ModelInputContextPartDraft => ({
    partId: `part:provider-state:${index + 1}:${providerState.modelStepId}`,
    kind: 'tool_continuation',
    text: providerStateSummary(providerState),
    modelStepId: String(providerState.modelStepId),
    providerStateIds: [`${providerState.modelStepId}:${index}`],
    providerStateText: providerStateSummary(providerState),
    sourceRefs: [{
      sourceId: `provider-state:${providerState.modelStepId}:${index}`,
      sourceKind: 'provider_state',
      sourceUri: `provider-state://${providerState.modelStepId}/${index}`,
      loadedAt: builtAt,
      metadata: {
        providerId: providerState.providerId,
        modelId: providerState.modelId,
      },
    }],
    priority: 75,
    retentionGroupId: `provider-state:${providerState.modelStepId}`,
  }));
}

function providerStateSummary(providerState: ModelStepProviderState): string {
  const blocks = providerState.blocks.map((block) => {
    switch (block.type) {
      case 'reasoning_content':
      case 'thinking':
        return block.text;
      case 'redacted_thinking':
        return '[redacted thinking omitted]';
      default:
        return '';
    }
  }).filter(Boolean);

  return blocks.length > 0
    ? blocks.join('\n')
    : `Provider state recorded for ${providerState.modelStepId}.`;
}
