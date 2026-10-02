/* Selects registered tools for a run; the Tools module receives only the selected names. */

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
  'submit_recommendations',
]);

/** Selects permitted names; unavailable registrations are omitted by Tools when preparing a model call. */
export function selectRunTools(kind: 'conversation' | 'recommendation' | 'candidate_supply'): readonly string[] {
  return [...(kind === 'conversation' ? CONVERSATION_TOOL_NAMES
    : kind === 'recommendation' ? RECOMMENDATION_TOOL_NAMES : CANDIDATE_SUPPLY_TOOL_NAMES)];
}
