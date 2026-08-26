import { describe, expect, it } from 'vitest';
import { BUILT_IN_TOOL_NAMES, createBuiltInToolRegistry } from '../../../packages/agent/tools/src';
import { createProcessAdapter } from './tool-test-fixtures';

describe('built-in Tool Registry', () => {
  it('binds every built-in Definition to its same-name Handler', () => {
    const registry = completeRegistry();
    expect(registry.list().map((tool) => tool.registeredToolName)).toEqual(BUILT_IN_TOOL_NAMES);
    for (const tool of registry.list()) {
      expect(tool.definition.name).toBe(tool.handler.toolName);
      expect(tool.definition.description.length).toBeGreaterThan(0);
      expect(tool.definition.parameters.type).toBe('object');
      expect(tool.definition).not.toHaveProperty('capabilities');
      expect(tool.definition).not.toHaveProperty('riskLevel');
      expect(tool.definition).not.toHaveProperty('sideEffect');
      expect(tool.definition).not.toHaveProperty('availability');
      expect(tool.definition).not.toHaveProperty('executionMode');
      // Every built-in tool provides a one-line prompt snippet.
      expect(tool.definition.promptSnippet?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('provides the confirmed prompt metadata for the built-in tools', () => {
    const registry = completeRegistry();
    const byName = new Map(registry.list().map((tool) => [tool.registeredToolName, tool.definition]));

    // run_command carries the redacted-output behavior guideline.
    expect(byName.get('run_command')?.promptGuidelines).toEqual([
      'Command output is redacted; sensitive values are replaced before they reach you.',
    ]);
    // Other built-in tools do not provide guidelines; descriptions carry their conventions.
    for (const name of BUILT_IN_TOOL_NAMES.filter((name) => name !== 'run_command')) {
      expect(byName.get(name)?.promptGuidelines ?? []).toEqual([]);
    }
    // Strengthened descriptions quantify the real boundaries.
    expect(byName.get('read_file')?.description).toContain('12,000 bytes');
    expect(byName.get('run_command')?.description).toContain('20,000 bytes per stream');
    expect(byName.get('web_search')?.description).toContain('up to 5 results by default (maximum 20)');
    expect(byName.get('web_fetch')?.description).toContain('up to 9,000 bytes');
    // run_command's description does not repeat the redaction guideline.
    expect(byName.get('run_command')?.description).not.toContain('redacted');
  });
});

const contentTools = {
  async searchContent() { return { outputKind: 'json' as const, content: {} }; },
  async readCandidate() { return { outputKind: 'json' as const, content: {} }; },
};
const dailySelectionTools = {
  async selectRecommendations() { return { outputKind: 'json' as const, content: {} }; },
};
const candidateAdmissionTools = {
  async commitCandidateAdmission() { return { outputKind: 'json' as const, content: {} }; },
};

function completeRegistry() {
  return createBuiltInToolRegistry({
    process: createProcessAdapter(),
    contentTools,
    dailySelectionTools,
    candidateAdmissionTools,
  });
}
