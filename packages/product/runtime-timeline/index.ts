/*
 * Public Product runtime timeline read-model entrypoint.
 */

export {
  TimelineMessageSchema,
  reduceRuntimeTimelineEvent,
} from '../../agent/projections/timeline';
export type {
  AnswerTextBlock,
  ProcessDisclosureBlock,
  TimelineMessage,
} from '../../agent/projections/timeline';
export type * from '../../agent/projections/timeline';
