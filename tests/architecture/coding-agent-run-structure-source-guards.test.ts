// Guards the target Coding Agent run layout so future refactors keep the main run path readable.
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

function combinedSource(relativePath: string): string {
  return sourceFiles(relativePath)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

function filesContaining(relativePath: string, predicate: (source: string) => boolean): string[] {
  return sourceFiles(relativePath)
    .filter((file) => predicate(readFileSync(file, 'utf8')))
    .map((file) => relative(repoRoot, file).replace(/\\/g, '/'));
}

describe('coding agent run structure source guards', () => {
  it('keeps model call as the run model boundary without provider ownership', () => {
    expect(exists('packages/coding-agent/run/model-step')).toBe(false);
    expect(exists('packages/coding-agent/run/model-call')).toBe(true);

    for (const forbiddenFile of [
      'provider-adapter.ts',
      'provider-registry.ts',
      'provider-service.ts',
    ]) {
      expect(exists(`packages/coding-agent/run/model-call/${forbiddenFile}`)).toBe(false);
    }

    const modelCallSource = combinedSource('packages/coding-agent/run/model-call');
    for (const forbiddenImport of [
      '@megumi/ai/providers/openai',
      '@megumi/ai/providers/deepseek',
      '@megumi/ai/providers/anthropic',
      '@megumi/ai/providers/openai-compatible',
    ]) {
      expect(modelCallSource).not.toContain(forbiddenImport);
    }

    for (const forbiddenToken of [
      'chat/completions',
      'data: [DONE]',
      'reasoning_content',
      'OpenAICompatible',
      'response.body.getReader',
    ]) {
      expect(modelCallSource).not.toContain(forbiddenToken);
    }
  });

  it('keeps the run entry, turn, loop, tool call, and lifecycle file names explicit', () => {
    for (const requiredPath of [
      'packages/coding-agent/run/agent-run-service.ts',
      'packages/coding-agent/run/run-contract.ts',
      'packages/coding-agent/run/turn/run-turn.ts',
      'packages/coding-agent/run/loop/agent-loop.ts',
      'packages/coding-agent/run/loop/model-tool-loop-stream.ts',
      'packages/coding-agent/run/model-call/model-call-runner.ts',
      'packages/coding-agent/run/model-call/model-call-contract.ts',
      'packages/coding-agent/run/model-call/model-call-stream.ts',
      'packages/coding-agent/agent-loop/tool-call/tool-call-runner.ts',
      'packages/coding-agent/agent-loop/tool-call/tool-call-contract.ts',
      'packages/coding-agent/run/lifecycle/run-lifecycle.ts',
      'packages/coding-agent/run/lifecycle/run-error.ts',
      'packages/coding-agent/permissions/tool-policy.ts',
      'packages/coding-agent/projections/chat-stream/chat-stream-event-adapter.ts',
      'packages/coding-agent/projections/timeline/timeline-history-projector.ts',
      'packages/coding-agent/workspace/path-policy.ts',
    ]) {
      expect(exists(requiredPath), requiredPath).toBe(true);
    }

    for (const removedPath of [
      'packages/coding-agent/run/session-run-service.ts',
      'packages/coding-agent/run/run-orchestrator.ts',
      'packages/coding-agent/run/tool-calls/tool-call-handler.ts',
      'packages/coding-agent/run/tool-calls/tool-call-loop.ts',
      'packages/coding-agent/run/turn/turn-contract.ts',
      'packages/coding-agent/run/turn/turn-failure.ts',
      'packages/coding-agent/run/turn/turn-events.ts',
      'packages/coding-agent/run/loop/loop-contract.ts',
      'packages/coding-agent/run/loop/continuation-request.ts',
      'packages/coding-agent/run/lifecycle/run-state-store.ts',
      'packages/coding-agent/run/lifecycle/run-state-repository.ts',
      'packages/coding-agent/run/permissions/project-boundary-policy.ts',
      'packages/coding-agent/run/permissions/tool-policy.ts',
      'packages/coding-agent/run/loop/model-tool-loop.ts',
      'packages/coding-agent/run/events/chat-stream-event-adapter.ts',
      'packages/coding-agent/run/events/timeline-history-projector.ts',
      'packages/coding-agent/run/events/timeline-history-commit-projector.ts',
      'packages/coding-agent/run/tool-calls/execution/tool-execution-events.ts',
      'packages/coding-agent/agent-loop/tool-call/model-input/tool-error-result.ts',
    ]) {
      expect(exists(removedPath), removedPath).toBe(false);
    }
  });

  it('does not keep legacy model-step or provider-service names inside model-call', () => {
    const modelCallSource = combinedSource('packages/coding-agent/run/model-call');

    for (const forbiddenToken of [
      'ModelStepProviderService',
      'createModelStepProviderService',
      'RunModelStepInput',
      'runModelStep',
      'streamModelStep',
      'completeModelStep',
      'cancelModelStep',
      'modelStepPort',
    ]) {
      expect(modelCallSource).not.toContain(forbiddenToken);
    }
  });

  it('keeps tool call contracts and runner names aligned with tool-call-runner', () => {
    const contractSource = read('packages/coding-agent/agent-loop/tool-call/tool-call-contract.ts');
    const runnerSource = read('packages/coding-agent/agent-loop/tool-call/tool-call-runner.ts');

    for (const forbiddenToken of [
      'ToolCallHandler',
      'ToolCallHandlerPort',
      'ToolCallHandlerOutcome',
      'ToolCallHandlerService',
      'ToolCallHandlerInput',
    ]) {
      expect(contractSource).not.toContain(forbiddenToken);
      expect(runnerSource).not.toContain(forbiddenToken);
    }

    for (const implementationToken of [
      'function resumeToolApproval',
      'function advanceExecutionWindows',
      'function runRecord',
      'function outcomeFromRecords',
      'function runtimeEventsFromRecords',
      'function buildToolResultsForNextModelInput',
    ]) {
      expect(runnerSource).not.toContain(implementationToken);
    }
  });

  it('keeps runtime path policy outside run and prevents tools from importing run', () => {
    expect(read('packages/coding-agent/workspace/path-policy.ts')).not.toContain('run/permissions');

    const offenders = filesContaining('packages/coding-agent/tools', (source) => {
      return /from ['"][^'"]*@megumi\/coding-agent\/run/.test(source)
        || /from ['"][^'"]*\.\.?\/.*run\//.test(source);
    });

    expect(offenders).toEqual([]);
  });

  it('keeps loop dependent only on the tool call contract boundary', () => {
    const offenders = filesContaining('packages/coding-agent/run/loop', (source) => {
      return /from ['"][^'"]*tool-calls\/(approval|execution|continuation)/.test(source);
    });

    expect(offenders).toEqual([]);
  });
});
