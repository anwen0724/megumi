// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createToolCallHandlerService } from '@megumi/coding-agent/adapters/local/tools/tool-call-handler.service';
import { createToolOrchestratorService } from '@megumi/coding-agent/tools/tool-orchestrator';

describe('ToolCallHandlerService compatibility export', () => {
  it('exports the 19.03 ToolOrchestrator factory for existing call sites', () => {
    expect(createToolCallHandlerService).toBe(createToolOrchestratorService);
  });
});
