import type {
  AssistantTextDeltaEvent,
  ChatStreamEventBase,
  ChatStreamEventType,
  TypedChatStreamEvent,
} from './chat-stream-contracts';

type ChatStreamEventCommonInput = Omit<ChatStreamEventBase, 'eventType'>;

type ChatStreamEventData<TType extends ChatStreamEventType> = Omit<
  TypedChatStreamEvent<TType>,
  keyof ChatStreamEventBase
>;

export type ChatStreamEventFactoryInput<TType extends ChatStreamEventType> =
  ChatStreamEventCommonInput & {
    eventType: TType;
  } & ChatStreamEventData<TType>;

export function createChatStreamEvent<TType extends ChatStreamEventType>(
  input: ChatStreamEventFactoryInput<TType>,
): TypedChatStreamEvent<TType> {
  return { ...input } as TypedChatStreamEvent<TType>;
}

export function createAssistantTextDeltaChatStreamEvent(
  input: ChatStreamEventCommonInput & Omit<AssistantTextDeltaEvent, keyof ChatStreamEventBase>,
): AssistantTextDeltaEvent {
  return createChatStreamEvent({
    ...input,
    eventType: 'assistant.text.delta',
  });
}




