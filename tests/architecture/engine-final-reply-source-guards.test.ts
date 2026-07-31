/* Guards Engine-owned final Assistant Reply semantics against competing finalization paths. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Engine final reply source guards', () => {
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
      read('packages/engine/src/run-loop.ts'),
      read('packages/engine/src/tool-call.ts'),
      read('packages/agent/persistence/schema/drizzle-schema.ts'),
    ].join('\n');
    expect(source).not.toContain('submit_final_reply');
    expect(source).not.toMatch(/run[_-]?outcome/i);
    expect(source).not.toMatch(/assistant[_-]?reply[_-]?draft/i);
  });

  it('keeps final reply commit inside Engine and before terminal lifecycle events', () => {
    const runLoop = read('packages/engine/src/run-loop.ts');
    const modelCall = read('packages/engine/src/model-call.ts');
    const toolCall = read('packages/engine/src/tool-call.ts');
    expect(runLoop).toContain('dependencies.session.saveAssistantReply({');
    expect(modelCall).not.toContain('saveAssistantReply');
    expect(toolCall).not.toContain('saveAssistantReply');
    expect(runLoop.indexOf('dependencies.session.saveAssistantReply({')).toBeLessThan(
      runLoop.indexOf("'run.completed'"),
    );
    expect(runLoop.lastIndexOf('dependencies.session.saveAssistantReply({')).toBeLessThan(
      runLoop.lastIndexOf("'run.failed'"),
    );
  });
});
