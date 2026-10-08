/* Local-only fixed model responses for the real Electron memory lifecycle demonstration. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { once } from 'node:events';

export async function startDesktopModelBoundary(logFile) {
  const calls = [];
  const server = createServer(async (request, response) => {
    try {
      let text = '';
      for await (const part of request) text += part;

      const body = JSON.parse(text);
      const results = body.messages
        .filter(message => message.role === 'tool')
        .map(message => JSON.parse(message.content));
      const call = (name, args) => ({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: `desktop-${calls.length}`,
            type: 'function',
            function: {
              name,
              arguments: JSON.stringify(args),
            },
          },
        ],
      });
      let message;
      if (body.model === 'extract') {
        message = {
          role: 'assistant',
          content: JSON.stringify({
            rawMemory: '',
            rolloutSummary: '',
            rolloutSlug: '',
          }),
        };
      } else if (body.model === 'consolidate') {
        const index = results.length;
        if (index === 0)
          message = call('memory_file', {
            action: 'read',
            path: 'MEMORY.md',
          });
        else if (index === 1)
          message = call('memory_file', {
            action: 'read',
            path: 'memory_summary.md',
          });
        else if (index === 2) {
          assert.ok(results[0].content.includes('desktop-reviewed'));
          message = call('memory_file', {
            action: 'write',
            path: 'MEMORY.md',
            expectedVersion: results[0].version,
            content: results[0].content,
          });
        } else if (index === 3) {
          const marker = results[0].content.match(/\[sourceId=[^\]]+\]/)?.[0];
          assert.ok(marker);
          const content = `# User Profile\nUse desktop-reviewed TypeScript for React examples. ${marker}\n\n# General Tips\nNo reusable knowledge.\n\n# What's in Memory\n## 2026-10-02\nMEMORY.md: desktop-reviewed React examples. ${marker}\n`;
          message = call('memory_file', {
            action: 'write',
            path: 'memory_summary.md',
            expectedVersion: results[1].version,
            content,
          });
        } else if (index === 4) message = call('memory_finish', {});
        else
          message = {
            role: 'assistant',
            content: 'Consolidated.',
          };
      } else {
        assert.equal(body.model, 'task');
        if (!results.length) message = call('memory_read', { path: 'MEMORY.md' });
        else {
          const read = results.at(-1);
          assert.equal(read.status, 'found');
          assert.ok(read.document.content.includes('desktop-reviewed'));
          assert.ok(read.references.length);
          message = {
            role: 'assistant',
            content: `Verified edited memory: use desktop-reviewed TypeScript.\n<memory_citations>${JSON.stringify(read.references)}</memory_citations>`,
          };
        }
      }
      calls.push({
        model: body.model,
        request: body,
        response: message,
      });
      appendFileSync(logFile, JSON.stringify(calls.at(-1)) + '\n');
      const usage = {
        prompt_tokens: 100,
        completion_tokens: 30,
        total_tokens: 130,
      };
      if (body.stream) {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        const delta = message.tool_calls
          ? {
              role: 'assistant',
              tool_calls: message.tool_calls.map((item, index) => ({
                ...item,
                index,
              })),
            }
          : message;
        const chunk = (delta, finish_reason, extra = {}) =>
          `data: ${JSON.stringify({
            id: `desktop-${calls.length}`,
            object: 'chat.completion.chunk',
            created: 1,
            model: body.model,
            choices: [
              {
                index: 0,
                delta,
                finish_reason,
              },
            ],
            ...extra,
          })}\n\n`;
        response.write(chunk(delta, null));
        response.write(chunk({}, message.tool_calls ? 'tool_calls' : 'stop', { usage }));
        response.end('data: [DONE]\n\n');
      } else {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            id: `desktop-${calls.length}`,
            object: 'chat.completion',
            created: 1,
            model: body.model,
            choices: [
              {
                index: 0,
                message,
                finish_reason: message.tool_calls ? 'tool_calls' : 'stop',
              },
            ],
            usage,
          }),
        );
      }
    } catch (error) {
      appendFileSync(logFile, JSON.stringify({ error: String(error) }) + '\n');
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: String(error) } }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  return {
    calls,
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    close: () =>
      new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve()))),
  };
}
