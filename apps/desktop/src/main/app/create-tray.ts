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
    { label: '打开主窗口', click: options.showMainWindow },
    { label: '显示人物窗口', click: options.showCharacter },
    { label: '隐藏人物窗口', click: options.hideCharacter },
    { type: 'separator' },
    { label: '退出', click: options.quit },
  ]));
  tray.on('double-click', options.showMainWindow);
  return { dispose: () => tray.destroy() };
}
