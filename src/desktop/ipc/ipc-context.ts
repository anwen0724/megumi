// Carries desktop IPC dependencies without exposing owner modules to handlers.
import type { BrowserWindow } from 'electron';
import type { AppApi } from '../../app';
import type { DesktopHostAdapters } from '../composition/create-host-adapters';
import type { LocalDesktopRuntime } from '../composition/create-local-runtime';

export interface DesktopIpcContext {
  appApi: AppApi;
  hosts: DesktopHostAdapters;
  runtime?: LocalDesktopRuntime;
  getMainWindow(): BrowserWindow | undefined;
}
