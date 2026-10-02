/* Defines the tool declarations selected by Runs and supplied to Context and Tools. */
import type { JsonObject } from '@megumi/ai';

export type JsonSchemaObject = JsonObject;
export type ToolExecutionMode = 'parallel' | 'serial';

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchemaObject;
  /** Agent scheduling hint retained with the ModelCall Tool view; providers ignore it. */
  readonly executionMode?: ToolExecutionMode;
  /** One-line description for the Available tools section in the system prompt; falls back to a folded, truncated description. */
  readonly promptSnippet?: string;
  /** Human-readable UI label; the UI uses name when absent. */
  readonly label?: string;
  /** Behavior guideline items appended to the Behavior guidelines section while this tool is visible in the current ModelCall. */
  readonly promptGuidelines?: readonly string[];
  /** Tools-internal metadata that never enters the model-visible Tool Contract. */
  readonly outputSchema?: JsonSchemaObject;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
    readonly openWorldHint?: boolean;
  };
}
