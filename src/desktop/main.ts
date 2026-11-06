/** The Electron shell: one window over the local server. No preload and no IPC, on purpose. */
import { join } from 'node:path';
import { app, BrowserWindow, Menu, nativeTheme, shell, utilityProcess } from 'electron';

let win: BrowserWindow | undefined;

function open({ port, token }: { port: number; token: string }): void {
  const origin = `http://127.0.0.1:${port}`;
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    // `--bg`, so the window does not flash before the page paints.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e0f11' : '#f3f4f6',
    // Elsewhere a hidden title bar would also lose the window controls.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, done) =>
    done(false),
  );
  void win.loadURL(`${origin}/auth?t=${token}`);
}

function start(): void {
  // The default menu would take Cmd+W, which the app uses to close a tab.
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]));
  const server = utilityProcess.fork(join(import.meta.dirname, '../server/start.mjs'));
  server.once('message', open);
  server.once('exit', (code) => app.exit(code));
  app.on('before-quit', () => server.kill());
}

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => win?.show());
  app.on('window-all-closed', () => app.quit());
  void app.whenReady().then(start);
} else {
  app.quit();
}
