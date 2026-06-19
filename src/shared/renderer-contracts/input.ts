// Renderer-facing input preprocessing DTOs.
import type { JsonObject } from '../json';
import type { PermissionMode, PermissionModeSelectionSource } from './permission';

export type InputCommandKind = 'local' | 'intent' | 'extension' | 'prompt_template' | 'skill';
export type InputCommandSource = 'core' | 'extension' | 'user' | 'project';
export type InputPromptSource = 'fallback' | 'prompt_template' | 'skill' | 'input_hook_transform';

export interface InputCommandDefinition {
  name: string;
  kind: InputCommandKind;
  source: InputCommandSource;
  description: string;
  argumentHint?: string;
}

export interface InputPreprocessingEntry {
  kind: string;
  sourceId: string;
  sourceName: string;
  visibility: 'model_visible' | 'host_only' | string;
  instructionText?: string;
  intentId?: string;
  templateId?: string;
  skillId?: string;
  templateSource?: string;
  skillSource?: string;
  hookId?: string;
  action?: string;
  commandName?: string;
  defaultPermissionMode?: PermissionMode;
  defaultPermissionSource?: PermissionModeSelectionSource;
  metadata?: JsonObject;
}

export interface InputPreprocessingDiagnostic {
  code: string;
  message?: string;
  metadata?: JsonObject;
}

export interface InputPreprocessingResult {
  originalText?: string;
  effectiveUserText?: string;
  text?: string;
  entries?: InputPreprocessingEntry[];
  diagnostics?: InputPreprocessingDiagnostic[];
  command?: { name: string; args?: string };
  attachments?: Array<{ id: string; kind: string; name?: string; path?: string }>;
  metadata?: Record<string, unknown>;
}
