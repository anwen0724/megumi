// Verifies that the window.megumi renderer API is owned by shared renderer contracts.
import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS, type MegumiRendererApi, type RendererIpcResult } from '../../../../src/shared/renderer-contracts';

type Assert<T extends true> = T;
type HasPath<T, K extends PropertyKey> = K extends keyof T ? true : false;
type IsPromiseResult<T> = T extends Promise<RendererIpcResult<unknown>> ? true : false;

type ApiSurfaceAssertions = [
  Assert<HasPath<MegumiRendererApi, 'session'>>,
  Assert<HasPath<MegumiRendererApi['session'], 'message'>>,
  Assert<HasPath<MegumiRendererApi['session']['message'], 'send'>>,
  Assert<HasPath<MegumiRendererApi['session']['message'], 'cancel'>>,
  Assert<HasPath<MegumiRendererApi, 'chatStream'>>,
  Assert<HasPath<MegumiRendererApi['chatStream'], 'onEvent'>>,
  Assert<HasPath<MegumiRendererApi, 'runtime'>>,
  Assert<HasPath<MegumiRendererApi['runtime'], 'onEvent'>>,
  Assert<HasPath<MegumiRendererApi, 'approval'>>,
  Assert<HasPath<MegumiRendererApi['approval'], 'resolve'>>,
  Assert<HasPath<MegumiRendererApi, 'settings'>>,
  Assert<HasPath<MegumiRendererApi['settings'], 'get'>>,
  Assert<HasPath<MegumiRendererApi['settings'], 'update'>>,
  Assert<HasPath<MegumiRendererApi, 'project'>>,
  Assert<HasPath<MegumiRendererApi['project'], 'list'>>,
  Assert<HasPath<MegumiRendererApi, 'provider'>>,
  Assert<HasPath<MegumiRendererApi['provider'], 'list'>>,
  Assert<HasPath<MegumiRendererApi, 'workspace'>>,
  Assert<HasPath<MegumiRendererApi['workspace'], 'files'>>,
  Assert<HasPath<MegumiRendererApi['workspace']['files'], 'list'>>,
  Assert<HasPath<MegumiRendererApi, 'recovery'>>,
  Assert<HasPath<MegumiRendererApi['recovery'], 'listRecoverableRuns'>>,
  Assert<IsPromiseResult<ReturnType<MegumiRendererApi['settings']['get']>>>,
];

describe('shared renderer API ownership', () => {
  it('exports the renderer API contract from shared renderer contracts', () => {
    const assertions: ApiSurfaceAssertions = Array.from({ length: 23 }, () => true) as ApiSurfaceAssertions;

    expect(assertions.every(Boolean)).toBe(true);
    expect(IPC_CHANNELS.runtimeInvoke).toBe('megumi:invoke');
  });

  it('exports the renderer IPC result discriminant used by preload methods', () => {
    const success: RendererIpcResult<{ saved: true }> = { ok: true, data: { saved: true } };
    const failure: RendererIpcResult = {
      ok: false,
      error: {
        code: 'renderer_protocol_unavailable',
        message: 'Renderer protocol is unavailable.',
      },
    };

    expect(success.ok).toBe(true);
    expect(failure.ok).toBe(false);
  });
});
