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
} from '../../agent/events';
export type { RuntimeContext, RuntimeEvent } from '../../agent/events';
export type * from '../../agent/events';
export { normalizeRuntimeError as normalizeHostRuntimeError } from '../../agent/runtime-error';
