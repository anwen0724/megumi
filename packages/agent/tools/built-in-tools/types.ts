/*
 * Defines dependencies shared by Megumi built-in tool implementations.
 */
import type { spawn as nodeSpawn } from 'node:child_process';
import type { SkillService } from '@megumi/skills';
import type { WebSearchService } from './web-search';
import type { WebFetchService } from './web-fetch';

export interface WorkspaceFileAccess {
  readFile(input: {
    path: string;
    maxBytes: number;
  }): Promise<{
    path: string;
    content: string;
    truncated: boolean;
    sizeBytes: number;
  }>;
  listDirectory(input: {
    path: string;
  }): Promise<{
    path: string;
    entries: Array<{
      name: string;
      kind: 'file' | 'directory';
      path: string;
    }>;
    truncated: boolean;
  }>;
  walkFiles(input: { path: string }): Promise<string[]>;
  readTextFile(input: { path: string }): Promise<string>;
  replaceText(input: {
    path: string;
    oldText: string;
    newText: string;
    replaceAll: boolean;
  }): Promise<{
    path: string;
    replacements: number;
    changed: boolean;
  }>;
  writeFile(input: {
    path: string;
    content: string;
    overwrite: boolean;
  }): Promise<{
    path: string;
    bytesWritten: number;
    created: boolean;
    overwritten: boolean;
  }>;
  resolveCommandCwd(input: { path: string }): Promise<string>;
}

export type BuiltInToolSpawn = typeof nodeSpawn;

export type BuiltInToolContext = {
  workspaceFileAccess: WorkspaceFileAccess;
  spawn: BuiltInToolSpawn;
  skillService?: Pick<SkillService, 'useSkill'>;
  webSearchService?: WebSearchService;
  webFetchService?: WebFetchService;
};
