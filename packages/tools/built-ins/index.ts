import type { ToolDefinition } from '@megumi/shared/tool-contracts';
import { createStaticToolRegistry } from '../registry';
import { editFileDefinition } from './edit-file.definition';
import { globDefinition } from './glob.definition';
import { listDirectoryDefinition } from './list-directory.definition';
import { readFileDefinition } from './read-file.definition';
import { runCommandDefinition } from './run-command.definition';
import { searchTextDefinition } from './search-text.definition';
import { writeFileDefinition } from './write-file.definition';

export const BUILT_IN_TOOL_NAMES = [
  'read_file',
  'list_directory',
  'glob',
  'search_text',
  'edit_file',
  'write_file',
  'run_command',
] as const;

export const BUILT_IN_TOOL_DEFINITIONS: ToolDefinition[] = [
  readFileDefinition,
  listDirectoryDefinition,
  globDefinition,
  searchTextDefinition,
  editFileDefinition,
  writeFileDefinition,
  runCommandDefinition,
];

export function createBuiltInToolRegistry() {
  return createStaticToolRegistry(BUILT_IN_TOOL_DEFINITIONS);
}
