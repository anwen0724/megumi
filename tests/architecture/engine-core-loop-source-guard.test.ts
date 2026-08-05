/*
 * Guards the single Agent Loop architecture: the target Engine file set, the
 * absence of the old execution chain and continuation machinery, the purity
 * of ActiveRun, and the Engine public surface.
 */
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Engine core loop source guards', () => {
  it('keeps exactly the target Engine file set', () => {
    const files = listFiles('packages/engine/src');
    expect(files).toEqual([
      'active-run-store.ts',
      'agent-loop.ts',
      'engine-policy.ts',
      'engine.ts',
      'index.ts',
      'run.ts',
    ]);
  });

  it('removes the old execution and shallow helper files', () => {
    for (const removed of [
      'run-loop.ts',
      'model-call.ts',
      'tool-call.ts',
      'canonical-json.ts',
      'timeout-utils.ts',
    ]) {
      expect(fs.existsSync(path.join(root, 'packages/engine/src', removed)), removed).toBe(false);
    }
  });

  it('keeps exactly one model/tool alternating execution loop', () => {
    const agentLoop = read('packages/engine/src/agent-loop.ts');
    const engine = read('packages/engine/src/engine.ts');
    const rest = [engine, read('packages/engine/src/active-run-store.ts'), read('packages/engine/src/run.ts')].join('\n');

    expect(agentLoop).toContain('export async function runAgentLoop(');
    expect(agentLoop).toContain('dependencies.context.build(');
    expect(agentLoop).toContain('dependencies.models.streamSimple(');
    expect(agentLoop).toContain('executeToolCallBatch(');
    // No second loop implementation or state machine anywhere else; the Engine
    // may only call runAgentLoop once per Run.
    expect(rest).not.toMatch(/async function runTurn|async function consumeModelCall|async function\* executeRunLoop/u);
    expect(agentLoop).not.toContain('launchRunLoop');
  });

  it('removes ModelCallEvent, AgentEvent and the approval continuation machinery', () => {
    const source = readTree('packages/engine/src');
    expect(source).not.toContain('ModelCallEvent');
    expect(source).not.toContain('AgentEvent');
    expect(source).not.toContain('ToolCallApprovalContinuation');
    expect(source).not.toContain('continueRunAfterApproval');
    expect(source).not.toContain('launchRunLoop');
    expect(source).not.toContain('resumeRun');
  });

  it('keeps ActiveRun to run facts, abort, completion and one pending approval', () => {
    const store = read('packages/engine/src/active-run-store.ts');
    expect(store).toContain('export interface ActiveRun {');
    for (const forbidden of [
      'toolRouter',
      'router:',
      'continuation',
      'remainingToolCalls',
      'pendingToolCalls',
      'streamOutputs',
      'toolExecutionOutputs',
      'attemptNumber',
      'loopPosition',
    ]) {
      expect(store, forbidden).not.toContain(forbidden);
    }
  });

  it('keeps the Engine free of Workspace, Instructions and Skills imports', () => {
    const engineSource = [read('packages/engine/src/engine.ts'), read('packages/engine/src/agent-loop.ts')].join('\n');
    expect(engineSource).not.toMatch(/@megumi\/(?:workspace|instructions|skills)(?:\/|['"])/u);
    expect(engineSource).not.toMatch(/executionEnvironment|effectiveInstructions|SkillView/u);
  });

  it('does not export the Agent Loop or internal run records from the public entry', () => {
    const index = read('packages/engine/src/index.ts');
    expect(index).not.toMatch(/runAgentLoop|AgentLoop|runAgentLoop/u);
    expect(index).not.toMatch(/export[^{]*ActiveRun|ActiveRunStore|PendingApproval/u);
    expect(index).toContain('export { createEngine }');
    expect(index).toContain("export type {");
  });
});

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readTree(relativePath: string): string {
  return listAbsoluteFiles(relativePath)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
}

function listFiles(relativePath: string): string[] {
  const absolutePath = path.join(root, relativePath);
  return listAbsoluteFiles(relativePath)
    .map((file) => path.relative(absolutePath, file).replaceAll('\\', '/'))
    .sort();
}

function listAbsoluteFiles(relativePath: string): string[] {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  return fs.readdirSync(absolutePath, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}
