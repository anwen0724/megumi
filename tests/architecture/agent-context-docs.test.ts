// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('agent context documentation rules', () => {
  it('provides a mandatory agent context entry document', () => {
    const source = read('docs/AGENT_CONTEXT.md');

    expect(source).toContain('Always Read');
    expect(source).toContain('docs/architecture/package-structure.md');
    expect(source).toContain('docs/product/12-runtime-foundations-roadmap-spec.md');
    expect(source).toContain('docs/plans/README.md');
  });

  it('requires pre-reading source-of-truth docs before specs and plans', () => {
    const source = read('AGENTS.md');

    expect(source).toContain('Mandatory Pre-Read');
    expect(source).toContain('Before writing a product spec');
    expect(source).toContain('Before writing an implementation plan');
    expect(source).toContain('docs/AGENT_CONTEXT.md');
  });

  it('requires active plans to declare required reading', () => {
    const source = read('docs/plans/README.md');

    expect(source).toContain('Required Reading');
    expect(source).toContain('Every active plan must include');
    expect(source).toContain('target product or architecture spec');
  });
});
