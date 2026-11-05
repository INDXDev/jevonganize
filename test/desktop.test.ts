import type { EventEmitter } from 'node:events';
import { beforeAll, describe, expect, it, vi } from 'vitest';

type OpenHandler = (details: { url: string }) => { action: string };
type NavigateHandler = (event: { preventDefault(): void }, url: string) => void;
type PermissionHandler = (
  contents: unknown,
  permission: string,
  done: (allowed: boolean) => void,
) => void;

const shell = vi.hoisted(() => ({
  webPreferences: undefined as unknown,
  onOpen: undefined as OpenHandler | undefined,
  onNavigate: undefined as NavigateHandler | undefined,
  onPermission: undefined as PermissionHandler | undefined,
  loaded: [] as string[],
  forked: [] as string[],
  server: undefined as EventEmitter | undefined,
  openExternal: vi.fn<(url: string) => void>(),
  exit: vi.fn<(code: number) => void>(),
}));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  const webContents = {
    setWindowOpenHandler: (handler: OpenHandler) => (shell.onOpen = handler),
    on: (_event: 'will-navigate', handler: NavigateHandler) => (shell.onNavigate = handler),
    session: {
      setPermissionRequestHandler: (handler: PermissionHandler) => (shell.onPermission = handler),
    },
  };
  class BrowserWindow {
    webContents = webContents;
    constructor(options: { webPreferences: unknown }) {
      shell.webPreferences = options.webPreferences;
    }
    loadURL(url: string) {
      shell.loaded.push(url);
      return Promise.resolve();
    }
  }
  return {
    app: Object.assign(new EventEmitter(), {
      requestSingleInstanceLock: () => true,
      whenReady: () => Promise.resolve(),
      exit: shell.exit,
    }),
    BrowserWindow,
    Menu: { buildFromTemplate: () => undefined, setApplicationMenu: () => undefined },
    shell: { openExternal: shell.openExternal },
    utilityProcess: {
      fork(path: string) {
        shell.forked.push(path);
        shell.server = new EventEmitter();
        return shell.server;
      },
    },
  };
});

function blocked(url: string): boolean {
  const preventDefault = vi.fn<() => void>();
  shell.onNavigate?.({ preventDefault }, url);
  return preventDefault.mock.calls.length > 0;
}

describe('desktop shell', () => {
  beforeAll(async () => {
    await import('../src/desktop/main.ts');
    await vi.waitUntil(() => shell.server);
    shell.server?.emit('message', { port: 48620, token: 'abc' });
  });

  it('forks the server and loads the auth URL it reports', () => {
    expect(shell.forked[0]?.replaceAll('\\', '/')).toMatch(/\/server\/start\.mjs$/);
    expect(shell.loaded).toEqual(['http://127.0.0.1:48620/auth?t=abc']);
  });

  it('opens a sandboxed window with no preload', () => {
    expect(shell.webPreferences).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    });
  });

  it('denies every new window, and sends only https links to the system browser', () => {
    expect(shell.onOpen?.({ url: 'https://example.com/' })).toEqual({ action: 'deny' });
    expect(shell.onOpen?.({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' });
    expect(shell.openExternal.mock.calls).toEqual([['https://example.com/']]);
  });

  it('blocks navigation away from the server, including other local ports', () => {
    expect(blocked('http://127.0.0.1:48620/settings')).toBe(false);
    expect(blocked('http://127.0.0.1:9999/')).toBe(true);
    expect(blocked('https://example.com/')).toBe(true);
  });

  it('denies every permission request', () => {
    const done = vi.fn<(allowed: boolean) => void>();
    shell.onPermission?.(undefined, 'media', done);
    expect(done).toHaveBeenCalledWith(false);
  });

  it('exits when the server exits', () => {
    shell.server?.emit('exit', 3);
    expect(shell.exit).toHaveBeenCalledWith(3);
  });
});
