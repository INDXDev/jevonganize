/**
 * Handing a file to the OS: showing it in the file manager, or opening it in its default app. Paths
 * go to `spawn` as single arguments, never through a shell. See docs/security.md.
 */
import { spawn } from 'node:child_process';
import { dirname, extname } from 'node:path';
import { UserError } from '../config.ts';

/** A program and its arguments. */
type Command = [program: string, args: string[]];

/**
 * `explorer` splits an unquoted path at commas, and Node quotes only for spaces, so paths for it are
 * quoted by hand. A Windows name cannot hold a `"`, so nothing can break out. Other OSes ignore this.
 */
const DETACHED = { detached: true, stdio: 'ignore', windowsVerbatimArguments: true } as const;

/** What the OS would run, install or follow rather than read. Add to this, never remove from it. */
const RUNS = new Set(
  `action app appimage applescript application appref-ms appx appxbundle bash bat bin caction cgi chm
  cmd com command cpl csh deb desktop diagcab diagcfg diagpkg dll dmg dylib elf exe fileloc fish
  gadget hlp hta iaddress img inetloc inf ins iso isp its jar jnlp js jse ksh ldb library-ms lnk mcf mpkg
  msc msh msi msix msixbundle msp mst mysqld ocx osax out paf pif pkg pl plugin prefpane prg ps1
  ps1xml ps2 ps2xml psc1 psc2 psd1 psm1 py pyc pyo pyw pyz rb reg rgs rpm run scf scpt scptd scr
  sct search-ms searchconnector-ms service settingcontent-ms sh shb shs shortcut so sys terminal
  tool u3p url vb vbe vbs vbscript vhd vhdx vsix webloc website wflow workflow ws wsc wsf wsh xbap xll xpi
  zsh`.split(/\s+/),
);

/** Types no OS runs. Contents decide this one, for the check on the execute bit. */
const DOCUMENT =
  /^(image|audio|video)\/|pdf$|officedocument|opendocument|msword|ms-(excel|powerpoint)/;

/** Read on every call rather than once at load, so the platform is the one in effect now. */
const isWindows = () => process.platform === 'win32';

/** The command that shows `path` selected in the file manager, or its folder where none can. */
function revealCommand(path: string): Command {
  if (process.platform === 'darwin') return ['open', ['-R', path]];
  if (isWindows()) return ['explorer', [`/select,"${path}"`]];
  return ['xdg-open', [dirname(path)]];
}

/** The command that opens `path` in its default app. */
function openCommand(path: string): Command {
  if (process.platform === 'darwin') return ['open', [path]];
  if (isWindows()) return ['explorer', [`"${path}"`]];
  return ['xdg-open', [path]];
}

/** Shows a file in the file manager, for files `open_file` refuses too. */
export function reveal(path: string): void {
  const [program, args] = revealCommand(path);
  const child = spawn(program, args, DETACHED);
  child.on('error', () => {}); // no file manager to show it in, and nothing for the caller to do
  child.unref();
}

/** The extension the OS would go by. Windows drops trailing dots and spaces, so `a.exe.` is `a.exe`. */
function effectiveExtension(path: string): string {
  return extname(path.replace(/[. ]+$/, ''))
    .slice(1)
    .toLowerCase();
}

/** Whether the OS would read this file, not run it. It chooses by name, so the name decides. */
export function openable(path: string, mode: number, mime: string | null): boolean {
  const extension = effectiveExtension(path);
  // macOS can run such a file in Terminal. exFAT and network drives set the bit on every file, so
  // a real document is let through.
  const hasExecuteBit = (mode & 0o111) !== 0;
  const executable = !isWindows() && hasExecuteBit && !DOCUMENT.test(mime ?? '');
  return extension !== '' && !RUNS.has(extension) && !executable;
}

/** Opens a file in its default app. Only ever from a person's click, see docs/security.md. */
export async function openInDefaultApp(path: string): Promise<void> {
  const [program, args] = openCommand(path);
  const child = spawn(program, args, DETACHED);
  const exitCode = await new Promise<number | null>((resolve) => {
    child.once('error', () => resolve(null));
    child.once('exit', resolve);
  });
  const started = exitCode !== null;
  // `explorer` exits with 1 even when the file opened, so only a failure to start says anything.
  const failed = !started || (exitCode !== 0 && !isWindows());
  if (failed) throw new UserError('No app could open this file');
}
