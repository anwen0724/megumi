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
  type ToolProcessDescriptor,
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

export interface ResolveBuiltInToolRegistrationsRequest {
  readonly process?: ToolProcessDescriptor;
  readonly skillsAvailable?: boolean;
  readonly webSearchAvailable?: boolean;
  readonly webFetchAvailable?: boolean;
  readonly disabledToolNames?: readonly BuiltInToolName[];
}

export interface ResolveBuiltInToolRegistrationsResult {
  readonly catalog: ToolCatalog;
}

export interface CreateBuiltInToolExecutorRequest {
  readonly catalog: ToolCatalog;
  readonly workspaceFileAccess: WorkspaceFileAccess;
  readonly process?: ToolProcessAdapter;
  readonly skills?: SkillUse;
  readonly webSearch?: WebSearch;
  readonly webFetch?: WebFetch;
}

export interface CreateBuiltInToolsRequest extends CreateBuiltInToolExecutorRequest {
  readonly disabledToolNames?: readonly BuiltInToolName[];
}

export interface CreateBuiltInToolsResult {
  readonly catalog: ToolCatalog;
  readonly executor: ToolExecutor;
}

export function resolveBuiltInToolRegistrations(
  request: ResolveBuiltInToolRegistrationsRequest,
): ResolveBuiltInToolRegistrationsResult {
  const availableDefinitions = definitionsFor({
    process: request.process,
    skillsAvailable: request.skillsAvailable ?? false,
    webSearchAvailable: request.webSearchAvailable ?? false,
    webFetchAvailable: request.webFetchAvailable ?? false,
  });
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
  return { catalog: createToolCatalog({ registrations }) };
}

export function createBuiltInToolExecutor(request: CreateBuiltInToolExecutorRequest): ToolExecutor {
  const context: BuiltInToolContext = {
    workspaceFileAccess: request.workspaceFileAccess,
    process: request.process,
    skills: request.skills,
    webSearch: request.webSearch,
    webFetch: request.webFetch,
  };
  return createToolExecutor({
    catalog: request.catalog,
    adapter: createBuiltInToolAdapter(context),
  });
}

export function createBuiltInTools(request: CreateBuiltInToolsRequest): CreateBuiltInToolsResult {
  const { catalog } = resolveBuiltInToolRegistrations({
    process: request.process,
    skillsAvailable: request.skills !== undefined,
    webSearchAvailable: request.webSearch !== undefined,
    webFetchAvailable: request.webFetch !== undefined,
    disabledToolNames: request.disabledToolNames,
  });
  return {
    catalog,
    executor: createBuiltInToolExecutor({ ...request, catalog }),
  };
}

interface BuiltInToolAvailabilityContext {
  readonly process?: ToolProcessDescriptor;
  readonly skillsAvailable: boolean;
  readonly webSearchAvailable: boolean;
  readonly webFetchAvailable: boolean;
}

function definitionsFor(context: BuiltInToolAvailabilityContext): readonly ToolDefinition[] {
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
    ...(context.skillsAvailable ? [useSkillToolDefinition] : []),
    ...(context.webSearchAvailable ? [webSearchToolDefinition] : []),
    ...(context.webFetchAvailable ? [webFetchToolDefinition] : []),
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
