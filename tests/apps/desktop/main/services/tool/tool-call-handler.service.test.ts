// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createToolCallHandlerService } from '@megumi/desktop/main/services/tool/tool-call-handler.service';
import { createToolOrchestratorService } from '@megumi/desktop/main/services/tool/tool-orchestrator.service';

describe('ToolCallHandlerService compatibility export', () => {
  it('exports the 19.03 ToolOrchestrator factory for existing call sites', () => {
    expect(createToolCallHandlerService).toBe(createToolOrchestratorService);
  });
});
