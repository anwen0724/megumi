/* Guards the explicit final-reply architecture against heuristic regressions. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Agent final reply source guards', () => {
  it('keeps Session variants explicit and removes the generic assistant write seam', () => {
    const messageModel = read('packages/agent/session/domain/model/session-message.ts');
    const service = read('packages/agent/session/service/session-service.ts');
    expect(messageModel).toContain("'model_response'");
    expect(messageModel).toContain("'assistant_reply'");
    expect(messageModel).not.toContain('conversation:');
    expect(service).toContain('saveModelResponse');
    expect(service).toContain('saveAssistantReply');
    expect(service).not.toContain('saveAssistantMessage');
  });

  it('does not introduce a model-callable finalization tool or persisted Run outcome', () => {
    const source = [
      read('packages/agent/agent-run/core/run-orchestrator.ts'),
      read('packages/agent/agent-run/core/tool-set-builder.ts'),
      read('packages/agent/persistence/schema/drizzle-schema.ts'),
    ].join('\n');
    expect(source).not.toContain('submit_final_reply');
    expect(source).not.toMatch(/run[_-]?outcome/i);
    expect(source).not.toMatch(/assistant[_-]?reply[_-]?draft/i);
  });

  it('keeps final reply commit before every orchestrator terminal event', () => {
    const orchestrator = read('packages/agent/agent-run/core/run-orchestrator.ts');
    expect(orchestrator.indexOf('commitTerminalReply({')).toBeLessThan(
      orchestrator.indexOf("eventType: 'run.completed'"),
    );
    const failCommit = orchestrator.lastIndexOf('commitTerminalReply({');
    expect(failCommit).toBeLessThan(orchestrator.lastIndexOf("eventType: 'run.failed'"));
  });
});
