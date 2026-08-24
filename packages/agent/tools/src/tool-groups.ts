/* Defines which registered built-in tools are visible to each Megumi execution profile. */
export type BuiltInToolGroupId = 'conversation' | 'daily_discovery';

const CONVERSATION_TOOL_NAMES = new Set([
  'read_file', 'list_directory', 'glob', 'search_text', 'edit_file', 'write_file',
  'create_directory', 'copy_path', 'move_path', 'delete_path', 'run_command',
  'web_search', 'web_fetch', 'update_plan',
]);

const DAILY_DISCOVERY_TOOL_NAMES = new Set([
  'search_content', 'read_candidate', 'select_recommendations',
]);

export function toolBelongsToGroup(toolName: string, groupId: BuiltInToolGroupId): boolean {
  return groupId === 'conversation'
    ? CONVERSATION_TOOL_NAMES.has(toolName)
    : DAILY_DISCOVERY_TOOL_NAMES.has(toolName);
}
