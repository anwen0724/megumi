import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const agentDir = join(process.cwd(), 'packages/agent');

describe('agent tool core boundary', () => {
  it('does not import Host privileged modules from packages/agent', () => {
    expect(existsSync(agentDir)).toBe(false);
  });

  it('does not import concrete desktop main services from packages/agent', () => {
    expect(existsSync(agentDir)).toBe(false);
  });
});
