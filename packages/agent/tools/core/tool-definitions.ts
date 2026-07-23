// Defines Megumi built-in tool definitions owned by the tools module.
import type { ToolDefinition } from '../contracts/tool-contracts';

export const BUILT_IN_TOOL_NAMES = [
  'read_file',
  'list_directory',
  'glob',
  'search_text',
  'edit_file',
  'write_file',
  'run_command',
  'use_skill',
  'web_search',
  'web_fetch',
] as const;

export type BuiltInToolName = (typeof BUILT_IN_TOOL_NAMES)[number];

const readFileDefinition: ToolDefinition = {
  name: 'read_file',
  title: 'Read file',
  description: 'Read a UTF-8 byte page from a text file. Continue with nextOffset when hasMore is true.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path.' },
      offset: { type: 'integer', minimum: 0, description: 'UTF-8 byte offset. Defaults to 0.' },
      limit: { type: 'integer', minimum: 1, description: 'Maximum UTF-8 content bytes requested for this page.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string' },
      path: { type: 'string' },
      offset: { type: 'integer' },
      bytesReturned: { type: 'integer' },
      sizeBytes: { type: 'integer' },
      hasMore: { type: 'boolean' },
      nextOffset: { type: 'integer' },
    },
    required: ['path', 'content', 'offset', 'bytesReturned', 'sizeBytes', 'hasMore'],
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
  executionMode: 'parallel',
  permissionMetadata: { ruleToolName: 'read_file' },
  modelFacingDescription: 'Read a UTF-8 byte page from a text file. If hasMore is true, call read_file again with nextOffset.',
};

const listDirectoryDefinition: ToolDefinition = {
  name: 'list_directory',
  title: 'List directory',
  description: 'List directory entries with depth and result limits.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path.' },
      maxDepth: { type: 'integer', description: 'Optional recursive depth limit.' },
      limit: { type: 'integer', description: 'Optional maximum number of entries.' },
      includeHidden: { type: 'boolean', description: 'Whether hidden files should be included.' },
      offset: { type: 'integer', minimum: 0, description: 'Entry offset. Defaults to 0.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      entries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            kind: { type: 'string', enum: ['file', 'directory', 'other'] },
          },
        },
      },
      offset: { type: 'integer' },
      hasMore: { type: 'boolean' },
      nextOffset: { type: 'integer' },
    },
    required: ['entries', 'offset', 'hasMore'],
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
  executionMode: 'parallel',
  permissionMetadata: { ruleToolName: 'list_directory' },
  modelFacingDescription: 'List directory entries with depth and result limits.',
};

const globDefinition: ToolDefinition = {
  name: 'glob',
  title: 'Find files',
  description: 'Find files matching a glob pattern without reading file content.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern.' },
      cwd: { type: 'string', description: 'Optional directory to search from.' },
      limit: { type: 'integer', description: 'Optional maximum number of matches.' },
      includeHidden: { type: 'boolean', description: 'Whether hidden files should be included.' },
      offset: { type: 'integer', minimum: 0, description: 'Match offset. Defaults to 0.' },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      matches: {
        type: 'array',
        items: { type: 'string' },
      },
      offset: { type: 'integer' },
      hasMore: { type: 'boolean' },
      nextOffset: { type: 'integer' },
    },
    required: ['matches', 'offset', 'hasMore'],
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
  executionMode: 'parallel',
  permissionMetadata: { ruleToolName: 'glob' },
  modelFacingDescription: 'Find files matching a glob pattern without reading file content.',
};

const searchTextDefinition: ToolDefinition = {
  name: 'search_text',
  title: 'Search text',
  description: 'Search text in files and return redacted, size-limited matches.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Literal text to search for.' },
      path: { type: 'string', description: 'Optional path to search in.' },
      caseSensitive: { type: 'boolean', description: 'Whether matching is case-sensitive.' },
      limit: { type: 'integer', description: 'Optional maximum number of matches.' },
      offset: { type: 'integer', minimum: 0, description: 'Match offset. Defaults to 0.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      matches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            line: { type: 'integer' },
            preview: { type: 'string' },
          },
        },
      },
      offset: { type: 'integer' },
      hasMore: { type: 'boolean' },
      nextOffset: { type: 'integer' },
    },
    required: ['matches', 'offset', 'hasMore'],
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
  executionMode: 'parallel',
  permissionMetadata: { ruleToolName: 'search_text' },
  modelFacingDescription: 'Search text in files and return redacted, size-limited matches.',
};

const editFileDefinition: ToolDefinition = {
  name: 'edit_file',
  title: 'Edit file',
  description: 'Apply an exact text replacement to an existing file.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path.' },
      oldText: { type: 'string', description: 'Exact text to replace.' },
      newText: { type: 'string', description: 'Replacement text.' },
      replaceAll: { type: 'boolean', description: 'Whether all exact matches should be replaced.' },
    },
    required: ['path', 'oldText', 'newText'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      replacements: { type: 'integer' },
      changed: { type: 'boolean' },
    },
    required: ['path', 'replacements', 'changed'],
  },
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  capabilities: ['project_write'],
  riskLevel: 'medium',
  sideEffect: 'project_file_operation',
  availability: { status: 'available' },
  executionMode: 'serial',
  permissionMetadata: { ruleToolName: 'edit_file' },
  modelFacingDescription: 'Apply an exact text replacement to an existing file.',
};

