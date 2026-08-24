/* Guards the confirmed owner boundary: Discovery prepares facts, while shared Execution owns Agent Core. */
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
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

  it('removes the DiscoveryAgent aggregate and keeps conversation submission with Execution', () => {
    expect(existsSync('packages/agent/discovery/src/discovery-agent.ts')).toBe(false);
    expect(existsSync('packages/agent/discovery/src/conversation')).toBe(false);
    expect(existsSync('packages/agent/discovery/src/discovery.ts')).toBe(true);
    expect(existsSync('packages/agent/execution/src/conversation-submission.ts')).toBe(true);
  });

  it('keeps Discovery free of Agent Core and execution construction', () => {
    const source = readFileSync('packages/agent/discovery/src/discovery.ts', 'utf8');

    expect(source).not.toContain("from '@megumi/agent-core'");
    expect(source).not.toContain('createAgentExecutions');
    expect(source).not.toContain('launchAgentExecution');
    expect(source).not.toContain('bindExecution');
    expect(source).not.toContain('submitConversationInput');
  });
});
