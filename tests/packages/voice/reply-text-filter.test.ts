/* Verifies the reply text filter that turns Assistant Replies into speakable text. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { filterReplyTextForSpeech } from '../../../packages/agent/voice/src/speech-output/reply-text-filter';

describe('filterReplyTextForSpeech', () => {
  it('keeps plain Chinese text', () => {
    expect(filterReplyTextForSpeech('你好，我是 Megumi。')).toBe('你好，我是 Megumi。');
  });

  it('keeps Chinese mixed with English technical words', () => {
    expect(filterReplyTextForSpeech('我已经检查完 packages voice，现在可以运行 npm test。'))
      .toBe('我已经检查完 packages voice，现在可以运行 npm test。');
  });

  it('drops fenced code blocks entirely', () => {
    expect(filterReplyTextForSpeech('开头\n```ts\nconst a = 1;\n```\n结尾')).toBe('开头 结尾');
  });

  it('drops inline code spans', () => {
    expect(filterReplyTextForSpeech('用 `npm test` 运行')).toBe('用 运行');
  });

  it('drops URLs', () => {
    expect(filterReplyTextForSpeech('见 https://example.com/a 或 www.example.com 了解')).toBe('见 或 了解');
  });

  it('strips headings, bold and italic markers while keeping the words', () => {
    expect(filterReplyTextForSpeech('# 标题\n\n正文 **加粗** 与 *斜体*')).toBe('标题 正文 加粗 与 斜体');
  });

  it('strips list markers and blockquotes', () => {
    expect(filterReplyTextForSpeech('- 第一项\n- 第二项\n1. 第三项\n> 引用一行'))
      .toBe('第一项 第二项 第三项 引用一行');
  });

  it('keeps link text and drops the target', () => {
    expect(filterReplyTextForSpeech('详见[文档](https://x.com/a)说明')).toBe('详见文档说明');
  });

  it('strips table pipes and horizontal rules', () => {
    expect(filterReplyTextForSpeech('| 表格 | a | b |\n\n---\n\n结尾')).toBe('表格 a b 结尾');
  });

  it('returns an empty string when only code remains', () => {
    expect(filterReplyTextForSpeech('```\ncode only\n```')).toBe('');
  });

  it('returns an empty string for empty input', () => {
    expect(filterReplyTextForSpeech('')).toBe('');
    expect(filterReplyTextForSpeech('   \n  ')).toBe('');
  });
});
