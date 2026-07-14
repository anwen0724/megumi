/* Verifies image capability rejection before Session persistence or Run creation. */
import { describe, expect, it } from 'vitest';
import { createAgentRunService, type CreateAgentRunServiceOptions } from '@megumi/coding-agent/agent-run';
import { createInMemoryAgentRunRepository, createMessageFlowDependencies } from './agent-run-test-helpers';

describe('Agent Run image capability', () => {
  it('rejects an image input before saving the message when the resolved model cannot see images', async () => {
    const repository = createInMemoryAgentRunRepository();
    const dependencies = createMessageFlowDependencies({ repository });
    dependencies.settings_service.resolveProviderRuntimeConfig.mockReturnValue({
      status: 'ok',
      config: {
        provider_id: 'deepseek',
        protocol: 'openai-compatible',
        base_url: 'https://api.deepseek.com',
        model_id: 'text-only',
        api_key: 'test-key',
        capabilities: {
          streaming: true,
          toolCalls: true,
          thinking: false,
          imageInput: false,
        },
      },
    });

    const service = createAgentRunService(dependencies as unknown as CreateAgentRunServiceOptions);
    const result = await service.startRun({
      request_id: 'request:image',
      workspace_id: 'workspace-1',
      session: { type: 'existing', session_id: 'session-1' },
      user_input: {
        text: 'Describe this image',
        attachments: [{
          draft_attachment_id: 'draft:1',
          type: 'image',
          name: 'image.png',
          source: { type: 'host_file_reference', reference_id: 'desktop-image:1' },
        }],
      },
      model_selection: { provider_id: 'deepseek', model_id: 'text-only' },
      permission_mode: 'default',
    });

    expect(result).toMatchObject({
      status: 'failed',
      failure: {
        code: 'model_call_failed',
        message: 'The selected model does not support image input.',
      },
    });
    expect(dependencies.session_service.saveUserMessage).not.toHaveBeenCalled();
    expect(repository.listRuns()).toEqual([]);
  });

  it('allows unknown image capability to reach the provider and returns the canonical saved user message', async () => {
    const repository = createInMemoryAgentRunRepository();
    const dependencies = createMessageFlowDependencies({ repository });
    dependencies.settings_service.resolveProviderRuntimeConfig.mockReturnValue({
      status: 'ok',
      config: {
        provider_id: 'custom',
        protocol: 'openai-compatible',
        base_url: 'https://example.com/v1',
        model_id: 'custom-model',
        api_key: 'test-key',
        capabilities: {
          streaming: 'unknown',
          toolCalls: 'unknown',
          thinking: 'unknown',
          imageInput: 'unknown',
        },
      },
    } as never);

    const service = createAgentRunService(dependencies as unknown as CreateAgentRunServiceOptions);
    const result = await service.startRun({
      request_id: 'request:unknown-image',
      workspace_id: 'workspace-1',
      session: { type: 'existing', session_id: 'session-1' },
      user_input: {
        text: 'Describe this image',
        attachments: [{
          draft_attachment_id: 'draft:1',
          type: 'image',
          name: 'image.png',
          source: { type: 'host_file_reference', reference_id: 'desktop-image:1' },
        }],
      },
      model_selection: { provider_id: 'custom', model_id: 'custom-model' },
    });

    expect(result).toMatchObject({
      status: 'started',
      user_message_id: 'message-1',
      user_message: {
        message: { message_id: 'message-1', run_id: 'run-1' },
        attachments: [{ attachment_id: 'attachment-1' }],
      },
    });
    expect(dependencies.session_service.saveUserMessage).toHaveBeenCalledTimes(1);
  });
});
