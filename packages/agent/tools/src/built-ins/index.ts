/* Registers built-in Definition/Handler pairs without owning ModelCall selection. */

import type { ToolDefinition, ToolSource } from '../tool';
import type { ToolHandler, ToolRegistration } from '../tool-handler';
import { createToolRegistry, type ToolRegistry } from '../tool-registry';
import { createDirectoryToolDefinition, createDirectoryToolHandler } from './create-directory';
import {
  createSubmitCandidatesToolHandler,
  submitCandidatesToolDefinition,
  type SubmitCandidatesOperation,
} from './submit-candidates';
import { copyPathToolDefinition, copyPathToolHandler } from './copy-path';
import { deletePathToolDefinition, deletePathToolHandler } from './delete-path';
import { editFileToolDefinition, editFileToolHandler } from './edit-file';
import { globToolDefinition, globToolHandler } from './glob';
import { listDirectoryToolDefinition, listDirectoryToolHandler } from './list-directory';
import { movePathToolDefinition, movePathToolHandler } from './move-path';
import { readFileToolDefinition, readFileToolHandler } from './read-file';
import { createReadSourceCandidateToolHandler, readSourceCandidateToolDefinition, type ReadSourceCandidateOperation } from './read-source-candidate';
import { createReadRecommendationCandidateToolHandler, readRecommendationCandidateToolDefinition, type ReadRecommendationCandidateOperation } from './read-recommendation-candidate';
import { createPublishRecommendationsToolHandler, publishRecommendationsToolDefinition, type PublishRecommendationsOperation } from './publish-recommendations';
import {
  createExpandRecommendationWorkingSetToolHandler,
  expandRecommendationWorkingSetToolDefinition,
  type ExpandRecommendationWorkingSetOperation,
} from './expand-recommendation-working-set';
import {
  createRunCommandToolDefinition,
  createRunCommandToolHandler,
  type ToolProcessDescriptor,
} from './run-command';
import { searchTextToolDefinition, searchTextToolHandler } from './search-text';
import { createSearchContentToolHandler, searchContentToolDefinition, type SearchContentOperation } from './search-content';
import { updatePlanToolDefinition, updatePlanToolHandler } from './update-plan';
import { webFetchToolDefinition, webFetchToolHandler } from './web-fetch';
import { webSearchToolDefinition, webSearchToolHandler } from './web-search';
import type { BuiltInToolContext } from './workspace-file-access';
import { writeFileToolDefinition, writeFileToolHandler } from './write-file';

export const BUILT_IN_TOOL_NAMES = [
  'read_file', 'list_directory', 'glob', 'search_text', 'edit_file', 'write_file',
  'create_directory', 'copy_path', 'move_path', 'delete_path', 'run_command',
  'web_search', 'web_fetch', 'update_plan',
  'search_content',
  'read_source_candidate', 'submit_candidates',
  'read_recommendation_candidate', 'expand_recommendation_working_set', 'publish_recommendations',
] as const;

export type BuiltInToolName = (typeof BUILT_IN_TOOL_NAMES)[number];

const BUILT_IN_TOOL_SOURCE: ToolSource = {
  sourceId: 'built_in',
  sourceKind: 'built_in',
  namespace: 'megumi',
  displayName: 'Built-in tools',
  configured: true,
  enabled: true,
  availabilityStatus: 'available',
};

export function createBuiltInToolRegistry(request: {
  readonly process?: ToolProcessDescriptor;
  readonly candidateSupplyTools?: SearchContentOperation & ReadSourceCandidateOperation
    & SubmitCandidatesOperation;
  readonly recommendationTools?: ReadRecommendationCandidateOperation
    & ExpandRecommendationWorkingSetOperation & PublishRecommendationsOperation;
}): ToolRegistry<BuiltInToolContext> {
  const pairs: Array<{
    readonly definition: ToolDefinition;
    readonly handler: ToolHandler<BuiltInToolContext>;
    readonly executionMode?: 'parallel' | 'serial';
  }> = [
    { definition: readFileToolDefinition, handler: readFileToolHandler },
    { definition: listDirectoryToolDefinition, handler: listDirectoryToolHandler },
    { definition: globToolDefinition, handler: globToolHandler },
    { definition: searchTextToolDefinition, handler: searchTextToolHandler },
    { definition: editFileToolDefinition, handler: editFileToolHandler, executionMode: 'serial' },
    { definition: writeFileToolDefinition, handler: writeFileToolHandler, executionMode: 'serial' },
    { definition: createDirectoryToolDefinition, handler: createDirectoryToolHandler, executionMode: 'serial' },
    { definition: copyPathToolDefinition, handler: copyPathToolHandler, executionMode: 'serial' },
    { definition: movePathToolDefinition, handler: movePathToolHandler, executionMode: 'serial' },
    { definition: deletePathToolDefinition, handler: deletePathToolHandler, executionMode: 'serial' },
    ...(request.process ? [{
      definition: createRunCommandToolDefinition(request.process),
      handler: createRunCommandToolHandler(request.process),
      executionMode: 'serial' as const,
    }] : []),
    { definition: webSearchToolDefinition, handler: webSearchToolHandler },
    { definition: webFetchToolDefinition, handler: webFetchToolHandler },
    { definition: updatePlanToolDefinition, handler: updatePlanToolHandler, executionMode: 'serial' },
    ...(request.candidateSupplyTools ? [
      { definition: searchContentToolDefinition, handler: createSearchContentToolHandler(request.candidateSupplyTools) },
      { definition: readSourceCandidateToolDefinition, handler: createReadSourceCandidateToolHandler(request.candidateSupplyTools) },
      {
      definition: submitCandidatesToolDefinition,
      handler: createSubmitCandidatesToolHandler(request.candidateSupplyTools),
      executionMode: 'serial' as const,
      },
    ] : []),
    ...(request.recommendationTools ? [
      { definition: readRecommendationCandidateToolDefinition, handler: createReadRecommendationCandidateToolHandler(request.recommendationTools) },
      {
        definition: expandRecommendationWorkingSetToolDefinition,
        handler: createExpandRecommendationWorkingSetToolHandler(request.recommendationTools),
      },
      {
        definition: publishRecommendationsToolDefinition,
        handler: createPublishRecommendationsToolHandler(request.recommendationTools),
        executionMode: 'serial' as const,
      },
    ] : []),
  ];
  return createToolRegistry({
    registrations: pairs.map((pair): ToolRegistration<BuiltInToolContext> => ({
      registrationId: `tool-registration-built_in-${pair.definition.name}`,
      source: BUILT_IN_TOOL_SOURCE,
      definition: pair.definition,
      handler: pair.handler,
      availability: { status: 'available' },
      ...(pair.executionMode ? { executionMode: pair.executionMode } : {}),
    })),
  });
}
