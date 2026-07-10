/*
 * Renderer-safe public Product Host Interface exports.
 * Host factory implementations remain internal to Product Composition.
 */
export * from './product-host-interface';
export type * from './workspace-host';
export type * from './chat-host';
export type * from './skill-host';
export type * from './settings-host';
export type * from './approval-host';
export type * from './artifact-host';
export type * from './plan-host';
export type { RuntimeContext, RuntimeEvent } from '../../coding-agent/events';
export type * from '../../coding-agent/events';
export type * from '../../coding-agent/projections/timeline';
export type * from '../../coding-agent/projections/workspace/workspace-change-footer-projector';
export type { PermissionMode } from '../../coding-agent/permissions';
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
export { normalizeRuntimeError as normalizeHostRuntimeError } from '../../coding-agent/runtime-error';
export { reduceRuntimeTimelineEvent } from '../../coding-agent/projections/timeline';
