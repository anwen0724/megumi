/*
 * Materializes the System Prompt in a fixed order: profile documents, Effective
 * Instructions, Available tools, Skill Catalog, Execution Environment. Empty
 * optional sections are omitted entirely; attribute values are XML-escaped,
 * body text is kept raw. Sections are paragraphs that may contain bullet lists
 * or XML blocks; grouping inside instructions never leaks into the prompt.
 */

import type { SystemInstructionDocument } from '@megumi/instructions';
import type { EffectiveInstructions } from '@megumi/instructions';
import type { SkillView } from '@megumi/skills';
import type { ToolDefinition } from '@megumi/tools';
import type {
  CandidateSupplyContextMaterial,
  DailyRecommendationContextMaterial,
  ExecutionEnvironment,
} from '../context';
import { escapeXmlAttribute } from './prompt-markup-formatter';

export interface SystemPromptSources {
  readonly systemInstructions: readonly SystemInstructionDocument[];
  readonly effectiveInstructions?: EffectiveInstructions;
  readonly skills?: SkillView;
  readonly executionEnvironment?: ExecutionEnvironment;
  readonly tools: readonly ToolDefinition[];
  readonly dailyRecommendationMaterial?: {
    readonly localDate: string;
    readonly material: DailyRecommendationContextMaterial;
  };
  readonly candidateSupplyMaterial?: {
    readonly startedAt: string;
    readonly material: CandidateSupplyContextMaterial;
  };
}

export function buildSystemPrompt(sources: SystemPromptSources): string {
  const sections: string[] = [];
  const conversationDocument = sources.systemInstructions.find(
    (document) => document.instructionId === 'megumi.conversation',
  );
  for (const document of sources.systemInstructions) {
    sections.push(document === conversationDocument
      ? appendToolGuidelines(document.content, sources.tools)
      : document.content);
  }
  if (sources.dailyRecommendationMaterial) {
    sections.push(renderDailyRecommendationMaterial(
      sources.dailyRecommendationMaterial.localDate,
      sources.dailyRecommendationMaterial.material,
    ));
  }
  if (sources.candidateSupplyMaterial) {
    sections.push(renderCandidateSupplyMaterial(
      sources.candidateSupplyMaterial.startedAt,
      sources.candidateSupplyMaterial.material,
    ));
  }
  const guidance = conversationDocument ? '' : renderToolGuidelines(sources.tools);
  if (guidance) sections.push(guidance);
  const effective = sources.effectiveInstructions
    ? renderEffectiveInstructions(sources.effectiveInstructions)
    : '';
  if (effective) sections.push(effective);
  const tools = renderAvailableTools(sources.tools);
  if (tools) sections.push(tools);
  const catalog = sources.skills ? renderSkillCatalog(sources.skills) : '';
  if (catalog) sections.push(catalog);
  if (sources.executionEnvironment) {
    sections.push(renderExecutionEnvironment(sources.executionEnvironment));
  }
  return sections.join('\n\n');
}

function renderCandidateSupplyMaterial(
  startedAt: string,
  material: CandidateSupplyContextMaterial,
): string {
  return [
    '<candidate_supply_material>',
    `  <started_at>${escapePromptText(startedAt)}</started_at>`,
    `  <pool>${escapePromptText(JSON.stringify(material.pool))}</pool>`,
    `  <interests>${escapePromptText(JSON.stringify(material.interests))}</interests>`,
    `  <negative_constraints>${escapePromptText(JSON.stringify(material.negativeConstraints))}</negative_constraints>`,
    `  <sources>${escapePromptText(JSON.stringify(material.sources))}</sources>`,
    `  <recent_query_outcomes>${escapePromptText(JSON.stringify(material.recentQueryOutcomes))}</recent_query_outcomes>`,
    `  <pending_candidates>${escapePromptText(JSON.stringify(material.pendingCandidates))}</pending_candidates>`,
    `  <budget>${escapePromptText(JSON.stringify(material.budget))}</budget>`,
    '</candidate_supply_material>',
  ].join('\n');
}

function renderDailyRecommendationMaterial(
  localDate: string,
  material: DailyRecommendationContextMaterial,
): string {
  return [
    '<daily_recommendation_material>',
    `  <local_date>${escapePromptText(localDate)}</local_date>`,
    `  <requested_count>${material.requestedCount}</requested_count>`,
    `  <actual_target>${material.actualTarget}</actual_target>`,
    `  <available_count>${material.availableCount}</available_count>`,
    `  <read_budget>${material.readBudget}</read_budget>`,
    `  <interests>${escapePromptText(JSON.stringify(material.interests))}</interests>`,
    `  <candidates>${escapePromptText(JSON.stringify(material.candidates))}</candidates>`,
    `  <recent_recommendations>${escapePromptText(JSON.stringify(material.recentRecommendations))}</recent_recommendations>`,
    `  <recent_feedback>${escapePromptText(JSON.stringify(material.recentFeedback))}</recent_feedback>`,
    '</daily_recommendation_material>',
  ].join('\n');
}

function escapePromptText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Preserves the original single Behavior-guidelines list for conversation prompts. */
function appendToolGuidelines(
  fixedGuidance: string,
  tools: readonly ToolDefinition[],
): string {
  const items = tools.flatMap((tool) => tool.promptGuidelines ?? []);
  if (items.length === 0) return fixedGuidance;
  const renderedItems = items.map((item) => `- ${item}`).join('\n');
  return fixedGuidance.startsWith('Behavior guidelines:')
    ? `${fixedGuidance}\n${renderedItems}`
    : `${fixedGuidance}\n\nBehavior guidelines:\n${renderedItems}`;
}

/** Tool-specific prompt guidance follows the profile documents. */
function renderToolGuidelines(tools: readonly ToolDefinition[]): string {
  const items = tools.flatMap((tool) => tool.promptGuidelines ?? []);
  if (items.length === 0) return '';
  return ['Behavior guidelines:', ...items.map((item) => `- ${item}`)].join('\n');
}

/** ④ Available tools: a guidance line plus one line per tool; the promptSnippet wins over the folded, truncated description. */
function renderAvailableTools(tools: readonly ToolDefinition[]): string {
  if (tools.length === 0) return '';
  const lines = tools.map((tool) => (
    `- ${tool.name}: ${tool.promptSnippet ?? snippetFromDescription(tool.description)}`
  ));
  return [
    '<available_tools>',
    '  In addition to the tools above, you may have access to other custom tools depending on the project.',
    ...lines,
    '</available_tools>',
  ].join('\n');
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
  return [
    '<effective_instructions>',
    '  User and project-specific instructions and guidelines:',
    ...entries,
    '</effective_instructions>',
  ].join('\n');
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
  return [
    'The following skills provide specialized instructions for specific tasks.',
    'Use the read_file tool to load a skill\'s file when the task matches its description.',
    'When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.',
    '',
    `<available_skills>\n${entries.join('\n')}\n</available_skills>`,
  ].join('\n');
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
