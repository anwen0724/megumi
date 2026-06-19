// Maps App events into renderer runtime events.
import type { AppEvent } from '../../app';
import type { RendererRuntimeEventDto } from '../dto/renderer-api';

export function mapAppEventToRuntimeEvent(event: AppEvent): RendererRuntimeEventDto {
  return {
    type: event.type,
    occurredAt: event.occurredAt,
    payload: event.payload,
  };
}
