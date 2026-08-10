import { ipcMain, Menu, BrowserWindow, clipboard, shell } from 'electron';

type WindowGetter = () => BrowserWindow | null;

interface ContextMenuOptions {
  isEditable?: boolean;
  hasSelection?: boolean;
  selectionText?: string;
  linkHref?: string;
  linkText?: string;
  pageUrl?: string;
}

export function registerContextMenuHandler(getWindow: WindowGetter): void {
  ipcMain.on('app:contextMenu', (event, opts: ContextMenuOptions = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? getWindow();
    if (!win) return;

    const items: Electron.MenuItemConstructorOptions[] = [];

    if (opts.linkHref) {
      items.push(
        {
          label: 'Open Link in New Tab',
          click: () => event.sender.send('app:openInNewTab', opts.linkHref!),
        },
        {
          label: 'Open Link in Browser',
          click: () => shell.openExternal(opts.linkHref!),
        },
        {
          label: 'Copy Link',
          click: () => clipboard.writeText(opts.linkHref!),
        },
        { type: 'separator' }
      );
    }

    if (opts.isEditable) {
      items.push(
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      );
    } else if (opts.hasSelection) {
      items.push({ role: 'copy' }, { role: 'selectAll' });
    } else {
      items.push({ role: 'reload' }, { role: 'toggleDevTools' });
    }

    if (items.length === 0) return;

    const menu = Menu.buildFromTemplate(items);
    menu.popup({ window: win });
  });
}
