/*
 * Creates the Desktop tray entry used to reopen the main and Character windows.
 * Explicit tray exit is the only close action that terminates the resident Agent.
 */
import { Menu, Tray } from 'electron';

export interface MegumiTray {
  dispose(): void;
}

export function createMegumiTray(options: {
  readonly iconPath: string;
  readonly showCharacter: () => void;
  readonly showMainWindow: () => void;
  readonly hideCharacter: () => void;
  readonly quit: () => void;
}): MegumiTray {
  const tray = new Tray(options.iconPath);
  tray.setToolTip('Megumi');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 Megumi', click: options.showCharacter },
    { label: '显示主窗口', click: options.showMainWindow },
    { label: '隐藏 Megumi', click: options.hideCharacter },
    { type: 'separator' },
    { label: '退出', click: options.quit },
  ]));
  tray.on('double-click', options.showCharacter);
  return { dispose: () => tray.destroy() };
}
