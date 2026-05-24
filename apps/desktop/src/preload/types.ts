import type {
  SessionMessageSendData,
  SessionMessageSendPayload,
  SessionTimelineListData,
  SessionTimelineListPayload,
} from '@megumi/shared/ipc-schemas';
import type { api } from './api';

export type MegumiAPI = typeof api;
export type SessionMessageSendPreloadPayload = SessionMessageSendPayload;
export type SessionMessageSendPreloadData = SessionMessageSendData;
export type SessionTimelineListPreloadPayload = SessionTimelineListPayload;
export type SessionTimelineListPreloadData = SessionTimelineListData;
