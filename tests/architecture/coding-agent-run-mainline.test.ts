// Guards the Coding Agent run mainline so the implementation stays readable from service to turn to loop.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function exists(relativePath: string): boolean {
  return existsSync(join(repoRoot, relativePath));
}

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function sourceFiles(relativePath: string): string[] {
  const absolute = join(repoRoot, relativePath);
  if (!existsSync(absolute)) return [];

  const stat = statSync(absolute);
  if (stat.isFile()) {
    return /\.(ts|tsx)$/.test(absolute) ? [absolute] : [];
  }

  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative(repoRoot, child));
    return /\.(ts|tsx)$/.test(entry.name) ? [child] : [];
  });
}

function filesContaining(relativePath: string, predicate: (source: string) => boolean): string[] {
  return sourceFiles(relativePath)
    .filter((file) => predicate(readFileSync(file, 'utf8')))
    .map((file) => relative(repoRoot, file).replace(/\\/g, '/'));
}

describe('coding agent run mainline guards', () => {
  it('keeps obsolete run structure files removed and explicit replacements present', () => {
    expect(exists('packages/coding-agent/run/tool-calls/tool-call-loop.ts')).toBe(false);
    expect(exists('packages/coding-agent/run/lifecycle/run-state-repository.ts')).toBe(false);
    expect(exists('packages/coding-agent/run/lifecycle')).toBe(false);
    expect(exists('packages/coding-agent/state/lifecycle/run-lifecycle.ts')).toBe(true);
  });

  it('keeps model-call independent from loop and tool-call internals', () => {
    const offenders = filesContaining('packages/coding-agent/agent-loop/model-call', (source) => {
      return /from ['"][^'"]*(\.\.\/loop|\.\.\/tool-calls\/(approval|execution|model-input))/.test(source);
    });

    expect(offenders).toEqual([]);
  });

  it('keeps the agent loop dependent only on the tool-call public boundary', () => {
    const offenders = filesContaining('packages/coding-agent/agent-loop/agent-loop.ts', (source) => {
      return /from ['"][^'"]*tool-call\/(approval|execution|model-input)/.test(source);
    });

    expect(offenders).toEqual([]);
  });

  it('keeps run internals from importing their own public barrel', () => {
    const offenders = filesContaining('packages/coding-agent/run', (source) => {
      return /from ['"]@megumi\/coding-agent\/run['"]/.test(source)
        || /from ['"](?:\.\/|\.\.\/)index['"]/.test(source);
    }).filter((file) => !file.endsWith('/index.ts'));

    expect(offenders).toEqual([]);
  });

  it('keeps AgentRunService from owning session, branch, and timeline entrypoints', () => {
    const source = read('packages/coding-agent/run/agent-run-service.ts');

    for (const forbiddenImplementation of [
      'createSession(',
      'listSessions(',
      'listTimelineMessagesBySession(',
      'createBranchDraft(',
      'cancelBranchDraft(',
    ]) {
      expect(source).not.toContain(forbiddenImplementation);
    }
  });

  it('keeps the run product port in product-runtime instead of a run contract shell', () => {
    const productRunPort = read('packages/coding-agent/product-runtime/agent-run-port.ts');
    const serviceSource = read('packages/coding-agent/run/agent-run-service.ts');

    expect(productRunPort).toContain('export interface AgentRunPort');
    expect(exists('packages/coding-agent/run/run-contract.ts')).toBe(false);
    expect(serviceSource).toContain("from '../product-runtime'");
    expect(serviceSource).not.toContain('export interface AgentRunPort');
    expect(serviceSource).not.toContain('export interface AgentRunServiceOptions');
    expect(serviceSource).not.toContain('export interface AgentRunServiceIds');
  });

  it('keeps manual retry and rerun lifecycle rules out of AgentRunService', () => {
    const serviceSource = read('packages/coding-agent/run/agent-run-service.ts');
    const retrySource = read('packages/coding-agent/state/run-retry-coordinator.ts');

    expect(retrySource).toContain('export class RunRetryCoordinator');
    expect(serviceSource).not.toContain('manualRetryReasonForRunStatus');
    expect(serviceSource).not.toContain('retryAttemptSourceRef');
  });

  it('keeps pending approval indexing in the agent-loop tool-call approval module', () => {
    const serviceSource = read('packages/coding-agent/run/agent-run-service.ts');
    const registrySource = read('packages/coding-agent/agent-loop/tool-call/approval/pending-approval-registry.ts');

    expect(registrySource).toContain('export class PendingApprovalRegistry');
    expect(serviceSource).toContain('PendingApprovalRegistry');
    expect(serviceSource).not.toContain('new Map<string, ApprovalResumeGroup>');
  });

  it('keeps model call context materialization split into focused part builders', () => {
    for (const requiredPath of [
      'packages/coding-agent/context/parts/runtime-constraints.ts',
      'packages/coding-agent/context/parts/instructions.ts',
      'packages/coding-agent/context/parts/session.ts',
      'packages/coding-agent/context/parts/input-preprocessing.ts',
      'packages/coding-agent/context/parts/memory.ts',
      'packages/coding-agent/context/parts/tool-result-model-input.ts',
      'packages/coding-agent/context/parts/provider-state.ts',
      'packages/coding-agent/context/parts/index.ts',
    ]) {
      expect(exists(requiredPath), requiredPath).toBe(true);
    }

    const contextSource = read('packages/coding-agent/context/model-call-context.ts');

    for (const movedImplementation of [
      'function instructionParts(',
      'function sessionInstructionParts(',
      'function inputPreprocessingInstructionParts(',
      'function memoryRecallParts(',
      'function runtimeConstraintParts(',
      'function toolResultModelInputParts(',
      'function providerStateSummary(',
    ]) {
      expect(contextSource).not.toContain(movedImplementation);
    }
  });
});
