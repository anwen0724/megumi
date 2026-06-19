// Electron main entrypoint for the src desktop shell.
import type { BrowserWindow } from 'electron';
import { createDesktopAppApi } from './composition/create-app-api';
import { createLocalDesktopRuntime } from './composition/create-local-runtime';
import { registerChatStreamEventForwarder } from './ipc/chat-stream-event-forwarder';
import { registerDesktopIpcHandlers } from './ipc/register-handlers';
import { registerRuntimeEventForwarder } from './ipc/runtime-event-forwarder';
import { createMainWindow } from './window/create-window';
import { registerDesktopLifecycle } from './window/lifecycle';

const runtime = createLocalDesktopRuntime();
const appApi = createDesktopAppApi({ agentRuntime: runtime.agentRuntime });
let mainWindow: BrowserWindow | undefined;
let cleanupHandlers: Array<() => void> = [];

function getMainWindow(): BrowserWindow | undefined {
  return mainWindow;
}

async function bootstrap(): Promise<void> {
  await runtime.start();
  mainWindow = createMainWindow();
  cleanupHandlers = [
    registerDesktopIpcHandlers({ appApi, hosts: runtime.hosts, runtime, getMainWindow }),
    registerChatStreamEventForwarder({ appApi, getMainWindow }),
    registerRuntimeEventForwarder({ appApi, getMainWindow }),
  ];
}

async function cleanup(): Promise<void> {
  for (const cleanupHandler of cleanupHandlers.splice(0).reverse()) cleanupHandler();
  await runtime.stop();
}

registerDesktopLifecycle({
  createWindow() {
    void bootstrap();
  },
  cleanup,
});
