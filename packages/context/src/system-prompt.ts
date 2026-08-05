/*
 * Materializes the System Prompt in a fixed order: Base Instructions, Effective
 * Instructions, Skill Catalog, Execution Environment. Empty optional sections
 * are omitted entirely; attribute values are XML-escaped, body text is kept raw.
 */

import type { EffectiveInstructions, SystemInstruction } from '@megumi/instructions';
import type { SkillView } from '@megumi/skills';
import type { ExecutionEnvironment } from './context';
import { escapeXmlAttribute } from './xml-escape';

export interface SystemPromptSources {
  readonly baseInstructions: readonly SystemInstruction[];
  readonly effectiveInstructions: EffectiveInstructions;
  readonly skills: SkillView;
  readonly executionEnvironment: ExecutionEnvironment;
}

export function buildSystemPrompt(sources: SystemPromptSources): string {
  const sections: string[] = sources.baseInstructions.map((instruction) => instruction.content);
  const effective = renderEffectiveInstructions(sources.effectiveInstructions);
  if (effective) sections.push(effective);
  const catalog = renderSkillCatalog(sources.skills);
  if (catalog) sections.push(catalog);
  sections.push(renderExecutionEnvironment(sources.executionEnvironment));
  return sections.join('\n\n');
}

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
