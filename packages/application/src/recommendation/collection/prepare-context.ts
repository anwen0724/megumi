/* Builds Candidate collection prompts from current pool facts and task-owned search state. */
import { buildSystemPrompt, escapeXmlText, loadSystemInstructionDocuments, type AgentContext } from '@megumi/agent';
import type { DiscoveryRepository } from '../recommendation-storage';
import type { SourceRegistry } from '../sources/source-catalog';
import type { CollectionTools } from './agent-tools';

/** Refreshes pool facts each turn while retaining only this run's model and tool messages. */
export function createCollectionContext(options: {
  readonly collection: CollectionTools;
  readonly repository: Pick<DiscoveryRepository, 'listNonDeletedInterests'>;
  readonly sources: SourceRegistry;
  readonly instructionDocuments: readonly { instructionId: string; sourcePath: string; }[];
}): AgentContext {
  return {
    async prepare({ runMessages, tools, signal }) {
      const documents = await loadSystemInstructionDocuments({ documents: options.instructionDocuments, signal });
      signal.throwIfAborted();
      const state = options.collection.readContextState();
      const pool = state.snapshot;
      const material = {
        execution: { startedAt: state.startedAt, trigger: state.trigger },
        pool: {
          minimumCount: pool.minimumCount, targetCount: pool.targetCount, maximumCount: pool.maximumCount,
          availableCount: pool.availableCount, minimumShortfall: pool.minimumShortfall,
          targetShortfall: pool.targetShortfall, availableByInterest: pool.availableByInterest
        },
        interests: options.repository.listNonDeletedInterests().filter(interest => interest.status === 'active')
          .map(interest => ({ interestId: interest.id, description: interest.description, interestRevision: interest.revision })),
        sources: options.sources.listSources().filter(({ descriptor, availability }) =>
          state.enabledSourceIds.includes(descriptor.id) && availability.state === 'ready'
          && (!availability.retryAt || Date.parse(availability.retryAt) <= Date.parse(pool.asOf)))
          .map(({ descriptor, availability }) => ({
            sourceId: descriptor.id, name: descriptor.name,
            access: descriptor.access, supportedModes: descriptor.supportedModes, supportsRead: descriptor.supportsRead,
            availability: availability.state, retryAt: availability.retryAt
          })),
      };
      const content = [
        'Execute the following Candidate Supply task.', '', '<candidate_supply_material>',
        `  <started_at>${escapeXmlText(state.startedAt)}</started_at>`,
        ...Object.entries(material).map(([key, value]) => `  <${key}>${escapeXmlText(JSON.stringify(value))}</${key}>`),
        '</candidate_supply_material>',
      ].join('\n');
      return {
        systemPrompt: buildSystemPrompt({ systemInstructions: documents, tools, includeAvailableTools: false }),
        messages: [{ role: 'user', content, timestamp: runMessages[0]?.timestamp ?? Date.parse(state.startedAt) }, ...runMessages.slice(1)],
        tools,
      };
    },
  };
}
