/* Guards the final Engine removal and the Discovery Agent execution boundary. */
// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Discovery Agent architecture boundary', () => {
  it('removes the legacy Engine package and configuration', () => {
    expect(existsSync(join(root, 'packages/engine'))).toBe(false);
    const configuration = [
      read('tsconfig.json'),
      read('tsconfig.packages.json'),
      read('package-lock.json'),
    ].join('\n');
    expect(configuration).not.toMatch(/@megumi\/engine|packages\/engine|packages\\engine/u);
  });

  it('uses only the public Agent entry from Discovery Agent', () => {
    const discoveryAgent = readTypeScriptTree('packages/discovery-agent/src');
    expect(discoveryAgent).toMatch(/from ['"]@megumi\/agent['"]/u);
    expect(discoveryAgent).not.toMatch(/@megumi\/agent\/(?:src|internal)/u);
  });

  it('keeps Agent Core private from Product and Desktop', () => {
    const callers = [
      readTypeScriptTree('packages/product/src'),
      readTypeScriptTree('apps/desktop/src'),
    ].join('\n');
    expect(callers).not.toMatch(/from ['"]@megumi\/agent(?:\/[^'"]*)?['"]/u);
  });

  it('does not recreate a second execution loop or mutable Run state', () => {
    const discoveryAgent = readTypeScriptTree('packages/discovery-agent/src');
    expect(discoveryAgent).not.toMatch(/\b(?:RunStatus|transitionRun|runAgentLoop)\b|new\s+AbortController/u);
    expect(discoveryAgent).not.toMatch(/class\s+\w*(?:Runtime|Harness|Manager)\b/u);
  });

  it('does not prebuild unconfirmed push business modules', () => {
    for (const directory of ['discovery', 'recommendation', 'feedback', 'scheduling', 'delivery']) {
      expect(existsSync(join(root, 'packages/discovery-agent/src', directory)), directory).toBe(false);
    }
  });
});

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

function readTypeScriptTree(relativeDirectory: string): string {
  const directory = join(root, relativeDirectory);
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = join(relativeDirectory, entry.name);
      if (entry.isDirectory()) return [readTypeScriptTree(relativePath)];
      return /\.[cm]?[tj]sx?$/u.test(entry.name) ? [read(relativePath)] : [];
    })
    .join('\n');
}
