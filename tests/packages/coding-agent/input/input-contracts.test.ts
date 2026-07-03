import { describe, expect, it } from 'vitest';
import type {
  ParsedUserInput,
  ProcessUserInputRequest,
  ProcessUserInputResult,
  RawUserInput,
  RawUserInputAttachment,
} from '@megumi/coding-agent/input';

describe('input contracts', () => {
  it('models raw user input as submitted text plus attachment references', () => {
    const attachment: RawUserInputAttachment = {
      attachment_id: 'upload:image:1',
      type: 'image',
      name: 'error.png',
      mime_type: 'image/png',
      source: { type: 'local_file', path: 'C:/tmp/error.png' },
    };
    const user_input: RawUserInput = {
      text: '看一下这张图',
      attachments: [attachment],
    };
    const request: ProcessUserInputRequest = { user_input };

    expect(request.user_input.attachments?.[0]).toEqual(attachment);
  });

  it('models parsed message input without command fields', () => {
    const parsed_user_input: ParsedUserInput = {
      type: 'message',
      text: '帮我看下代码',
      attachments: [],
    };
    const result: ProcessUserInputResult = {
      status: 'ok',
      parsed_user_input,
    };

    expect(result.parsed_user_input.type).toBe('message');
    expect('command' in result.parsed_user_input).toBe(false);
    expect('command_result' in result.parsed_user_input).toBe(false);
    expect('command_execution_context' in result.parsed_user_input).toBe(false);
  });

  it('models parsed command-shaped input as full normalized text only', () => {
    const parsed_user_input: ParsedUserInput = {
      type: 'command',
      text: '/compact now',
      attachments: [],
    };

    expect(parsed_user_input.type).toBe('command');
    expect(parsed_user_input.text).toBe('/compact now');
    expect('command' in parsed_user_input).toBe(false);
    expect('command_result' in parsed_user_input).toBe(false);
  });
});
