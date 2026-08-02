/* Verifies all ten confirmed built-in Tools retain their definitions in the per-Run Catalog. */

import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_TOOL_NAMES,
  createBuiltInTools,
  type WorkspaceFileAccess,
} from '../../../packages/tools/src';
import { createProcessAdapter } from './tool-test-fixtures';

describe('built-in Tool Catalog', () => {
  it('includes web_search only in Run snapshots that have a configured adapter', () => {
    const baseOptions = {
      workspaceFileAccess: unusedWorkspaceFileAccess(),
      process: createProcessAdapter(),
      skills: { useSkill: async () => ({ status: 'not_found', skillPath: 'missing' }) } as never,
      webFetch: { fetch: async ({ url }: { url: string }) => ({
        requestedUrl: url,
        finalUrl: url,
        contentType: 'text/plain',
        content: '',
        truncated: false,
      }) },
    };
    const withoutWebSearch = createBuiltInTools(baseOptions);
    const withWebSearch = createBuiltInTools({
      ...baseOptions,
      webSearch: { search: async ({ query }) => ({ query, results: [] }) },
    });

    expect(withoutWebSearch.catalog.get({ toolName: 'web_search' }).status).toBe('not_found');
    expect(withWebSearch.catalog.get({ toolName: 'web_search' }).status).toBe('found');
  });

  it('keeps all names, schemas, risk facts, side effects, and execution modes', () => {
    const tools = createBuiltInTools({
      workspaceFileAccess: unusedWorkspaceFileAccess(),
      process: createProcessAdapter(),
      skills: { useSkill: async () => ({ status: 'not_found', skillPath: 'missing' }) } as never,
      webSearch: { search: async ({ query }) => ({ query, results: [] }) },
      webFetch: { fetch: async ({ url }) => ({
        requestedUrl: url,
        finalUrl: url,
        contentType: 'text/plain',
        content: '',
        truncated: false,
      }) },
    });
    const definitions = tools.catalog.list().tools.map((tool) => tool.definition);
    expect(definitions.map((definition) => definition.name)).toEqual(BUILT_IN_TOOL_NAMES);
    for (const definition of definitions) {
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.inputSchema.type).toBe('object');
      expect(definition.capabilities.length).toBeGreaterThan(0);
      expect(definition.riskLevel).toMatch(/low|medium|high|critical/);
      expect(definition.sideEffect.length).toBeGreaterThan(0);
      expect(definition.executionMode).toMatch(/parallel|serial/);
      expect(definition.availability.status).toBe('available');
    }
  });

  it('preserves the confirmed model-visible definition facts', () => {
    const tools = createBuiltInTools({
      workspaceFileAccess: unusedWorkspaceFileAccess(),
      process: createProcessAdapter(),
      skills: { useSkill: async () => ({ status: 'not_found', skillPath: 'missing' }) } as never,
      webSearch: { search: async ({ query }) => ({ query, results: [] }) },
      webFetch: { fetch: async ({ url }) => ({
        requestedUrl: url,
        finalUrl: url,
        contentType: 'text/plain',
        content: '',
        truncated: false,
      }) },
    });
    const definitions = tools.catalog.list().tools.map(({ definition }) => ({
      name: definition.name,
      description: definition.description,
      capabilities: definition.capabilities,
      riskLevel: definition.riskLevel,
      sideEffect: definition.sideEffect,
      executionMode: definition.executionMode,
    }));

    expect(definitions).toEqual([
      ['read_file', 'Read a bounded UTF-8 text page from a text, Markdown, DOCX, or PDF file. Continue with nextOffset when hasMore is true.', 'project_read', 'low', 'none', 'parallel'],
      ['list_directory', 'List files and directories.', 'project_read', 'low', 'none', 'parallel'],
      ['glob', 'Find files matching a glob pattern without reading file content.', 'project_read', 'low', 'none', 'parallel'],
      ['search_text', 'Search text in readable files, including Markdown, DOCX, and PDF, and return size-limited matches.', 'project_read', 'low', 'none', 'parallel'],
      ['edit_file', 'Apply ordered exact-text edits to an existing UTF-8 text file.', 'project_write', 'medium', 'project_file_operation', 'serial'],
      ['write_file', 'Create or overwrite a UTF-8 text file with provided text content. Structured PDF and DOCX writing is not supported.', 'project_write', 'medium', 'project_file_operation', 'serial'],
      ['create_directory', 'Create a directory.', 'project_write', 'medium', 'project_file_operation', 'serial'],
      ['copy_path', 'Copy a file or directory.', 'project_write', 'medium', 'project_file_operation', 'serial'],
      ['move_path', 'Move or rename a file or directory.', 'project_write', 'high', 'project_file_operation', 'serial'],
      ['delete_path', 'Move a file or directory to a recoverable Workspace location.', 'project_write', 'high', 'project_file_operation', 'serial'],
      ['run_command', 'Run a command and return redacted output previews.', 'command_run', 'medium', 'execute_command', 'serial'],
      ['use_skill', 'Load a skill by its exact skillPath.', 'project_read', 'low', 'none', 'serial'],
      ['web_search', 'Search the web and return structured result summaries and URLs.', 'network_access', 'medium', 'access_network', 'parallel'],
      ['web_fetch', 'Read an HTTP(S) page and return size-limited text content.', 'network_access', 'medium', 'access_network', 'parallel'],
    ].map(([name, description, capability, riskLevel, sideEffect, executionMode]) => ({
      name,
      description,
      capabilities: [capability],
      riskLevel,
      sideEffect,
      executionMode,
    })));

    const runCommand = tools.catalog.get({ toolName: 'run_command' });
    expect(runCommand.status === 'found' ? runCommand.tool.definition.inputSchema.properties : null)
      .toEqual({
        command: expect.any(Object),
        cwd: expect.any(Object),
        timeoutMs: expect.any(Object),
      });

    const listDirectory = tools.catalog.get({ toolName: 'list_directory' });
    const listDirectoryDefinition = listDirectory.status === 'found'
      ? listDirectory.tool.definition
      : undefined;
    const properties = listDirectoryDefinition?.inputSchema.properties;
    const pathSchema = properties && typeof properties === 'object' && !Array.isArray(properties)
      ? properties.path
      : undefined;
    const pathObject = pathSchema && typeof pathSchema === 'object' && !Array.isArray(pathSchema)
      ? pathSchema
      : undefined;
    expect(pathObject).toMatchObject({
      description: 'The directory to list. Relative paths are resolved from the current working directory.',
    });
    expect(JSON.stringify(listDirectoryDefinition)).not.toContain('outside the active Workspace');
  });
});

function unusedWorkspaceFileAccess(): WorkspaceFileAccess {
  const unused = async () => { throw new Error('Not used'); };
  return {
    readFile: unused,
    listDirectory: unused,
    walkFiles: unused,
    replaceText: unused,
    writeFile: unused,
    resolveCommandCwd: unused,
  } as WorkspaceFileAccess;
}
