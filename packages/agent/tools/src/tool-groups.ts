/* Defines which registered built-in tools are visible to each Megumi execution profile. */
export type BuiltInToolGroupId = 'conversation' | 'recommendation' | 'candidate_supply';

const CONVERSATION_TOOL_NAMES = new Set([
  'read_file', 'list_directory', 'glob', 'search_text', 'edit_file', 'write_file',
  'create_directory', 'copy_path', 'move_path', 'delete_path', 'run_command',
  'web_search', 'web_fetch', 'update_plan',
]);

const CANDIDATE_SUPPLY_TOOL_NAMES = new Set([
  'update_plan', 'search_content', 'read_source_candidate', 'submit_candidates',
]);

const RECOMMENDATION_TOOL_NAMES = new Set([
  'update_plan', 'read_recommendation_candidate', 'expand_recommendation_working_set',
  'publish_recommendations',
]);

export function toolBelongsToGroup(toolName: string, groupId: BuiltInToolGroupId): boolean {
  if (groupId === 'conversation') return CONVERSATION_TOOL_NAMES.has(toolName);
  if (groupId === 'recommendation') return RECOMMENDATION_TOOL_NAMES.has(toolName);
  return CANDIDATE_SUPPLY_TOOL_NAMES.has(toolName);
}
