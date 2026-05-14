export type TimelineMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface TimelineMessageData {
  id: string;
  role: TimelineMessageRole;
  content: string;
  timestamp: string;
  stepNum?: number;
}
