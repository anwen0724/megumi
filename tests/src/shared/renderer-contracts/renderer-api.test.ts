// Verifies that the window.megumi renderer API is owned by shared renderer contracts.
import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS, type MegumiRendererApi, type RendererIpcResult } from '../../../../src/shared/renderer-contracts';
import type {
  ProjectListData,
  ProviderListData,
  RecoverableRunListData,
  RunEventsListData,
  RunListBySessionData,
  SessionListData,
  SessionTimelineListData,
  SettingsData,
  ToolListData,
  WorkspaceFilesListData,
} from '../../../../src/shared/renderer-contracts';

type Assert<T extends true> = T;
type HasPath<T, K extends PropertyKey> = K extends keyof T ? true : false;
type IsPromiseResult<T> = T extends Promise<RendererIpcResult<unknown>> ? true : false;
type ResultData<T> = T extends (...args: never[]) => Promise<RendererIpcResult<infer TData>> ? TData : never;
type IsUnknown<T> = unknown extends T ? ([T] extends [unknown] ? true : false) : false;
type IsNever<T> = [T] extends [never] ? true : false;
type IsEqual<TActual, TExpected> =
  (<T>() => T extends TActual ? 1 : 2) extends
    (<T>() => T extends TExpected ? 1 : 2)
    ? true
    : false;

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
  Assert<IsEqual<ResultData<MegumiRendererApi['project']['list']>, ProjectListData>>,
  Assert<IsEqual<ResultData<MegumiRendererApi['provider']['list']>, ProviderListData>>,
  Assert<IsEqual<ResultData<MegumiRendererApi['settings']['get']>, SettingsData>>,
  Assert<IsEqual<ResultData<MegumiRendererApi['session']['list']>, SessionListData>>,
  Assert<IsEqual<ResultData<MegumiRendererApi['session']['timeline']['list']>, SessionTimelineListData>>,
  Assert<IsEqual<ResultData<MegumiRendererApi['run']['listBySession']>, RunListBySessionData>>,
  Assert<IsEqual<ResultData<MegumiRendererApi['run']['events']['list']>, RunEventsListData>>,
  Assert<IsEqual<ResultData<MegumiRendererApi['recovery']['listRecoverableRuns']>, RecoverableRunListData>>,
  Assert<IsEqual<ResultData<MegumiRendererApi['workspace']['files']['list']>, WorkspaceFilesListData>>,
  Assert<IsEqual<ResultData<MegumiRendererApi['tool']['list']>, ToolListData>>,
  Assert<IsNever<ResultData<MegumiRendererApi['artifacts']['list']>>>,
  Assert<IsNever<ResultData<MegumiRendererApi['memory']['getSettings']>>>,
  Assert<IsUnknown<ResultData<MegumiRendererApi['project']['list']>> extends false ? true : false>,
  Assert<IsUnknown<ResultData<MegumiRendererApi['settings']['get']>> extends false ? true : false>,
];

describe('shared renderer API ownership', () => {
  it('exports the renderer API contract from shared renderer contracts', () => {
    const assertions: ApiSurfaceAssertions = Array.from({ length: 37 }, () => true) as ApiSurfaceAssertions;

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
