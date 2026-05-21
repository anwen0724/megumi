import type {
  SessionMessageSendData,
  SessionMessageSendPayload,
} from '@megumi/shared/ipc-schemas';
import type { api } from './api';

export type MegumiAPI = typeof api;
export type SessionMessageSendPreloadPayload = SessionMessageSendPayload;
export type SessionMessageSendPreloadData = SessionMessageSendData;
