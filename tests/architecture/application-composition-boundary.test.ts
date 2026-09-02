/* Protects the single Host-neutral application composition direction. */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Application Composition boundary', () => {
  it('keeps Electron and Evaluation out of the shared Composition package', async () => {
    const source = await readFile('packages/agent/composition/src/compose-application.ts', 'utf8');
    expect(source).not.toContain("from 'electron'");
    expect(source).not.toContain('evals/agent');
    expect(source).toContain('composeApplication');
  });

  it('lets both concrete Hosts call the same public entrypoint', async () => {
    const desktop = await readFile('apps/desktop/src/main/shell-composition/desktop-main-composition.ts', 'utf8');
    const evaluation = await readFile('evals/agent/run/case-environment.ts', 'utf8');
    expect(desktop).toContain('composeApplication');
    expect(evaluation).toContain('composeApplication');
  });
});
