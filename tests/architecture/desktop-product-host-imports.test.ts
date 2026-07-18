// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Desktop Product Host imports', () => {
  it('keeps Desktop behind Product public entries', () => {
    const source = readTree('apps/desktop/src');
    expect(source).not.toContain('@megumi/agent');
    expect(source).not.toMatch(/packages[\\/]product[\\/](?!host-interface|logging|composition|home)/);
  });

  it('keeps the renderer-safe Host entry free of Node-only Product modules', () => {
    const source = readTree('packages/product/host-interface');
    expect(source).not.toMatch(/from ['"]node:/);
    expect(source).not.toContain("from '../home");
    expect(source).not.toContain("from '../logging");
    expect(source).not.toContain("from '../composition");
  });

  it('does not leak the internal command replacement protocol into Renderer', () => {
    expect(readTree('apps/desktop/src/renderer')).not.toContain('replacement_input');
  });

  it('prevents Agent from depending back on Product', () => {
    expect(readTree('packages/agent')).not.toContain('@megumi/product');
    expect(readTree('packages/agent')).not.toMatch(/from ['"]\.\.\/\.\.\/product/);
  });
});

function readTree(relativeRoot: string): string {
  const directory = path.join(root, relativeRoot);
  return fs.readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((entry) => /\.(ts|tsx)$/.test(entry))
    .map((entry) => fs.readFileSync(path.join(directory, entry), 'utf8'))
    .join('\n');
}
