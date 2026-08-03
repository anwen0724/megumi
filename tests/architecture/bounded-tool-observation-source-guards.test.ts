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

  it('routes direct and approval-resumed execution through one Engine mapper without rawResult', () => {
    const toolCall = read('packages/engine/src/tool-call.ts');
    const runLoop = read('packages/engine/src/run-loop.ts');
    const engineSource = `${toolCall}\n${runLoop}`;

    expect(toolCall).toContain('async function executeToolCall(');
    expect(toolCall).toContain('content: result.normalizedResult.content');
    // The Engine mapper never passes raw Runtime Sources into persisted Tool Results.
    expect(engineSource).not.toContain('runtimeSources');
    expect(engineSource).not.toContain('toolResultFromExecutionResult');
    expect(engineSource).not.toContain('toolResultRuntimeFactFromExecution');
    expect(engineSource).not.toContain('.rawResult');
  });
});
