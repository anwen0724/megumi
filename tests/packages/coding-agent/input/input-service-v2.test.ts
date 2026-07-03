import { describe, expect, it } from 'vitest';
import {
  createInputService,
  type RawUserInputAttachment,
} from '@megumi/coding-agent/input';

describe('Input Service v2', () => {
  it('normalizes and classifies ordinary text as message', async () => {
    const service = createInputService();

    await expect(service.processUserInput({
      user_input: {
        text: '   帮我看下代码  ',
      },
    })).resolves.toEqual({
      status: 'ok',
      parsed_user_input: {
        type: 'message',
        text: '帮我看下代码',
        attachments: [],
      },
    });
  });

  it('normalizes line endings without collapsing internal whitespace', async () => {
    const service = createInputService();

    await expect(service.processUserInput({
      user_input: {
        text: '修一下：\r\n\r\n    const a = 1;',
      },
    })).resolves.toEqual({
      status: 'ok',
      parsed_user_input: {
        type: 'message',
        text: '修一下：\n\n    const a = 1;',
        attachments: [],
      },
    });
  });

  it('classifies command-shaped text as command without parsing name or arguments', async () => {
    const service = createInputService();

    await expect(service.processUserInput({
      user_input: {
        text: ' /compact now ',
      },
    })).resolves.toEqual({
      status: 'ok',
      parsed_user_input: {
        type: 'command',
        text: '/compact now',
        attachments: [],
      },
    });
  });

  it('classifies slash-only text as message', async () => {
    const service = createInputService();

    await expect(service.processUserInput({
      user_input: {
        text: '/   ',
      },
    })).resolves.toEqual({
      status: 'ok',
      parsed_user_input: {
        type: 'message',
        text: '/',
        attachments: [],
      },
    });
  });

  it('does not classify slash in the middle as command', async () => {
    const service = createInputService();

    await expect(service.processUserInput({
      user_input: {
        text: 'hello /compact',
      },
    })).resolves.toEqual({
      status: 'ok',
      parsed_user_input: {
        type: 'message',
        text: 'hello /compact',
        attachments: [],
      },
    });
  });

  it('preserves attachments without using them for command classification', async () => {
    const service = createInputService();
    const attachment: RawUserInputAttachment = {
      attachment_id: 'upload:image:1',
      type: 'image',
      mime_type: 'image/png',
      source: { type: 'local_file', path: 'C:/tmp/error.png' },
    };

    await expect(service.processUserInput({
      user_input: {
        text: '/ask 解释这张图里的错误',
        attachments: [attachment],
      },
    })).resolves.toEqual({
      status: 'ok',
      parsed_user_input: {
        type: 'command',
        text: '/ask 解释这张图里的错误',
        attachments: [attachment],
      },
    });
  });

  it('classifies attachment-only input as message', async () => {
    const service = createInputService();
    const attachment: RawUserInputAttachment = {
      attachment_id: 'upload:file:1',
      type: 'file',
      source: { type: 'host_reference', reference_id: 'host:file:1' },
    };

    await expect(service.processUserInput({
      user_input: {
        text: '',
        attachments: [attachment],
      },
    })).resolves.toEqual({
      status: 'ok',
      parsed_user_input: {
        type: 'message',
        text: '',
        attachments: [attachment],
      },
    });
  });
});
