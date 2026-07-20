/*
 * Routes registered Megumi built-in tool calls to their focused implementations.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import type { RawToolResult } from '../contracts/tool-contracts';
import type { SkillService } from '@megumi/skills';
import { executeUseSkill } from './use-skill';
import { executeEditFile } from './edit-file';
import { executeGlob } from './glob';
import { executeListDirectory } from './list-directory';
import { executeReadFile } from './read-file';
import { executeRunCommand } from './run-command';
import { executeSearchText } from './search-text';
import { executeWebSearch, type WebSearchService } from './web-search';
import { createWebFetchService, executeWebFetch, type WebFetchService } from './web-fetch';
import { executeWriteFile } from './write-file';
import type { BuiltInToolContext, BuiltInToolSpawn, WorkspaceFileAccess } from './types';

export type BuiltInToolExecuteRequest = {
  toolName: string;
  input: unknown;
  signal?: AbortSignal;
};

export interface BuiltInToolExecutor {
  execute(request: BuiltInToolExecuteRequest): Promise<RawToolResult>;
}

export function createBuiltInToolExecutor(input: {
  workspaceFileAccess: WorkspaceFileAccess;
  spawn?: BuiltInToolSpawn;
  skillService?: Pick<SkillService, 'useSkill'>;
  webSearchService?: WebSearchService;
  webFetchService?: WebFetchService;
}): BuiltInToolExecutor {
  const context: BuiltInToolContext = {
    workspaceFileAccess: input.workspaceFileAccess,
    spawn: input.spawn ?? nodeSpawn,
    skillService: input.skillService,
    webSearchService: input.webSearchService,
    webFetchService: input.webFetchService ?? createWebFetchService(),
  };

  return {
    async execute(request) {
      switch (request.toolName) {
        case 'read_file':
          return executeReadFile(context, request.input);
        case 'list_directory':
          return executeListDirectory(context, request.input);
        case 'glob':
          return executeGlob(context, request.input);
        case 'search_text':
          return executeSearchText(context, request.input);
        case 'edit_file':
          return executeEditFile(context, request.input);
        case 'write_file':
          return executeWriteFile(context, request.input);
        case 'run_command':
          return executeRunCommand(context, request.input, request.signal);
        case 'use_skill':
          return executeUseSkill(context, request.input);
        case 'web_search':
          return executeWebSearch(context, request.input, request.signal);
        case 'web_fetch':
          return executeWebFetch(context, request.input, request.signal);
        default:
          throw new Error(`Unsupported built-in tool: ${request.toolName}`);
      }
    },
  };
}

export type {
  BuiltInToolContext,
  BuiltInToolSpawn,
  WorkspaceFileAccess,
} from './types';
export type {
  WebSearchRequest,
  WebSearchResult,
  WebSearchResultItem,
  WebSearchService,
} from './web-search';
export {
  createBraveWebSearchService,
  createWebSearchService,
} from './web-search';
export type { WebFetchResult, WebFetchService } from './web-fetch';
export { createWebFetchService, isAllowedResolvedAddress, isPublicIp } from './web-fetch';
