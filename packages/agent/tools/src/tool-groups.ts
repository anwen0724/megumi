/* Defines which registered built-in tools are visible to each Megumi execution profile. */
export type BuiltInToolGroupId = 'conversation' | 'daily_discovery' | 'daily_recommendation' | 'candidate_supply';

const CONVERSATION_TOOL_NAMES = new Set([
  'read_file', 'list_directory', 'glob', 'search_text', 'edit_file', 'write_file',
  'create_directory', 'copy_path', 'move_path', 'delete_path', 'run_command',
  'web_search', 'web_fetch', 'update_plan',
]);

const DAILY_DISCOVERY_TOOL_NAMES = new Set([
  'search_content', 'read_candidate', 'select_recommendations',
]);

const CANDIDATE_SUPPLY_TOOL_NAMES = new Set([
  'search_content', 'read_source_candidate', 'commit_candidate_admission',
]);

const DAILY_RECOMMENDATION_TOOL_NAMES = new Set([
  'read_pool_candidate', 'publish_daily_recommendations',
]);

export function toolBelongsToGroup(toolName: string, groupId: BuiltInToolGroupId): boolean {
  if (groupId === 'conversation') return CONVERSATION_TOOL_NAMES.has(toolName);
  if (groupId === 'daily_recommendation') return DAILY_RECOMMENDATION_TOOL_NAMES.has(toolName);
  return groupId === 'daily_discovery'
    ? DAILY_DISCOVERY_TOOL_NAMES.has(toolName)
    : CANDIDATE_SUPPLY_TOOL_NAMES.has(toolName);
}
