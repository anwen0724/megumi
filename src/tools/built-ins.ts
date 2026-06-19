// Provides built-in coding-agent tools through workspace and process host ports.
import { isProtectedOrSensitiveProjectPath } from '../permission';
import { normalizeWorkspacePath, type WorkspacePath } from '../workspace';
import { createToolRegistry } from './registry';
import type { ToolDefinition, ToolExecutionConstraint, ToolExecutionContext, ToolExecutor, ToolResult } from './types';

const builtinSource = { kind: 'builtin' as const, id: 'builtin' };
const parallelReadOnly: ToolExecutionConstraint = {
  executionMode: 'parallel',
  mutation: 'read_only',
  requiresPermission: true,
  supportsCancellation: false,
};
const serialMutation: ToolExecutionConstraint = {
  executionMode: 'serial',
  mutation: 'mutation',
  requiresPermission: true,
  supportsCancellation: false,
};
const serialProcess: ToolExecutionConstraint = {
  executionMode: 'serial',
  mutation: 'process',
  requiresPermission: true,
  supportsCancellation: false,
};

export function createBuiltInToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'read_file',
      description: 'Read a UTF-8 text file from the current workspace.',
      inputSchema: objectSchema({ path: { type: 'string' } }),
      source: builtinSource,
      sideEffect: 'read',
      execution: parallelReadOnly,
      permission: { operation: 'read' },
    },
    {
      name: 'list_directory',
      description: 'List files and directories under a workspace-relative directory.',
      inputSchema: objectSchema({ path: { type: 'string' } }),
      source: builtinSource,
      sideEffect: 'read',
      execution: parallelReadOnly,
      permission: { operation: 'read' },
    },
    {
      name: 'glob',
      description: 'Find workspace files matching a simple glob pattern.',
      inputSchema: objectSchema({
        pattern: { type: 'string' },
        cwd: { type: 'string' },
        limit: { type: 'integer' },
        includeHidden: { type: 'boolean' },
      }, ['pattern']),
      source: builtinSource,
      sideEffect: 'read',
      execution: parallelReadOnly,
      permission: { operation: 'read' },
    },
    {
      name: 'search_text',
      description: 'Search text across workspace files.',
      inputSchema: objectSchema({
        query: { type: 'string' },
        path: { type: 'string' },
        caseSensitive: { type: 'boolean' },
        limit: { type: 'integer' },
      }, ['query']),
      source: builtinSource,
      sideEffect: 'read',
      execution: parallelReadOnly,
      permission: { operation: 'read' },
    },
    {
      name: 'edit_file',
      description: 'Replace exact text in a workspace file.',
      inputSchema: objectSchema({ path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } }),
      source: builtinSource,
      sideEffect: 'write',
      execution: serialMutation,
      permission: { operation: 'write' },
    },
    {
      name: 'write_file',
      description: 'Write a UTF-8 text file in the current workspace.',
      inputSchema: objectSchema({ path: { type: 'string' }, content: { type: 'string' } }),
      source: builtinSource,
      sideEffect: 'write',
      execution: serialMutation,
      permission: { operation: 'write' },
    },
    {
      name: 'run_command',
      description: 'Run a shell command through the desktop process host.',
      inputSchema: objectSchema({
        command: { type: 'string' },
        cwd: { type: 'string' },
        timeoutMs: { type: 'integer' },
        envPolicy: { type: 'string', enum: ['default', 'minimal', 'none'] },
      }, ['command']),
      source: builtinSource,
      sideEffect: 'exec',
      execution: serialProcess,
      permission: { operation: 'exec' },
    },
  ];
}

export function createBuiltInToolRegistry() {
  const executors = new Map<string, ToolExecutor>([
    ['read_file', { execute: executeReadFile }],
    ['list_directory', { execute: executeListDirectory }],
    ['glob', { execute: executeGlob }],
    ['search_text', { execute: executeSearchText }],
    ['edit_file', { execute: executeEditFile }],
    ['write_file', { execute: executeWriteFile }],
    ['run_command', { execute: executeRunCommand }],
  ]);

  return createToolRegistry({ tools: createBuiltInToolDefinitions(), executors });
}

async function executeReadFile(call: { id: string; name: string; input: Record<string, unknown> }, context: ToolExecutionContext): Promise<ToolResult> {
  const path = requireString(call.input, 'path');
  const content = await context.workspace.readFile(path);
  return { status: 'success', toolCallId: call.id, toolName: call.name, text: content, data: content };
}

async function executeListDirectory(call: { id: string; name: string; input: Record<string, unknown> }, context: ToolExecutionContext): Promise<ToolResult> {
  const path = requireString(call.input, 'path');
  const entries = await context.workspace.listDirectory(path);
  const data = entries.map((entry) => ({
    kind: entry.kind,
    name: entry.name,
    path: entry.path,
  }));
  return { status: 'success', toolCallId: call.id, toolName: call.name, text: JSON.stringify(data), data };
}

