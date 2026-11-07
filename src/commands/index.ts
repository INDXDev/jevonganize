/** The command table: declares every command, and maps errors to exit codes. */
import { t, withLanguage } from './i18n/index.ts';
import { Command, CommanderError } from 'commander';
import pkg from '../../package.json' with { type: 'json' };
import { loadConfig, UserError } from '../core/config.ts';
import { systemLanguage } from '../core/system-language.ts';
import { sanitize } from '../core/sanitize.ts';
import { addAskCommand } from './ask.ts';
import { addCatalogCommands } from './catalog.ts';
import { addFileCommands } from './files.ts';
import { addFolderCommands } from './folders.ts';
import { addSettingsCommands } from './settings.ts';
import { addSetupCommand } from './setup.ts';
import { command, type JsonFlag, note, out, outJson, withContext } from './shared.ts';

const EXIT_USAGE = 2;

interface StartFlags extends JsonFlag {
  port?: number;
  open: boolean;
}

async function startCommand(flags: StartFlags): Promise<void> {
  const { startServer } = await import('../server/start.ts');
  const { url, stop } = await startServer({ port: flags.port, browser: flags.open });
  if (flags.json) outJson({ url });
  else out(url);
  await new Promise<void>((done) => {
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
  await stop();
}

async function mcpCommand(flags: { allowApply?: boolean }): Promise<void> {
  const { serveMcp } = await import('../mcp.ts');
  await withContext(
    {},
    async (ctx) => {
      ctx.approved = flags.allowApply;
      await serveMcp(ctx, pkg.version);
    },
    'mcp',
  );
}

/** The whole command tree. */
export function buildProgram(): Command {
  const program = new Command('jevonganize')
    .description(t('Organize the files you already have'))
    .version(pkg.version, '-V, --version', t('Print the version'))
    .enablePositionalOptions() // so `--port` is not also accepted after a subcommand
    .exitOverride()
    .configureOutput({ outputError: () => {} }) // `run` reports errors, with the hint
    .option('--json', t('Print JSON'))
    .option('--port <n>', t('Use this port'), Number)
    .option('--no-open', t('Do not open a browser'))
    .action(startCommand);
  addSetupCommand(program);
  addFileCommands(program);
  addCatalogCommands(program);
  addFolderCommands(program);
  addSettingsCommands(program);
  addAskCommand(program);
  command(program, 'mcp', t('Run the MCP server over stdio'))
    .option('--allow-apply', t('Let tools that need approval run with no person'))
    .action(mcpCommand);
  const titles = {
    'Usage:': 'Usage:',
    'Options:': 'Options:',
    'Commands:': 'Commands:',
    'Arguments:': 'Arguments:',
    'Global Options:': 'Global Options:',
  } as const;
  const help = {
    styleTitle: (title: string) =>
      Object.hasOwn(titles, title) ? t(titles[title as keyof typeof titles]) : title,
  };
  const configure = (entry: Command) => {
    entry.configureHelp(help);
    entry.helpOption('-h, --help', t('Display help'));
    if (entry.commands.length > 0)
      entry.addHelpCommand('help [command]', t('Display help for command'));
    entry.commands.forEach(configure);
  };
  configure(program);
  return program;
}

/** The words of the command `argv` names, for the hint that ends every error. */
function commandName(program: Command, argv: string[]): string {
  const names = [program.name()];
  let current = program;
  for (const arg of argv) {
    const next = current.commands.find((entry) => entry.name() === arg);
    if (next) {
      names.push(arg);
      current = next;
    } else if (!arg.startsWith('-')) break;
  }
  return names.join(' ');
}

function report(error: unknown, program: Command, argv: string[]): void {
  const known = error instanceof UserError || error instanceof CommanderError;
  const message = error instanceof Error ? error.message : String(error);
  note(message.replace(/^error: /, ''));
  if (!known && process.env.DEBUG && error instanceof Error) note(sanitize(error.stack ?? ''));
  note(t('Run: {command} --help', { command: commandName(program, argv) }));
  process.exitCode = EXIT_USAGE;
}

/** Runs the CLI. Sets `process.exitCode`, and exits once stdout has drained. */
export async function run(argv: string[]): Promise<void> {
  // Nothing in a version line is translated, so it need not read the config.
  const version = argv.length === 1 && (argv[0] === '-V' || argv[0] === '--version');
  const config = version ? undefined : await loadConfig().catch(() => undefined);
  const locale = !config
    ? 'en'
    : config.language === 'system'
      ? await systemLanguage()
      : config.language;
  await withLanguage(locale, () => runProgram(argv));
}

async function runProgram(argv: string[]): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return;
    if (error instanceof CommanderError && error.code === 'commander.help') {
      process.exitCode = EXIT_USAGE;
      return;
    }
    report(error, program, argv);
  }
}
