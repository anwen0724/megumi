/* Verifies all ten confirmed built-in Tools retain their definitions in the per-Run Catalog. */

import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_TOOL_NAMES,
  createTools,
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
    const withoutWebSearch = createTools(baseOptions);
    const withWebSearch = createTools({
      ...baseOptions,
      webSearch: { search: async ({ query }) => ({ query, results: [] }) },
    });

    expect(withoutWebSearch.catalog.get({ toolName: 'web_search' }).status).toBe('not_found');
    expect(withWebSearch.catalog.get({ toolName: 'web_search' }).status).toBe('found');
  });

  it('keeps all names, schemas, risk facts, side effects, and execution modes', () => {
    const tools = createTools({
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

  it('preserves the confirmed pre-migration model-visible definition facts', () => {
    const tools = createTools({
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
      ['list_directory', 'List directory entries with depth and result limits.', 'project_read', 'low', 'none', 'parallel'],
      ['glob', 'Find files matching a glob pattern without reading file content.', 'project_read', 'low', 'none', 'parallel'],
      ['search_text', 'Search text in readable files, including Markdown, DOCX, and PDF, and return size-limited matches.', 'project_read', 'low', 'none', 'parallel'],
      ['edit_file', 'Apply an exact text replacement to an existing UTF-8 text file. Structured PDF and DOCX editing is not supported.', 'project_write', 'medium', 'project_file_operation', 'serial'],
      ['write_file', 'Create or overwrite a UTF-8 text file with provided text content. Structured PDF and DOCX writing is not supported.', 'project_write', 'medium', 'project_file_operation', 'serial'],
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
