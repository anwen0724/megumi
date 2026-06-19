// Top-level complete API implemented by consuming the assistant message stream result.
import { type ModelContextInput } from './context';
import { type AssistantMessage } from './message';
import { type Model } from './model';
import { type AiRequestOptions } from './request';
import { stream } from './stream';
import { type ToolSet } from './tool-set';

export async function complete(
  model: Model,
  context: ModelContextInput,
  options: AiRequestOptions,
  toolSet?: ToolSet,
): Promise<AssistantMessage> {
  return stream(model, context, options, toolSet).result();
}
