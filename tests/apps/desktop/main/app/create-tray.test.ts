// @vitest-environment node
import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { createMegumiTray } from '@megumi/desktop/main/app/create-tray';

type TrayMenuItem = { label?: string; type?: string; click?: () => void };
const boundary = vi.hoisted(() => ({
  tray: undefined as EventEmitter | undefined,
  menu: [] as TrayMenuItem[],
}));
vi.mock('electron', () => ({
  Tray: class extends EventEmitter {
    constructor() { super(); boundary.tray = this; }
    setToolTip() {}
    setContextMenu() {}
    destroy() {}
  },
  Menu: { buildFromTemplate: (menu: TrayMenuItem[]) => { boundary.menu = menu; return {}; } },
}));

it('opens the main window on double click and keeps character controls separate in the menu', () => {
  const showMainWindow = vi.fn();
  const showCharacter = vi.fn();
  const hideCharacter = vi.fn();
  const quit = vi.fn();
  const tray = createMegumiTray({ iconPath: 'fixture.ico', showMainWindow, showCharacter, hideCharacter, quit });
  try {
    boundary.tray?.emit('double-click');
    expect(showMainWindow).toHaveBeenCalledOnce();
    expect(showCharacter).not.toHaveBeenCalled();
    expect(boundary.menu.map(item => item.label ?? item.type)).toEqual([
      '打开主窗口', '显示人物窗口', '隐藏人物窗口', 'separator', '退出',
    ]);
    boundary.menu[0].click?.();
    boundary.menu[1].click?.();
    boundary.menu[2].click?.();
    boundary.menu[4].click?.();
    expect(showMainWindow).toHaveBeenCalledTimes(2);
    expect(showCharacter).toHaveBeenCalledOnce();
    expect(hideCharacter).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
  } finally { tray.dispose(); }
});
