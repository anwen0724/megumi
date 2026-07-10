/*
 * Public Product runtime-event protocol entrypoint for host transports and renderers.
 */

export {
  RuntimeContextSchema,
  RuntimeErrorSchema,
  RuntimeEventSchema,
  RuntimeIdSchema,
  RuntimeResultMetaSchema,
  createRuntimeContext as buildRuntimeContext,
  createRuntimeDebugId as generateRuntimeDebugId,
  createRuntimeTraceId as generateRuntimeTraceId,
} from '../../coding-agent/events';
export type { RuntimeContext, RuntimeEvent } from '../../coding-agent/events';
export type * from '../../coding-agent/events';
export { normalizeRuntimeError as normalizeHostRuntimeError } from '../../coding-agent/runtime-error';
