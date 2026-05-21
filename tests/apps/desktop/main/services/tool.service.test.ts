// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ToolService } from '@megumi/desktop/main/services/tool.service';
import { createBuiltInToolRegistry } from '@megumi/tools/built-ins';

describe('ToolService', () => {
  it('lists built-in tool definitions without executing them', () => {
    const repository = {
      getToolCall: vi.fn(),
      getApprovalRequest: vi.fn(),
      saveApprovalRecord: vi.fn(),
    };
    const service = new ToolService({
      registry: createBuiltInToolRegistry(),
      repository: repository as never,
    });

    expect(service.listDefinitions({ runId: 'run-1' }).map((tool) => tool.name)).toEqual([
      'read_file',
      'list_directory',
      'glob',
      'search_text',
      'edit_file',
      'write_file',
      'run_command',
    ]);
    expect(repository.getToolCall).not.toHaveBeenCalled();
    expect(repository.getApprovalRequest).not.toHaveBeenCalled();
    expect(repository.saveApprovalRecord).not.toHaveBeenCalled();
  });
});
