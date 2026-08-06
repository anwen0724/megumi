/* Guards Engine-owned final Assistant Reply semantics against competing finalization paths. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Engine final reply source guards', () => {
  it('keeps Session variants explicit and removes the generic assistant write seam', () => {
    const messageModel = read('packages/session/src/session-message.ts');
    const history = read('packages/session/src/session-history.ts');
    expect(messageModel).toContain("'model_response'");
    expect(messageModel).toContain("'assistant_reply'");
    expect(messageModel).not.toContain('conversation:');
    expect(history).toContain('saveModelResponse');
    expect(history).toContain('saveAssistantReply');
    expect(history).not.toContain('saveAssistantMessage');
  });

  it('does not introduce a model-callable finalization tool or persisted Run outcome', () => {
    const source = [
      read('packages/engine/src/agent-loop.ts'),
      read('packages/engine/src/agent-loop.ts'),
      read('packages/database/src/database-schema.ts'),
    ].join('\n');
    expect(source).not.toContain('submit_final_reply');
    expect(source).not.toMatch(/run[_-]?outcome/i);
    expect(source).not.toMatch(/assistant[_-]?reply[_-]?draft/i);
  });

  it('keeps final reply commit inside Engine and terminal facts in the Engine owner', () => {
    const agentLoop = read('packages/engine/src/agent-loop.ts');
    const runEntry = read('packages/engine/src/run.ts');
    // The Agent Loop owns the semantic reply commits (completed, cancelled,
    // failed); the Run operation entry owns the single run.ended terminal fact.
    expect(agentLoop).toContain('dependencies.session.saveAssistantReply({');
    expect(runEntry).toContain("'run.ended'");
    expect(agentLoop).not.toContain("'run.ended'");
    // Event ordering (reply commit before run.ended) is protected by the
    // Engine RuntimeEvents behavior tests.
  });
});
