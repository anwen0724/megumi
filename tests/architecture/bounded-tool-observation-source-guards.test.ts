import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('bounded Tool Result source guards', () => {
  it('keeps continuation facts in actual read-only tool results and removes stale model inputs', () => {
    const definitions = read('packages/agent/tools/core/tool-definitions.ts');

    expect(definitions).not.toContain('maxBytes: {');
    expect(definitions).not.toContain('envPolicy: {');
    expect(definitions).not.toContain('metadata: {\n        type: \'object\'');
    expect(definitions).not.toContain('Text or regular expression to search for.');
    expect(definitions).toContain("nextOffset: { type: 'integer' }");
    expect(definitions).toContain("query: { type: 'string', description: 'Literal text to search for.' }");
  });

  it('routes direct and approval-resumed execution through one mapper without reading rawResult', () => {
    const orchestrator = read('packages/agent/agent-run/core/tool-call-orchestrator.ts');
    const service = read('packages/agent/agent-run/services/agent-run-service.ts');
    const mapper = read('packages/agent/agent-run/core/tool-result-mapper.ts');
    const agentRunSource = `${orchestrator}\n${service}\n${mapper}`;

    expect(orchestrator).toContain('mapToolExecutionResultToRuntimeFact({');
    expect(service).toContain('mapToolExecutionResultToRuntimeFact({');
    expect(agentRunSource).not.toContain('toolResultFromExecutionResult');
    expect(agentRunSource).not.toContain('toolResultRuntimeFactFromExecution');
    expect(agentRunSource).not.toContain('.rawResult');
  });
});