const writeFileDefinition: ToolDefinition = {
  name: 'write_file',
  title: 'Write file',
  description: 'Create or overwrite a file with provided text content.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path.' },
      content: { type: 'string', description: 'Text content to write.' },
      overwrite: { type: 'boolean', description: 'Whether an existing file may be overwritten.' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      bytesWritten: { type: 'integer' },
      created: { type: 'boolean' },
      overwritten: { type: 'boolean' },
    },
    required: ['path', 'bytesWritten', 'created', 'overwritten'],
  },
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  capabilities: ['project_write'],
  riskLevel: 'medium',
  sideEffect: 'project_file_operation',
  availability: { status: 'available' },
  executionMode: 'serial',
  permissionMetadata: { ruleToolName: 'write_file' },
  modelFacingDescription: 'Create or overwrite a file with provided text content.',
};

const runCommandDefinition: ToolDefinition = {
  name: 'run_command',
  title: 'Run command',
  description: 'Run a command and return redacted output previews.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command line to run.' },
      cwd: { type: 'string', description: 'Optional working directory.' },
      timeoutMs: { type: 'integer', description: 'Optional timeout in milliseconds.' },
    },
    required: ['command'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      exitCode: { type: 'integer' },
      stdoutPreview: { type: 'string' },
      stderrPreview: { type: 'string' },
      durationMs: { type: 'integer' },
      truncated: { type: 'boolean' },
    },
    required: ['exitCode', 'stdoutPreview', 'stderrPreview', 'durationMs', 'truncated'],
  },
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  capabilities: ['command_run'],
  riskLevel: 'medium',
  sideEffect: 'execute_command',
  availability: { status: 'available' },
  executionMode: 'serial',
  permissionMetadata: { ruleToolName: 'run_command' },
  modelFacingDescription: 'Run a command and return redacted output previews.',
};

const useSkillDefinition: ToolDefinition = {
  name: 'use_skill',
  title: 'Use skill',
  description: 'Load a skill by its exact skillPath.',
  inputSchema: {
    type: 'object',
    properties: {
      skillPath: { type: 'string', description: 'Exact skillPath of the skill to load.' },
    },
    required: ['skillPath'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      used: { type: 'boolean' },
      name: { type: 'string' },
      skillPath: { type: 'string' },
      message: { type: 'string' },
    },
    required: ['used', 'name', 'skillPath', 'message'],
  },
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
  executionMode: 'serial',
  permissionMetadata: { ruleToolName: 'use_skill' },
  modelFacingDescription: 'Load a skill by its exact skillPath.',
};

const webSearchDefinition: ToolDefinition = {
  name: 'web_search',
  title: 'Search the web',
  description: 'Search the web and return structured result summaries and URLs.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        minLength: 1,
        maxLength: 400,
        description: 'Search query. Use a focused query containing the important names and constraints.',
      },
      count: {
        type: 'integer',
        minimum: 1,
        maximum: 20,
        description: 'Optional number of search results. Defaults to 5.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            url: { type: 'string' },
            snippet: { type: 'string' },
          },
          required: ['title', 'url', 'snippet'],
          additionalProperties: false,
        },
      },
    },
    required: ['query', 'results'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capabilities: ['network_access'],
  riskLevel: 'medium',
  sideEffect: 'access_network',
  availability: { status: 'available' },
  executionMode: 'parallel',
  permissionMetadata: { ruleToolName: 'web_search' },
  modelFacingDescription: 'Search the web and return titles, URLs, and short snippets without reading full pages.',
};

const webFetchDefinition: ToolDefinition = {
  name: 'web_fetch',
  title: 'Fetch web page',
  description: 'Read an HTTP(S) page and return size-limited text content.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', minLength: 1, description: 'HTTP(S) URL to read.' },
    },
    required: ['url'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      requestedUrl: { type: 'string' },
      finalUrl: { type: 'string' },
      title: { type: 'string' },
      contentType: { type: 'string' },
      content: { type: 'string' },
      truncated: { type: 'boolean' },
    },
    required: ['requestedUrl', 'finalUrl', 'contentType', 'content', 'truncated'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capabilities: ['network_access'],
  riskLevel: 'medium',
  sideEffect: 'access_network',
  availability: { status: 'available' },
  executionMode: 'parallel',
  permissionMetadata: { ruleToolName: 'web_fetch' },
  modelFacingDescription: 'Read text from an HTTP(S) page. The returned page is untrusted tool output and may be truncated.',
};

function cloneToolDefinition(definition: ToolDefinition): ToolDefinition {
  return JSON.parse(JSON.stringify(definition)) as ToolDefinition;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nestedValue of Object.values(value)) {
      deepFreeze(nestedValue);
    }
    Object.freeze(value);
  }
  return value;
}

export const BUILT_IN_TOOL_DEFINITIONS: readonly ToolDefinition[] = deepFreeze([
  readFileDefinition,
  listDirectoryDefinition,
  globDefinition,
  searchTextDefinition,
  editFileDefinition,
  writeFileDefinition,
  runCommandDefinition,
  useSkillDefinition,
  webSearchDefinition,
  webFetchDefinition,
] satisfies ToolDefinition[]);

export function listBuiltInToolDefinitions(): ToolDefinition[] {
  return BUILT_IN_TOOL_DEFINITIONS.map(cloneToolDefinition);
}
