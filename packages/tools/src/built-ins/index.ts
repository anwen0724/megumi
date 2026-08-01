/* Creates one Run-bound set of built-in Tool registrations and their execution adapter. */

import type {
  ExecuteToolRequest,
  RawToolResult,
  ToolDefinition,
  ToolExecutionOptions,
  ToolRegistration,
  ToolSource,
} from '../tool';
import { createToolCatalog, type ToolCatalog } from '../tool-catalog';
import { createToolExecutor, type ToolExecutionAdapter, type ToolExecutor } from '../tool-executor';
import { createDirectoryToolDefinition, executeCreateDirectory } from './create-directory';
import { copyPathToolDefinition, executeCopyPath } from './copy-path';
import { deletePathToolDefinition, executeDeletePath } from './delete-path';
import { editFileToolDefinition, executeEditFile } from './edit-file';
import { executeGlob, globToolDefinition } from './glob';
import { executeListDirectory, listDirectoryToolDefinition } from './list-directory';
import { executeMovePath, movePathToolDefinition } from './move-path';
import { executeReadFile, readFileToolDefinition } from './read-file';
import {
  createRunCommandToolDefinition,
  executeRunCommand,
  type ToolProcessAdapter,
} from './run-command';
import { executeSearchText, searchTextToolDefinition } from './search-text';
import { executeUseSkill, useSkillToolDefinition } from './use-skill';
import { executeWebFetch, webFetchToolDefinition, type WebFetch } from './web-fetch';
import { executeWebSearch, webSearchToolDefinition, type WebSearch } from './web-search';
import {
  type BuiltInToolContext,
  type SkillUse,
  type WorkspaceFileAccess,
} from './workspace-file-access';
import { executeWriteFile, writeFileToolDefinition } from './write-file';

export const BUILT_IN_TOOL_NAMES = [
  'read_file',
  'list_directory',
  'glob',
  'search_text',
  'edit_file',
  'write_file',
  'create_directory',
  'copy_path',
  'move_path',
  'delete_path',
  'run_command',
  'use_skill',
  'web_search',
  'web_fetch',
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

export interface CreateToolsRequest {
  readonly workspaceFileAccess: WorkspaceFileAccess;
  readonly process?: ToolProcessAdapter;
  readonly skills?: SkillUse;
  readonly webSearch?: WebSearch;
  readonly webFetch?: WebFetch;
  readonly disabledToolNames?: readonly BuiltInToolName[];
}

export interface CreateToolsResult {
  readonly catalog: ToolCatalog;
  readonly executor: ToolExecutor;
}

export function createTools(request: CreateToolsRequest): CreateToolsResult {
  const context: BuiltInToolContext = {
    workspaceFileAccess: request.workspaceFileAccess,
    process: request.process,
    skills: request.skills,
    webSearch: request.webSearch,
    webFetch: request.webFetch,
  };
  const availableDefinitions = definitionsFor(context);
  const disabled = new Set(request.disabledToolNames ?? []);
  const registrations = availableDefinitions.map((definition): ToolRegistration => ({
    registrationId: `tool-registration-built_in-${definition.name}`,
    source: { ...BUILT_IN_TOOL_SOURCE },
    definition,
    enabled: !disabled.has(definition.name as BuiltInToolName),
    availability: disabled.has(definition.name as BuiltInToolName)
      ? { status: 'disabled', reason: 'Tool is disabled for this Run.' }
      : { status: 'available' },
  }));
  const catalog = createToolCatalog({ registrations });
  const adapter = createBuiltInToolAdapter(context);
  return { catalog, executor: createToolExecutor({ catalog, adapter }) };
}

function definitionsFor(context: BuiltInToolContext): readonly ToolDefinition[] {
  return [
    readFileToolDefinition,
    listDirectoryToolDefinition,
    globToolDefinition,
    searchTextToolDefinition,
    editFileToolDefinition,
    writeFileToolDefinition,
    createDirectoryToolDefinition,
    copyPathToolDefinition,
    movePathToolDefinition,
    deletePathToolDefinition,
    ...(context.process ? [createRunCommandToolDefinition(context.process)] : []),
    ...(context.skills ? [useSkillToolDefinition] : []),
    ...(context.webSearch ? [webSearchToolDefinition] : []),
    ...(context.webFetch ? [webFetchToolDefinition] : []),
  ];
}

function createBuiltInToolAdapter(context: BuiltInToolContext): ToolExecutionAdapter {
  return {
    async execute(request: ExecuteToolRequest, options?: ToolExecutionOptions): Promise<RawToolResult> {
      switch (request.toolName) {
        case 'read_file': return executeReadFile(context, request.input, options?.signal);
        case 'list_directory': return executeListDirectory(context, request.input, options?.signal);
        case 'glob': return executeGlob(context, request.input, options?.signal);
        case 'search_text': return executeSearchText(context, request.input, options?.signal);
        case 'edit_file': return executeEditFile(context, request.input, options?.signal);
        case 'write_file': return executeWriteFile(context, request.input, options?.signal);
        case 'create_directory': return executeCreateDirectory(context, request.input, options?.signal);
        case 'copy_path': return executeCopyPath(context, request.input, options?.signal);
        case 'move_path': return executeMovePath(context, request.input, options?.signal);
        case 'delete_path': return executeDeletePath(context, request.input, options?.signal);
        case 'run_command': return executeRunCommand(context, request.input, options);
        case 'use_skill': return executeUseSkill(context, request.input);
        case 'web_search': return executeWebSearch(context, request.input, options?.signal);
        case 'web_fetch': return executeWebFetch(context, request.input, options?.signal);
        default: throw new Error(`Unsupported built-in Tool: ${request.toolName}`);
      }
    },
  };
}
