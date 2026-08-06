import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('bounded Tool Result source guards', () => {
  it('keeps continuation facts in actual read-only tool results and removes stale model inputs', () => {
    const definitions = [
      'packages/tools/src/built-ins/read-file.ts',
      'packages/tools/src/built-ins/list-directory.ts',
      'packages/tools/src/built-ins/glob.ts',
      'packages/tools/src/built-ins/search-text.ts',
      'packages/tools/src/built-ins/run-command.ts',
    ].map(read).join('\n');

    expect(definitions).not.toContain('maxBytes: {');
    expect(definitions).not.toContain('envPolicy: {');
    expect(definitions).not.toContain('metadata: {\n        type: \'object\'');
    expect(definitions).not.toContain('Text or regular expression to search for.');
    expect(definitions).toContain("nextOffset: { type: 'integer' }");
    expect(definitions).toContain("query: { type: 'string', description: 'Literal text to search for.' }");
  });

  it('routes direct and approval-resumed execution through one ToolCall mapper without rawResult', () => {
    const toolRunner = read('packages/engine/src/tool-call-runner.ts');

    expect(toolRunner).toContain('async function executeToolInvocation(');
    expect(toolRunner).toContain('content: executionResult.normalizedResult.content');
    // The ToolCall mapper never passes raw Runtime Sources into persisted Tool Results.
    expect(toolRunner).not.toContain('runtimeSources');
    expect(toolRunner).not.toContain('toolResultFromExecutionResult');
    expect(toolRunner).not.toContain('toolResultRuntimeFactFromExecution');
    expect(toolRunner).not.toContain('.rawResult');
  });
});
