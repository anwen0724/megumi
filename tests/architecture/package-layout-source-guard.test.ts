/* Guards the repository's approved AI, Agent Core, and concrete Agent package layout. */
// @vitest-environment node
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const packagesRoot = join(root, 'packages');

describe('package layout', () => {
  it('keeps only AI, Agent Core, and the concrete Agent at the package root', () => {
    const directories = readdirSync(packagesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(directories).toEqual(['agent', 'agent-core', 'ai']);
  });

  it('keeps the concrete Agent as a directory of owner packages, not an umbrella package', () => {
    const agentRoot = join(packagesRoot, 'agent');
    expect(existsSync(join(agentRoot, 'package.json'))).toBe(false);
    expect(existsSync(join(agentRoot, 'src'))).toBe(false);
    expect(existsSync(join(agentRoot, 'context', 'package.json'))).toBe(true);
    expect(existsSync(join(agentRoot, 'discovery', 'package.json'))).toBe(true);
    expect(existsSync(join(agentRoot, 'tools', 'package.json'))).toBe(true);
  });
});
