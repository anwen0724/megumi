/* Builds the same safe, user-facing Tool Activity target for live and historical facts. */
export function summarizeToolTarget(toolName: string, input: unknown): string | undefined {
  const data = isRecord(input) ? input : {};
  if (toolName === 'list_directory') return displayPath(stringField(data, 'path'));
  if (toolName === 'read_file') return displayPath(stringField(data, 'path'));
  if (toolName === 'glob') return stringField(data, 'pattern');
  if (toolName === 'search_text') return stringField(data, 'query');
  if (toolName === 'edit_file') return displayPath(stringField(data, 'path'));
  if (toolName === 'write_file') return displayPath(stringField(data, 'path'));
  if (toolName === 'run_command') return stringField(data, 'command');
  if (toolName === 'web_search') return stringField(data, 'query');
  if (toolName === 'web_fetch') return stringField(data, 'url');
  return undefined;
}

function displayPath(path: string | undefined): string | undefined {
  if (!path || path === '.') return '工作区目录';
  return path;
}

function stringField(data: Record<string, unknown>, field: string): string | undefined {
  const value = data[field];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
