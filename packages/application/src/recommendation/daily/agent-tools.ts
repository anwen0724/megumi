/* Exposes Recommendation workset operations as complete Agent tool objects. */
import type { AgentTool } from '@megumi/agent';
import { Type } from '@megumi/ai';
import type { CandidateWorkset } from './candidate-workset';

/** Binds the local read, expansion and draft submission tools to one attempt. */
export function createRecommendationTools(workset: CandidateWorkset): readonly AgentTool[] {
  return [
    {
      name: 'read_recommendation_candidate',
      description: 'Read the persisted local content for one Candidate in the current recommendation window.',
      promptSnippet: 'Read one current-window Candidate locally when its compact summary is insufficient.',
      parameters: Type.Object({ candidateId: Type.String() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      executionMode: 'serial',
      operations: () => [],
      execute: (input, execution) => workset.readRecommendationCandidate({
        input, executionId: execution.runId, signal: execution.signal,
      }),
    },
    {
      name: 'expand_recommendation_working_set',
      description: 'Expose the next deterministic segment of the frozen Recommendation ranking.',
      promptSnippet: 'Expand the working set only when more frozen Candidates are needed for comparison.',
      parameters: Type.Object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
      executionMode: 'serial',
      operations: () => [],
      execute: (input, execution) => workset.expandRecommendationWorkingSet({
        input, executionId: execution.runId, signal: execution.signal,
      }),
    },
    {
      name: 'submit_recommendations',
      description: 'Submit the complete ordered recommendation draft. An accepted draft ends this run; the application validates and publishes it after successful completion.',
      promptSnippet: 'Submit the final ordered Candidate IDs and one user-facing reason per recommendation.',
      parameters: Type.Object({
        items: Type.Array(Type.Object({
          candidateId: Type.String(),
          recommendationReason: Type.String(),
        }), { minItems: 1, maxItems: 100 }),
      }),
      annotations: { idempotentHint: true, openWorldHint: false },
      executionMode: 'serial',
      operations: () => [],
      execute: (input, execution) => workset.submitRecommendations({
        input, executionId: execution.runId, signal: execution.signal,
      }),
    }
  ];
}
