/*
 * Public Product runtime timeline read-model entrypoint.
 */

export {
  TimelineMessageSchema,
  reduceRuntimeTimelineEvent,
} from '../../coding-agent/projections/timeline';
export type {
  AnswerTextBlock,
  ProcessDisclosureBlock,
  TimelineMessage,
} from '../../coding-agent/projections/timeline';
export type * from '../../coding-agent/projections/timeline';