async function executeGlob(call: { id: string; name: string; input: Record<string, unknown> }, context: ToolExecutionContext): Promise<ToolResult> {
  const pattern = normalizeGlobPath(requireString(call.input, 'pattern'));
  const root = normalizeWorkspacePath(typeof call.input.cwd === 'string' ? call.input.cwd : globStaticBase(pattern));
  const limit = typeof call.input.limit === 'number' ? call.input.limit : undefined;
  const includeHidden = call.input.includeHidden === true;
  const files = await collectFiles(context, root, { excludeProtectedSensitive: true });
  const rootPrefix = root ? `${root}/` : '';
  const matches = files
    .filter((file) => includeHidden || !file.split('/').some((part) => part.startsWith('.')))
    .filter((file) => {
      const cwdRelativePath = rootPrefix && file.startsWith(rootPrefix) ? file.slice(rootPrefix.length) : file;
      return matchesSimpleGlob(file, pattern) || matchesSimpleGlob(cwdRelativePath, pattern);
    })
    .slice(0, limit);
  return { status: 'success', toolCallId: call.id, toolName: call.name, text: matches.join('\n'), data: matches };
}

async function executeSearchText(call: { id: string; name: string; input: Record<string, unknown> }, context: ToolExecutionContext): Promise<ToolResult> {
  const query = requireString(call.input, 'query');
  const root = typeof call.input.path === 'string' ? call.input.path : '';
  const caseSensitive = call.input.caseSensitive === true;
  const limit = typeof call.input.limit === 'number' ? call.input.limit : undefined;
  const needle = caseSensitive ? query : query.toLowerCase();
  const files = await collectFiles(context, normalizeWorkspacePath(root), { excludeProtectedSensitive: true });
  const matches: Array<{ path: string; line: number; text: string }> = [];

  for (const file of files) {
    const content = await context.workspace.readFile(file);
    content.split(/\r?\n/).forEach((lineText, index) => {
      const haystack = caseSensitive ? lineText : lineText.toLowerCase();
      if (haystack.includes(needle) && (limit === undefined || matches.length < limit)) {
        matches.push({ path: file, line: index + 1, text: lineText });
      }
    });
  }

  matches.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line);
  return { status: 'success', toolCallId: call.id, toolName: call.name, text: JSON.stringify(matches), data: matches };
}

async function executeEditFile(call: { id: string; name: string; input: Record<string, unknown> }, context: ToolExecutionContext): Promise<ToolResult> {
  const path = requireString(call.input, 'path');
  await context.workspace.editFile({
    path,
    oldText: requireString(call.input, 'oldText'),
    newText: requireString(call.input, 'newText'),
  });
  return { status: 'success', toolCallId: call.id, toolName: call.name, text: `Edited ${path}` };
}

async function executeWriteFile(call: { id: string; name: string; input: Record<string, unknown> }, context: ToolExecutionContext): Promise<ToolResult> {
  const path = requireString(call.input, 'path');
  await context.workspace.writeFile({ path, content: requireString(call.input, 'content') });
  return { status: 'success', toolCallId: call.id, toolName: call.name, text: `Wrote ${path}` };
}

async function executeRunCommand(call: { id: string; name: string; input: Record<string, unknown> }, context: ToolExecutionContext): Promise<ToolResult> {
  if (!context.processHost) {
    throw new Error('Process host is required for run_command.');
  }
  const command = requireString(call.input, 'command');
  const cwd = typeof call.input.cwd === 'string' ? call.input.cwd : undefined;
  const timeoutMs = typeof call.input.timeoutMs === 'number' ? call.input.timeoutMs : undefined;
  const envPolicy = typeof call.input.envPolicy === 'string' ? call.input.envPolicy as 'default' | 'minimal' | 'none' : undefined;
  const result = await context.processHost.runCommand({ command, ...(cwd ? { cwd } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}), ...(envPolicy ? { envPolicy } : {}) });
  const text = result.stdout || result.stderr || `Command exited with code ${result.exitCode}.`;
  return { status: 'success', toolCallId: call.id, toolName: call.name, text, data: result };
}

async function collectFiles(context: ToolExecutionContext, root: WorkspacePath, options: { excludeProtectedSensitive?: boolean } = {}): Promise<string[]> {
  const entries = await context.workspace.listDirectory(root);
  const files: string[] = [];

  for (const entry of entries) {
    if (options.excludeProtectedSensitive && isProtectedOrSensitiveProjectPath(entry.path)) {
      continue;
    }
    if (entry.kind === 'file') {
      files.push(entry.path);
      continue;
    }
    files.push(...await collectFiles(context, entry.path, options));
  }

  return files.sort();
}

function matchesSimpleGlob(path: string, pattern: string): boolean {
  return globToRegExp(pattern).test(normalizeGlobPath(path));
}

function normalizeGlobPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/^\.\//, '');
}

function globStaticBase(pattern: string): string {
  const normalized = normalizeGlobPath(pattern);
  const firstWildcard = normalized.search(/[*?]/);
  if (firstWildcard < 0) {
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash < 0 ? '' : normalized.slice(0, lastSlash);
  }

  const slashBeforeWildcard = normalized.lastIndexOf('/', firstWildcard);
  return slashBeforeWildcard < 0 ? '' : normalized.slice(0, slashBeforeWildcard);
}

function globToRegExp(pattern: string): RegExp {
  let source = '^';

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    const afterNext = pattern[index + 2];

    if (char === '*' && next === '*' && afterNext === '/') {
      source += '(?:.*/)?';
      index += 2;
      continue;
    }
    if (char === '*' && next === '*') {
      source += '.*';
      index += 1;
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }

    source += escapeRegExp(char);
  }

  return new RegExp(`${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function objectSchema(properties: Record<string, { type: string; enum?: string[] }>, required = Object.keys(properties)) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string') {
    throw new Error(`Expected ${key} to be a string.`);
  }
  return value;
}
