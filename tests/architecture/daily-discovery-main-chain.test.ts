/* Guards the confirmed owner boundary: Discovery prepares facts, while shared Execution owns Agent Core. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const runtimePath = 'packages/agent/discovery/src/daily-discovery/daily-discovery-runtime.ts';

describe('daily discovery Agent main chain', () => {
  it('does not construct, track, or identify Agent executions inside Discovery', () => {
    const source = readFileSync(runtimePath, 'utf8');

    expect(source).not.toMatch(/from ['"]@megumi\/agent-core['"]/u);
    expect(source).not.toContain('new Agent(');
    expect(source).not.toContain('activeAgents');
    expect(source).not.toContain('createExecutionId');
    expect(source).toContain('startExecution');
  });
});
