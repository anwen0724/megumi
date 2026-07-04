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
  it('keeps non-run owner tests out of the run test tree', () => {
    for (const removedTestPath of [
      'tests/packages/coding-agent/obsolete-run/events',
      'tests/packages/coding-agent/obsolete-run/instructions',
      'tests/packages/coding-agent/obsolete-run/resources',
      'tests/packages/coding-agent/obsolete-run/permissions',
      'tests/packages/coding-agent/obsolete-run/recovery',
      'tests/packages/coding-agent/obsolete-run/run-input-facts.test.ts',
      'tests/packages/coding-agent/obsolete-run/lifecycle/run-error.test.ts',
      'tests/packages/coding-agent/obsolete-run/lifecycle/run-state-policy.test.ts',
      'tests/packages/coding-agent/obsolete-run/lifecycle/run-approval-resume.test.ts',
      'tests/packages/coding-agent/obsolete-run/lifecycle/run-terminal-coordinator.test.ts',
      'tests/packages/coding-agent/input/run-input-facts.test.ts',
    ]) {
      expect(exists(removedTestPath), removedTestPath).toBe(false);
    }

    for (const ownerTestPath of [
      'tests/packages/coding-agent/events/runtime-event-factory.test.ts',
      'tests/packages/coding-agent/adapters/local/context/agent-instruction-source.test.ts',
      'tests/packages/coding-agent/agent-loop/run-context/run-context-service.test.ts',
      'tests/packages/coding-agent/state/lifecycle/permission-mode-runtime-instruction.test.ts',
      'tests/packages/coding-agent/state/recovery-observation-mapper.test.ts',
      'tests/packages/coding-agent/state/run-error.test.ts',
      'tests/packages/coding-agent/state/run-state-policy.test.ts',
      'tests/packages/coding-agent/state/run-approval-resume.test.ts',
      'tests/packages/coding-agent/state/run-terminal-coordinator.test.ts',
      'tests/packages/coding-agent/agent-loop/agent-run-service.test.ts',
    ]) {
      expect(exists(ownerTestPath), ownerTestPath).toBe(true);
    }
  });

  it('keeps model call as the agent-loop model boundary without provider ownership', () => {
    expect(exists('packages/coding-agent/obsolete-run/model-step')).toBe(false);
    expect(exists('packages/coding-agent/obsolete-run/model-call')).toBe(false);
    expect(exists('packages/coding-agent/agent-loop/model-call')).toBe(true);

    for (const forbiddenFile of [
      'provider-adapter.ts',
      'provider-registry.ts',
      'provider-service.ts',
    ]) {
      expect(exists(`packages/coding-agent/agent-loop/model-call/${forbiddenFile}`)).toBe(false);
    }

    const modelCallSource = combinedSource('packages/coding-agent/agent-loop/model-call');
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

  it('keeps the agent-run runtime service, input preprocessing, agent loop, tool call, and lifecycle file names explicit', () => {
    for (const requiredPath of [
      'packages/coding-agent/agent-loop/services/agent-run-service.ts',
      'packages/coding-agent/composition/agent-run-processing-ids.ts',
      'packages/coding-agent/agent-loop/preprocessing/session-message-input-preprocessing.ts',
      'packages/coding-agent/agent-loop/agent-loop.ts',
      'packages/coding-agent/agent-loop/model-call/model-call-runner.ts',
      'packages/coding-agent/agent-loop/model-call/model-call-contract.ts',
      'packages/coding-agent/agent-loop/model-call/model-call-stream.ts',
      'packages/coding-agent/agent-loop/loop-limits.ts',
      'packages/coding-agent/agent-loop/tool-call/tool-call-runner.ts',
      'packages/coding-agent/agent-loop/tool-call/tool-call-contract.ts',
      'packages/coding-agent/state/lifecycle/run-lifecycle.ts',
      'packages/coding-agent/state/lifecycle/index.ts',
      'packages/coding-agent/state/run-error.ts',
      'packages/coding-agent/permissions/services/permission-service.ts',
      ['packages/coding-agent/permissions', 'core/permission-policy.ts'].join('/'),
      'packages/coding-agent/projections/chat-stream/chat-stream-event-adapter.ts',
      'packages/coding-agent/projections/timeline/timeline-history-projector.ts',
      'packages/coding-agent/workspace/core/workspace-path-policy.ts',
    ]) {
      expect(exists(requiredPath), requiredPath).toBe(true);
    }

    for (const removedPath of [
      'packages/coding-agent/obsolete-run/session-run-service.ts',
      'packages/coding-agent/obsolete-run/agent-run-processing-ids.ts',
      'packages/coding-agent/obsolete-run/run-contract.ts',
      'packages/coding-agent/obsolete-run/run-orchestrator.ts',
      'packages/coding-agent/obsolete-run/runtime-input.ts',
      'packages/coding-agent/obsolete-run/tool-calls/tool-call-handler.ts',
      'packages/coding-agent/obsolete-run/tool-calls/tool-call-loop.ts',
      'packages/coding-agent/obsolete-run/turn/run-turn.ts',
      'packages/coding-agent/obsolete-run/turn/turn-contract.ts',
      'packages/coding-agent/obsolete-run/turn/turn-failure.ts',
      'packages/coding-agent/obsolete-run/turn/turn-events.ts',
      'packages/coding-agent/obsolete-run/loop/loop-contract.ts',
      'packages/coding-agent/obsolete-run/loop/continuation-request.ts',
      'packages/coding-agent/obsolete-run/lifecycle/index.ts',
      'packages/coding-agent/obsolete-run/lifecycle/run-lifecycle.ts',
      'packages/coding-agent/obsolete-run/lifecycle/run-types.ts',
      'packages/coding-agent/obsolete-run/lifecycle/run-state-store.ts',
      'packages/coding-agent/obsolete-run/lifecycle/run-state-repository.ts',
      'packages/coding-agent/obsolete-run/lifecycle/run-error.ts',
      'packages/coding-agent/obsolete-run/lifecycle/run-approval-resume.ts',
      'packages/coding-agent/obsolete-run/lifecycle/run-state-policy.ts',
      'packages/coding-agent/obsolete-run/lifecycle/run-terminal-coordinator.ts',
      'packages/coding-agent/obsolete-run/model-call/index.ts',
      'packages/coding-agent/obsolete-run/model-call/model-call-contract.ts',
      'packages/coding-agent/obsolete-run/model-call/model-call-request-mapper.ts',
      'packages/coding-agent/obsolete-run/model-call/model-call-runner.ts',
      'packages/coding-agent/obsolete-run/model-call/model-call-stream.ts',
      'packages/coding-agent/obsolete-run/model-call/model-event-adapter.ts',
      'packages/coding-agent/obsolete-run/tool-calls/index.ts',
      'packages/coding-agent/obsolete-run/tool-calls/tool-call-contract.ts',
      'packages/coding-agent/obsolete-run/tool-calls/tool-call-runner.ts',
      'packages/coding-agent/obsolete-run/tool-calls/approval/index.ts',
      'packages/coding-agent/obsolete-run/tool-calls/approval/approval-events.ts',
      'packages/coding-agent/obsolete-run/tool-calls/approval/approval-resume.ts',
      'packages/coding-agent/obsolete-run/tool-calls/approval/approval-resume-events.ts',
      'packages/coding-agent/obsolete-run/tool-calls/approval/approval-resume-model-input.ts',
      'packages/coding-agent/obsolete-run/tool-calls/approval/pending-approval-registry.ts',
      'packages/coding-agent/obsolete-run/tool-calls/approval/tool-call-approval.ts',
      'packages/coding-agent/obsolete-run/tool-calls/execution/index.ts',
      'packages/coding-agent/obsolete-run/tool-calls/execution/tool-execution-record.ts',
      'packages/coding-agent/obsolete-run/tool-calls/execution/tool-execution-window.ts',
      'packages/coding-agent/obsolete-run/permissions/index.ts',
      'packages/coding-agent/obsolete-run/permissions/project-boundary-policy.ts',
      'packages/coding-agent/obsolete-run/events/index.ts',
      'packages/coding-agent/obsolete-run/events/runtime-event-factory.ts',
      'packages/coding-agent/obsolete-run/events/runtime-event-metadata.ts',
      'packages/coding-agent/obsolete-run/events/runtime-event-utils.ts',
      'packages/coding-agent/obsolete-run/recovery/index.ts',
      'packages/coding-agent/obsolete-run/recovery/recovery-service.ts',
      'packages/coding-agent/obsolete-run/recovery/recovery-observation-mapper.ts',
      'packages/coding-agent/obsolete-run/loop/index.ts',
      'packages/coding-agent/obsolete-run/loop/agent-loop.ts',
      'packages/coding-agent/obsolete-run/loop/model-tool-loop-stream.ts',
      'packages/coding-agent/obsolete-run/loop/approval-resume-model-loop.ts',
      'packages/coding-agent/obsolete-run/loop/loop-limits.ts',
      'packages/coding-agent/obsolete-run/loop/model-tool-loop.ts',
      'packages/coding-agent/obsolete-run/events/chat-stream-event-adapter.ts',
      'packages/coding-agent/obsolete-run/events/timeline-history-projector.ts',
      'packages/coding-agent/obsolete-run/events/timeline-history-commit-projector.ts',
      'packages/coding-agent/obsolete-run/tool-calls/execution/tool-execution-events.ts',
      'packages/coding-agent/obsolete-run/tool-calls/continuation/index.ts',
      'packages/coding-agent/obsolete-run/tool-calls/continuation/tool-continuation-emitted.ts',
      'packages/coding-agent/obsolete-run/tool-calls/continuation/tool-result-continuation.ts',
      'packages/coding-agent/obsolete-run/tool-calls/continuation/tool-result-events.ts',
      'packages/coding-agent/agent-loop/tool-call/model-input/tool-error-result.ts',
    ]) {
      expect(exists(removedPath), removedPath).toBe(false);
    }
  });

  it('does not keep legacy model-step or provider-service names inside model-call', () => {
    const modelCallSource = combinedSource('packages/coding-agent/agent-loop/model-call');

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
    expect(read('packages/coding-agent/workspace/core/workspace-path-policy.ts')).not.toContain('run/permissions');

    const offenders = filesContaining('packages/coding-agent/tools', (source) => {
      return /from ['"][^'"]*@megumi\/coding-agent\/run/.test(source)
        || /from ['"][^'"]*\.\.?\/.*run\//.test(source);
    });

    expect(offenders).toEqual([]);
  });

  it('keeps the agent loop dependent only on the tool call public boundary', () => {
    const offenders = filesContaining('packages/coding-agent/agent-loop/agent-loop.ts', (source) => {
      return /from ['"][^'"]*tool-call\/(approval|execution|model-input)/.test(source);
    });

    expect(offenders).toEqual([]);
  });
});
