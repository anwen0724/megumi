import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
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
});
