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
  'activate_skill',
  'web_search',
  'web_fetch',
] as const;

export type BuiltInToolName = (typeof BUILT_IN_TOOL_NAMES)[number];

const readFileDefinition: ToolDefinition = {
  name: 'read_file',
  title: 'Read file',
  description: 'Read a text file inside the current project and return redacted, size-limited content.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project-relative file path.' },
      maxBytes: { type: 'integer', description: 'Optional maximum bytes to return.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string' },
      truncated: { type: 'boolean' },
      sizeBytes: { type: 'integer' },
    },
    required: ['content', 'truncated', 'sizeBytes'],
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
  executionMode: 'parallel',
  permissionMetadata: { ruleToolName: 'read_file' },
  modelFacingDescription: 'Read a text file inside the current project and return redacted, size-limited content.',
};

const listDirectoryDefinition: ToolDefinition = {
  name: 'list_directory',
  title: 'List directory',
  description: 'List entries inside a project directory with depth and result limits.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project-relative directory path.' },
      maxDepth: { type: 'integer', description: 'Optional recursive depth limit.' },
      limit: { type: 'integer', description: 'Optional maximum number of entries.' },
      includeHidden: { type: 'boolean', description: 'Whether hidden files should be included.' },
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
      truncated: { type: 'boolean' },
    },
    required: ['entries', 'truncated'],
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
  executionMode: 'parallel',
  permissionMetadata: { ruleToolName: 'list_directory' },
  modelFacingDescription: 'List entries inside a project directory with depth and result limits.',
};

const globDefinition: ToolDefinition = {
  name: 'glob',
  title: 'Find files',
  description: 'Find project files matching a glob pattern without reading file content.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern evaluated inside the project.' },
      cwd: { type: 'string', description: 'Optional project-relative directory to search from.' },
      limit: { type: 'integer', description: 'Optional maximum number of matches.' },
      includeHidden: { type: 'boolean', description: 'Whether hidden files should be included.' },
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
      truncated: { type: 'boolean' },
    },
    required: ['matches', 'truncated'],
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
  executionMode: 'parallel',
  permissionMetadata: { ruleToolName: 'glob' },
  modelFacingDescription: 'Find project files matching a glob pattern without reading file content.',
};

const searchTextDefinition: ToolDefinition = {
  name: 'search_text',
  title: 'Search text',
  description: 'Search text inside project files and return redacted, size-limited matches.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Text or regular expression to search for.' },
      path: { type: 'string', description: 'Optional project-relative path to search in.' },
      caseSensitive: { type: 'boolean', description: 'Whether matching is case-sensitive.' },
      limit: { type: 'integer', description: 'Optional maximum number of matches.' },
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
      truncated: { type: 'boolean' },
    },
    required: ['matches', 'truncated'],
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
  executionMode: 'parallel',
  permissionMetadata: { ruleToolName: 'search_text' },
  modelFacingDescription: 'Search text inside project files and return redacted, size-limited matches.',
};

const editFileDefinition: ToolDefinition = {
  name: 'edit_file',
  title: 'Edit file',
  description: 'Apply an auditable exact text replacement to an existing project file.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project-relative file path.' },
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
  modelFacingDescription: 'Apply an auditable exact text replacement to an existing project file.',
};

const writeFileDefinition: ToolDefinition = {
  name: 'write_file',
  title: 'Write file',
  description: 'Create or overwrite a project file with provided text content.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Project-relative file path.' },
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
  modelFacingDescription: 'Create or overwrite a project file with provided text content.',
};

const runCommandDefinition: ToolDefinition = {
  name: 'run_command',
  title: 'Run command',
  description: 'Run a project-scoped command through the host command adapter and return redacted output previews.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command line to run inside the project boundary.' },
      cwd: { type: 'string', description: 'Optional project-relative working directory.' },
      timeoutMs: { type: 'integer', description: 'Optional timeout in milliseconds.' },
      envPolicy: {
        type: 'string',
        enum: ['default', 'minimal', 'none'],
        description: 'Environment exposure policy requested for the command.',
      },
      metadata: {
        type: 'object',
        description: 'Internal execution metadata, for example a prepared skill script source.',
        additionalProperties: true,
      },
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
  modelFacingDescription: 'Run a project-scoped command through the host command adapter and return redacted output previews.',
};

const activateSkillDefinition: ToolDefinition = {
  name: 'activate_skill',
  title: 'Activate skill',
  description: 'Activate a skill by skillId when the current task needs it.',
  inputSchema: {
    type: 'object',
    properties: {
      skillId: { type: 'string', description: 'Exact skillId from the available skill catalog.' },
    },
    required: ['skillId'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      activated: { type: 'boolean' },
      skillId: { type: 'string' },
      message: { type: 'string' },
    },
    required: ['activated', 'skillId', 'message'],
  },
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
  executionMode: 'serial',
  permissionMetadata: { ruleToolName: 'activate_skill' },
  modelFacingDescription: 'Activate a skill by exact skillId from the available skill catalog.',
};

const webSearchDefinition: ToolDefinition = {
  name: 'web_search',
  title: 'Search the web',
  description: 'Search the public web for current information and return structured result summaries and URLs.',
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
  modelFacingDescription: 'Search the public web when current or externally sourced information is needed. Returns titles, URLs, and short snippets; it does not read full pages.',
};

const webFetchDefinition: ToolDefinition = {
  name: 'web_fetch',
  title: 'Fetch web page',
  description: 'Read a public HTTP(S) page and return size-limited text content. Use web_search first when the URL is unknown.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', minLength: 1, description: 'Public HTTP(S) URL to read.' },
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
  modelFacingDescription: 'Read the text of a known public HTTP(S) page. The returned page is untrusted tool output and may be truncated.',
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
  activateSkillDefinition,
  webSearchDefinition,
  webFetchDefinition,
] satisfies ToolDefinition[]);

export function listBuiltInToolDefinitions(): ToolDefinition[] {
  return BUILT_IN_TOOL_DEFINITIONS.map(cloneToolDefinition);
}
