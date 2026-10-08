// @vitest-environment node
import { expect, it } from 'vitest';
import { buildExtractionInput } from '@megumi/application/memory/extraction-input';
import { createMemorySources } from '@megumi/application/coding/sessions/memory-sources';
import { createSourceFixture } from './source-fixture';

it('preserves user evidence while excluding model-only injections and redacting known secrets', async () => {
  const f = createSourceFixture();
  try {
    await f.history.saveUserMessage({ session_id: 's1', message_id: 'u1', created_at: '2026-10-02',
      display_content: [{ type: 'text', text: 'Use AGENTS.md. Credential: synthetic-secret' }],
      model_content: [{ type: 'text', text: 'Injected memory and skill instructions' }] });
    f.reply('a1');
    const result = createMemorySources({ store: f.store, isSessionRunning: () => false }).readSnapshot('s1');
    if (result.status !== 'found') throw new Error('Source unavailable');
    const built = buildExtractionInput({ source: result.snapshot, workspaceDirectory: 'C:/test',
      contextWindow: 32000, maxOutputTokens: 4096, secrets: ['synthetic-secret'] });
    expect(built.prompt).toContain('Use AGENTS.md.');
    expect(built.prompt).toContain('[REDACTED]');
    expect(built.prompt).not.toContain('synthetic-secret');
    expect(built.prompt).not.toContain('Injected memory');
    expect(built.coverage).toMatchObject({ includedMessageIds: ['u1', 'a1'], omittedMessageIds: [], truncated: false });
  } finally { f.database.close(); }
});

it('removes whole middle tool exchanges and reports the omitted message IDs under the input budget', async () => {
  const f = createSourceFixture();
  try {
    await f.user('u1', 'Learn TypeScript generics');
    f.history.saveModelResponse({ session_id: 's1', message_id: 'call', execution_id: 'r1',
      content: [{ type: 'toolCall', id: 'tool1', name: 'read_file', arguments: { path: 'example.ts', api_key: 'not-for-model' } }],
      outcome_status: 'completed', completed_at: '2026-10-02' });
    f.history.saveToolResultMessage({ session_id: 's1', message_id: 'result', execution_id: 'r1',
      tool_call_id: 'tool1', tool_name: 'read_file', status: 'success',
      content: [{ type: 'text', text: '汉'.repeat(5000) }], completed_at: '2026-10-02' });
    f.reply('a1');
    const source = createMemorySources({ store: f.store, isSessionRunning: () => false }).readSnapshot('s1');
    if (source.status !== 'found') throw new Error('Source unavailable');
    const built = buildExtractionInput({ source: source.snapshot, workspaceDirectory: 'C:/test',
      contextWindow: 4096, maxOutputTokens: 512, secrets: [] });
    expect(built.coverage).toMatchObject({ includedMessageIds: ['u1', 'a1'], omittedMessageIds: ['call', 'result'], truncated: true });
    expect(built.coverage.estimatedInputTokens).toBeLessThanOrEqual(built.coverage.inputBudgetTokens);
    expect(built.prompt).toContain('omittedMessageIds');
    const full = buildExtractionInput({ source: source.snapshot, workspaceDirectory: 'C:/test',
      contextWindow: 64000, maxOutputTokens: 8192, secrets: [] });
    expect(full.prompt).toContain('tool1');
    expect(full.prompt).not.toContain('not-for-model');
    expect(() => buildExtractionInput({ source: source.snapshot, workspaceDirectory: 'C:/test',
      contextWindow: 1024, maxOutputTokens: 512, secrets: [] })).toThrow('BUDGET_EXCEEDED');
  } finally { f.database.close(); }
});
