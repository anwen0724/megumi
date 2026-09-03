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
  DailyRecommendationContextMaterial,
  ExecutionEnvironment,
} from '../context';
import type { PreferenceLearningContextMaterial } from '../discovery-context';
import { escapeXmlAttribute, escapeXmlText } from './prompt-markup-formatter';

export interface SystemPromptSources {
  readonly systemInstructions: readonly SystemInstructionDocument[];
  readonly effectiveInstructions?: EffectiveInstructions;
  readonly skills?: SkillView;
  readonly executionEnvironment?: ExecutionEnvironment;
  readonly tools: readonly ToolDefinition[];
  readonly includeAvailableTools?: boolean;
  readonly dailyRecommendationMaterial?: {
    readonly localDate: string;
    readonly material: DailyRecommendationContextMaterial;
  };
  readonly preferenceLearningMaterial?: {
    readonly startedAt: string;
    readonly material: PreferenceLearningContextMaterial;
  };
}

export function buildSystemPrompt(sources: SystemPromptSources): string {
  const sections: string[] = [];
  for (const document of sources.systemInstructions) {
    sections.push(document.content);
  }
  if (sources.dailyRecommendationMaterial) {
    sections.push(renderDailyRecommendationMaterial(
      sources.dailyRecommendationMaterial.localDate,
      sources.dailyRecommendationMaterial.material,
    ));
  }
  if (sources.preferenceLearningMaterial) {
    sections.push(renderPreferenceLearningMaterial(
      sources.preferenceLearningMaterial.startedAt,
      sources.preferenceLearningMaterial.material,
    ));
  }
  const guidance = renderToolGuidelines(sources.tools);
  if (guidance) sections.push(guidance);
  const effective = sources.effectiveInstructions
    ? renderEffectiveInstructions(sources.effectiveInstructions)
    : '';
  if (effective) sections.push(effective);
  const tools = sources.includeAvailableTools === false ? '' : renderAvailableTools(sources.tools);
  if (tools) sections.push(tools);
  const catalog = sources.skills ? renderSkillCatalog(sources.skills) : '';
  if (catalog) sections.push(catalog);
  if (sources.executionEnvironment) {
    sections.push(renderExecutionEnvironment(sources.executionEnvironment));
  }
  return sections.join('\n\n');
}

function renderDailyRecommendationMaterial(
  localDate: string,
  material: DailyRecommendationContextMaterial,
): string {
  return [
    '<daily_recommendation_material>',
    `  <local_date>${escapeXmlText(localDate)}</local_date>`,
    `  <batch>${escapeXmlText(JSON.stringify(material.batch))}</batch>`,
    `  <interests>${escapeXmlText(JSON.stringify(material.interests))}</interests>`,
    `  <exploration_preference>${escapeXmlText(JSON.stringify(material.explorationPreference))}</exploration_preference>`,
    `  <candidates>${escapeXmlText(JSON.stringify(material.candidates))}</candidates>`,
    `  <recent_recommendations>${escapeXmlText(JSON.stringify(material.recentRecommendations))}</recent_recommendations>`,
    `  <pending_feedback>${escapeXmlText(JSON.stringify(material.pendingFeedback))}</pending_feedback>`,
    `  <omitted_pending_feedback_count>${material.omittedPendingFeedbackCount}</omitted_pending_feedback_count>`,
    '</daily_recommendation_material>',
  ].join('\n');
}

function renderPreferenceLearningMaterial(
  startedAt: string,
  material: PreferenceLearningContextMaterial,
): string {
  return [
    '<preference_learning_material>',
    `  <started_at>${escapeXmlText(startedAt)}</started_at>`,
    `  <batch>${escapeXmlText(JSON.stringify(material.batch))}</batch>`,
    `  <interests>${escapeXmlText(JSON.stringify(material.interests))}</interests>`,
    `  <current_preferences>${escapeXmlText(JSON.stringify(material.currentPreferences))}</current_preferences>`,
    `  <feedback_changes>${escapeXmlText(JSON.stringify(material.feedbackChanges))}</feedback_changes>`,
    '</preference_learning_material>',
  ].join('\n');
}

/** Tool-specific prompt guidance follows the profile documents. */
function renderToolGuidelines(tools: readonly ToolDefinition[]): string {
  const items = tools.flatMap((tool) => tool.promptGuidelines ?? []);
  if (items.length === 0) return '';
  return ['Tool guidelines:', ...items.map((item) => `- ${item}`)].join('\n');
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
