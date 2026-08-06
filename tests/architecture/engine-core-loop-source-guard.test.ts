/*
 * Guards the single Agent Loop architecture: the target Engine file set, the
 * absence of the old execution chain and continuation machinery, the purity
 * of RunRegistry, and the Run public surface.
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
      'agent-loop.ts',
      'index.ts',
      'run-policy.ts',
      'run-registry.ts',
      'run.ts',
    ]);
  });

  it('removes the old Engine object and shallow helper files', () => {
    for (const removed of [
      'engine.ts',
      'engine-policy.ts',
      'active-run-store.ts',
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
    const rest = [
      read('packages/engine/src/run.ts'),
      read('packages/engine/src/run-registry.ts'),
      read('packages/engine/src/run-policy.ts'),
    ].join('\n');

    expect(agentLoop).toContain('export async function runAgentLoop(');
    expect(agentLoop).toContain('dependencies.context.build(');
    expect(agentLoop).toContain('dependencies.models.streamSimple(');
    expect(agentLoop).toContain('executeToolCallBatch(');
    // No second loop implementation or state machine anywhere else; the Run
    // operation entry may only call runAgentLoop once per Run.
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
    expect(source).not.toContain('createEngine');
    expect(source).not.toContain('interface Engine');
    expect(source).not.toContain('EnginePolicy');
    expect(source).not.toContain('ActiveRunStore');
  });

  it('keeps RunRegistry to run facts, abort, completion and one pending approval', () => {
    const store = read('packages/engine/src/run-registry.ts');
    expect(store).toContain('export class RunRegistry {');
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
    const engineSource = [read('packages/engine/src/run.ts'), read('packages/engine/src/agent-loop.ts')].join('\n');
    expect(engineSource).not.toMatch(/@megumi\/(?:workspace|instructions|skills)(?:\/|['"])/u);
    expect(engineSource).not.toMatch(/executionEnvironment|effectiveInstructions|SkillView/u);
  });

  it('does not export the Agent Loop or internal run records from the public entry', () => {
    const index = read('packages/engine/src/index.ts');
    expect(index).not.toMatch(/runAgentLoop|AgentLoop|runAgentLoop/u);
    expect(index).not.toMatch(/export[^{]*RunRegistry|PendingApproval/u);
    expect(index).toContain('export { createRuns }');
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
