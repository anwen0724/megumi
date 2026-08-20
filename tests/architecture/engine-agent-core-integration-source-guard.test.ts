/* Guards the Engine product adapter boundary after generic execution moved to Agent Core. */
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('Engine Agent Core integration source guard', () => {
  it('removes the retired generic Engine execution chain', () => {
    for (const relativePath of [
      'packages/engine/src/agent-loop.ts',
      'packages/engine/src/model-call-runner.ts',
      'packages/engine/src/tool-call-runner.ts',
    ]) {
      expect(fs.existsSync(path.join(root, relativePath)), relativePath).toBe(false);
    }
  });

  it('keeps run.ts on the one Engine Agent Adapter entry', () => {
    const run = read('packages/engine/src/run.ts');

    expect(run).toContain("from './agent-adapter'");
    expect(run).toContain('executeAgentRun({');
    expect(run).not.toMatch(/runAgentLoop|runModelCall|runToolCallBatch|\.streamSimple\(/u);
  });

  it('uses only the public Agent package surface and keeps it private from Engine callers', () => {
    const adapter = read('packages/engine/src/agent-adapter.ts');
    const engineIndex = read('packages/engine/src/index.ts');

    expect(adapter).toMatch(/from ['"]@megumi\/agent['"]/u);
    expect(adapter).not.toMatch(/@megumi\/agent\/(?:src|internal)/u);
    expect(engineIndex).not.toMatch(/from ['"]\.\/agent-adapter['"]/u);
    expect(engineIndex).not.toMatch(/export\s+(?:type\s+)?\{[^}]*\bAgent\b/su);
  });

  it('keeps Session finalization and bounded Tool facts in the product adapter', () => {
    const adapter = read('packages/engine/src/agent-adapter.ts');
    const committer = read('packages/engine/src/session-message-committer.ts');

    expect(adapter).toContain('commitFinalReply(');
    expect(committer).toContain('options.session.saveAssistantReply({');
    expect(adapter).not.toMatch(/runtimeSources|rawResult/u);
  });

  it('keeps Product and Desktop callers dependent on Engine rather than Agent Core', () => {
    const productAndDesktop = [
      ...listTypeScriptFiles('packages/product'),
      ...listTypeScriptFiles('apps/desktop'),
    ].map(read).join('\n');

    expect(productAndDesktop).not.toContain("from '@megumi/agent'");
    expect(productAndDesktop).not.toContain('from "@megumi/agent"');
  });
});

function listTypeScriptFiles(relativeDirectory: string): string[] {
  const directory = path.join(root, relativeDirectory);
  const files: string[] = [];
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.[cm]?[tj]sx?$/u.test(entry.name)) files.push(path.relative(root, absolute));
    }
  };
  visit(directory);
  return files;
}
