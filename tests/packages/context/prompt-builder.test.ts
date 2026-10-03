/* Verifies system prompt ordering and tool guidance using the public formatter. */
import { expect, it } from 'vitest';
import { buildSystemPrompt, type SystemPromptSources } from '@megumi/agent/context/prompt-builder';
import type { ToolDefinition } from '@megumi/agent';

const tools: readonly ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a file',
    parameters: { type: 'object' },
    promptSnippet: 'Read file contents.',
  },
  {
    name: 'run_command',
    description: 'Run a command and return output previews.',
    parameters: { type: 'object' },
    promptGuidelines: ['Command output is redacted; sensitive values are replaced before they reach you.'],
  },
];

const sources: SystemPromptSources = {
  systemInstructions: [{ instructionId: 'system', sourcePath: '/system.md', content: 'Be concise.' }],
  effectiveInstructions: { sources: [{ sourceId: 'workspace', sourcePath: '/workspace/AGENTS.md', content: 'Project rules' }] },
  executionEnvironment: { workingDirectory: '/workspace', operatingSystem: 'Windows', shell: 'PowerShell' },
  tools,
};

it('keeps instruction, tool guidance, project rules, tool list and environment in order', () => {
  const text = buildSystemPrompt(sources);
  const positions = ['Be concise.', 'Tool guidelines:', '<effective_instructions>', '<available_tools>', '<execution_environment>']
    .map(marker => text.indexOf(marker));
  expect(positions.every(position => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((left, right) => left - right));
  expect(text).toContain('- read_file: Read file contents.');
  expect(text).toContain('- run_command: Run a command and return output previews.');
  expect(text).not.toContain('<available_skills>');
});

it('folds and truncates descriptions and omits empty tool sections', () => {
  const text = buildSystemPrompt({ ...sources, tools: [{ name: 'run_command', parameters: { type: 'object' },
    description: `Run a command\n  with   odd spacing ${'x'.repeat(200)}` }] });
  expect(text).toContain(`- run_command: Run a command with odd spacing ${'x'.repeat(120 - 31)}...`);
  expect(text).not.toContain('\n  with');
  expect(buildSystemPrompt({ ...sources, tools: [] })).not.toContain('<available_tools>');
});
