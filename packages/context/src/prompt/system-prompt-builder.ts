/*
 * Materializes the System Prompt in a fixed six-section order: Identity
 * paragraph, Behavior guidelines heading with one bullet per item, Effective
 * Instructions, Available tools, Skill Catalog, Execution Environment. Empty
 * optional sections are omitted entirely; attribute values are XML-escaped,
 * body text is kept raw. Sections are paragraphs that may contain bullet lists
 * or XML blocks; grouping inside instructions never leaks into the prompt.
 */

import type { SystemInstruction } from '@megumi/instructions';
import type { EffectiveInstructions } from '@megumi/instructions';
import type { SkillView } from '@megumi/skills';
import type { ToolDefinition } from '@megumi/tools';
import type { ExecutionEnvironment } from '../context';
import { escapeXmlAttribute } from './prompt-markup-formatter';

export interface SystemPromptSources {
  readonly systemInstructions: readonly SystemInstruction[];
  readonly effectiveInstructions: EffectiveInstructions;
  readonly skills: SkillView;
  readonly executionEnvironment: ExecutionEnvironment;
  readonly tools: readonly ToolDefinition[];
}

export function buildSystemPrompt(sources: SystemPromptSources): string {
  const sections: string[] = [];
  const identity = renderIdentity(sources.systemInstructions);
  if (identity) sections.push(identity);
  const guidance = renderBehaviorGuidelines(sources.systemInstructions);
  if (guidance) sections.push(guidance);
  const effective = renderEffectiveInstructions(sources.effectiveInstructions);
  if (effective) sections.push(effective);
  const tools = renderAvailableTools(sources.tools);
  if (tools) sections.push(tools);
  const catalog = renderSkillCatalog(sources.skills);
  if (catalog) sections.push(catalog);
  sections.push(renderExecutionEnvironment(sources.executionEnvironment));
  return sections.join('\n\n');
}

/** ① Identity paragraph: instructions whose segment is 'identity', items merged into one paragraph. */
function renderIdentity(instructions: readonly SystemInstruction[]): string {
  const items = instructions
    .filter((instruction) => instructionSegment(instruction.instructionId) === 'identity')
    .flatMap((instruction) => instruction.groups.flatMap((group) => group.items));
  return items.join(' ');
}

/** ② Behavior guidelines: fixed heading + one bullet per item, groups expanded in order. */
function renderBehaviorGuidelines(instructions: readonly SystemInstruction[]): string {
  const items = instructions
    .filter((instruction) => instructionSegment(instruction.instructionId) === 'guidance')
    .flatMap((instruction) => instruction.groups.flatMap((group) => group.items));
  if (items.length === 0) return '';
  return ['Behavior guidelines:', ...items.map((item) => `- ${item}`)].join('\n');
}

/** The instruction segment is the last namespace part (identity / guidance). */
function instructionSegment(instructionId: string): string {
  return instructionId.split('.').at(-1) ?? '';
}

/** ④ Available tools: one line per tool with a folded, truncated description snippet. */
function renderAvailableTools(tools: readonly ToolDefinition[]): string {
  if (tools.length === 0) return '';
  const lines = tools.map((tool) => `- ${tool.name}: ${snippetFromDescription(tool.description)}`);
  return `<available_tools>\n${lines.join('\n')}\n</available_tools>`;
}

/** Fold newlines and repeated whitespace, then truncate the description to one line. */
function snippetFromDescription(description: string): string {
  const singleLine = description.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return singleLine.length > TOOL_SNIPPET_MAX_CHARS
    ? `${singleLine.slice(0, TOOL_SNIPPET_MAX_CHARS)}...`
    : singleLine;
}

const TOOL_SNIPPET_MAX_CHARS = 120;

export function renderEffectiveInstructions(instructions: EffectiveInstructions): string {
  if (instructions.sources.length === 0) return '';
  const entries = instructions.sources.map((source) => (
    [
      `  <instruction path="${escapeXmlAttribute(source.sourcePath)}">`,
      `    ${source.content}`,
      '  </instruction>',
    ].join('\n')
  ));
  return `<effective_instructions>\n${entries.join('\n')}\n</effective_instructions>`;
}

export function renderSkillCatalog(skills: SkillView): string {
  if (skills.catalog.length === 0) return '';
  const entries = skills.catalog.map((skill) => (
    [
      '  <skill>',
      `    <name>${escapeXmlAttribute(skill.name)}</name>`,
      `    <description>${escapeXmlAttribute(skill.description)}</description>`,
      `    <location>${escapeXmlAttribute(skill.skillPath)}</location>`,
      '  </skill>',
    ].join('\n')
  ));
  return `<available_skills>\n${entries.join('\n')}\n</available_skills>`;
}

export function renderExecutionEnvironment(environment: ExecutionEnvironment): string {
  return [
    '<execution_environment>',
    `  <working_directory>${escapeXmlAttribute(environment.workingDirectory)}</working_directory>`,
    `  <operating_system>${escapeXmlAttribute(environment.operatingSystem)}</operating_system>`,
    `  <shell>${escapeXmlAttribute(environment.shell)}</shell>`,
    '</execution_environment>',
  ].join('\n');
}
