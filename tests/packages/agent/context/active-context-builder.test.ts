/*
 * Verifies that resolved owner facts enter ActiveContext with correct authority and trace.
 */
import { describe, expect, it } from 'vitest';
import type { ConversationTurn, CurrentConversationTurn } from '@megumi/agent/context';
import { buildActiveContext } from '@megumi/agent/context/service/internal/active-context-builder';

describe('buildActiveContext', () => {
  it('separates instructions from reference facts and emits non-visible source refs', () => {
    const historicalTurns: ConversationTurn[] = [{
      source: {
        runId: 'run-history',
        userEntryId: 'entry-user-history',
        userMessageId: 'message-user-history',
        lastEntryId: 'entry-assistant-history',
        responseMessageRefs: [{ entryId: 'entry-assistant-history', messageId: 'message-assistant-history' }],
      },
      userMessage: { type: 'user_message', content: [{ type: 'text', text: 'Earlier input' }] },
      items: [
        { type: 'tool_call', toolCallId: 'call-history', toolName: 'read', arguments: { path: 'a' } },
        { type: 'tool_result', toolCallId: 'call-history', toolName: 'read', status: 'success', content: [{ type: 'text', text: 'result' }] },
        { type: 'assistant_message', content: [{ type: 'text', text: 'Earlier answer' }] },
      ],
    }];
    const currentTurn: CurrentConversationTurn = {
      runId: 'run-current',
      userEntry: { entryId: 'entry-user-current', parentEntryId: 'entry-assistant-history' },
      userMessage: { type: 'user_message', content: [{ type: 'text', text: 'Current input' }] },
      runItems: [],
    };

    const result = buildActiveContext({
      sessionId: 'session-1',
      systemInstructions: [{ instructionId: 'system-1', content: 'System rule' }],
      agentInstructions: {
        sources: [{ sourceId: 'agents-1', sourcePath: 'C:/repo/AGENTS.md', content: 'Agent rule' }],
      },
      skillCatalog: [{ name: 'Catalog Skill', description: 'Available skill', skillPath: 'C:/catalog/SKILL.md' }],
      usedSkills: [{
        name: 'Active Skill',
        skillPath: 'C:/active/SKILL.md',
        content: 'Activated instruction',
      }],
      compactionSummary: { compactionId: 'compaction-1', content: 'Earlier summary' },
      memoryRecall: {
        recallId: 'recall-1',
        items: [{ memoryId: 'memory-1', content: [{ type: 'text', text: 'Remembered fact' }] }],
      },
      historicalTurns,
      currentTurn,
      tools: [{ name: 'read', description: 'Read a path', inputSchema: { type: 'object' } }],
    });

    expect(result.activeContext.instructions).toEqual({
      system: [{ instructionId: 'system-1', content: 'System rule' }],
      agentInstructions: {
        sources: [{ sourceId: 'agents-1', sourcePath: 'C:/repo/AGENTS.md', content: 'Agent rule' }],
      },
    });
    expect(result.activeContext.referenceContext).toEqual({
      skillCatalog: [{ name: 'Catalog Skill', description: 'Available skill', skillPath: 'C:/catalog/SKILL.md' }],
      compactionSummary: { compactionId: 'compaction-1', content: 'Earlier summary' },
      memoryRecall: {
        recallId: 'recall-1',
        items: [{ memoryId: 'memory-1', content: [{ type: 'text', text: 'Remembered fact' }] }],
      },
    });
    expect(result.activeContext.runContext).toEqual({
      skills: [{ name: 'Active Skill', skillPath: 'C:/active/SKILL.md', content: 'Activated instruction' }],
    });
    expect(JSON.stringify(result.activeContext.instructions)).not.toContain('Earlier summary');
    expect(JSON.stringify(result.activeContext.instructions)).not.toContain('Remembered fact');
    expect(JSON.stringify(result.activeContext.instructions)).not.toContain('Available skill');
    expect(result.sourceRefs).toContainEqual({ sourceType: 'compaction_summary', sourceId: 'compaction-1' });
    expect(result.sourceRefs).toContainEqual({ sourceType: 'memory', sourceId: 'memory-1' });
    expect(result.sourceRefs).toContainEqual({ sourceType: 'used_skill', sourceId: 'C:/active/SKILL.md' });
    expect(JSON.stringify(result.activeContext)).not.toContain('sourceRefs');
  });
});
