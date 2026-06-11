import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function walk(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return walk(fullPath);
    }
    return /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name) ? [fullPath] : [];
  });
}

function sourceUnder(relativeDirectory: string): string {
  return walk(path.join(root, relativeDirectory))
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n');
}

describe('provider tool call model loop source guards', () => {
  it('keeps provider loop centered on ToolCall, ToolResult, and ToolExecution events', () => {
    const toolLoop = read('packages/core/run-runtime/tool-loop.ts');

    expect(toolLoop).toContain('ToolCallHandlerPort');
    expect(toolLoop).toContain('ToolExecution');
    expect(toolLoop).toContain('tool.call.created');
    expect(toolLoop).toContain('tool.result.created');
    expect(toolLoop).toContain('toolResults');
  });

  it('does not reintroduce RunAction.call_tool as the model tool path', () => {
    const sessionRun = read('apps/desktop/src/main/services/session-run.service.ts');
    const toolLoop = read('packages/core/run-runtime/tool-loop.ts');

    expect(sessionRun).not.toContain("actionKind: 'call_tool'");
    expect(toolLoop).not.toContain('RunAction');
    expect(toolLoop).not.toContain('handleAction');
  });

  it('does not implement real built-in tools or permission policy in Plan 2 code paths', () => {
    const toolLoop = read('packages/core/run-runtime/tool-loop.ts');
    const sessionRun = read('apps/desktop/src/main/services/session-run.service.ts');

    expect(toolLoop).not.toContain('readFileSync');
    expect(toolLoop).not.toContain('writeFileSync');
    expect(toolLoop).not.toContain('spawn');
    expect(toolLoop).not.toContain('execFile');
    expect(sessionRun).not.toContain('PermissionPolicy');
  });

  it('does not keep legacy chat runtime or model input fields in core provider paths', () => {
    const files = [
      'packages/ai/types.ts',
      'packages/ai/prompt/message-mapper.ts',
      'packages/ai/providers/openai-compatible.ts',
      'packages/ai/providers/anthropic.ts',
      'packages/core/ports/ai-port.ts',
      'packages/core/run-runtime/tool-loop.ts',
      'apps/desktop/src/main/services/model-step-provider.service.ts',
      'apps/desktop/src/main/services/session-run.service.ts',
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).not.toMatch(/\bChatRuntimeRequest\b/);
      expect(source).not.toMatch(/\bChatRuntimeContext\b/);
      expect(source).not.toMatch(/\bstreamChat\b/);
      expect(source).not.toMatch(/\bmapToOpenAICompatibleMessages\b/);
      expect(source).not.toMatch(/\bbuildSystemPrompt\b/);
      expect(source).not.toMatch(/\bModelStepRuntimeRequest\['messages'\]/);
    }
  });

  it('keeps ModelStepRuntimeRequest centered on inputContext', () => {
    const source = read('packages/shared/model-step-contracts.ts');
    const legacyToolCallArrayPattern = new RegExp(String.raw`\btool` + String.raw`Uses\?:\s*Tool` + String.raw`Use\[\]`);

    expect(source).toContain('inputContext: ModelInputContext');
    expect(source).not.toMatch(/\bmessages:\s*SessionMessage\[\]/);
    expect(source).not.toMatch(/\bcontext\?:\s*RunContext/);
    expect(source).not.toMatch(legacyToolCallArrayPattern);
    expect(source).not.toMatch(/\btoolResults\?:\s*ToolResult\[\]/);
    expect(source).not.toMatch(/\bproviderStates\?:\s*ModelStepProviderState\[\]/);
    expect(source).not.toMatch(/\bmodeSnapshot\?:\s*PermissionModeSnapshot/);
  });

  it('requires provider request materialization to use full model step runtime requests', () => {
    const source = read('packages/ai/prompt/message-mapper.ts');

    expect(source).not.toMatch(/\bPartial<ModelStepRuntimeRequest>\b/);
    expect(source).not.toMatch(/\bModelStepPromptRequest\b/);
  });

  it('keeps provider adapters free of input command contracts and intent dispatch semantics', () => {
    const source = sourceUnder('packages/ai');

    expect(source).not.toContain('input-command-contracts');
    expect(source).not.toContain('InputIntentCommandMetadata');
    expect(source).not.toContain('dispatchCommandText');
    expect(source).not.toContain('BUILT_IN_INPUT_COMMAND');
  });

  it('keeps the core tool loop free of active path persistence concerns', () => {
    const source = read('packages/core/run-runtime/tool-loop.ts');

    expect(source).not.toContain('Session' + 'ActivePathRepository');
    expect(source).not.toContain('session_' + 'source_entries');
    expect(source).not.toContain('session_' + 'active_leaves');
    expect(source).not.toContain('session_' + 'branch_markers');
    expect(source).not.toContain('session_' + 'retry_attempts');
    expect(source).not.toContain('session_' + 'interrupted_run_markers');
    expect(source).not.toContain('list' + 'RecoverableRuns(');
    expect(source).not.toContain('mark' + 'InterruptedRuns(');
    expect(source).not.toContain('classify' + 'AutomaticModelStepRetry(');
    expect(source).not.toContain('get' + 'ActivePath(');
    expect(source).not.toContain('get' + 'ActiveLeaf(');
  });

  it('keeps provider adapters away from workspace restore persistence and safety decisions', () => {
    const source = sourceUnder('packages/ai');
    const forbidden = [
      'Workspace' + 'ChangeRepository',
      'Workspace' + 'RestoreService',
      'workspace_' + 'changed_files',
      'workspace_' + 'restore_requests',
      'current_' + 'hash_mismatch',
      'restore' + 'ModifiedFile',
      'restore' + 'CreatedFile',
      'restore' + 'DeletedFile',
    ];

    for (const term of forbidden) {
      expect(source).not.toContain(term);
    }
  });
});
