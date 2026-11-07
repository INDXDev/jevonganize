/** The command table: declares every command, and maps errors to exit codes. */
import { t, withLanguage } from './i18n/index.ts';
import { Command, CommanderError } from 'commander';
import pkg from '../../package.json' with { type: 'json' };
import { loadConfig } from '../core/config.ts';
import { systemLanguage } from '../core/system-language.ts';
import type { Language } from '../types.ts';
import { addAskCommand } from './ask.ts';
import { addCatalogCommands } from './catalog.ts';
import { addFileCommands } from './files.ts';
import { EXIT_USAGE, report, translateHelp } from './help.ts';
import { addRefreshCommand } from './refresh.ts';
import { addReportCommands } from './report.ts';
import { addFolderCommands } from './folders.ts';
import { addSettingsCommands } from './settings.ts';
import { addSetupCommand } from './setup.ts';
import { command, type JsonFlag, out, outJson, withContext } from './shared.ts';

/** The flags of the bare command, which starts the server and the UI. */
interface StartFlags extends JsonFlag {
  port?: number;
  open: boolean;
}

/** Starts the server, prints its address, and stops it on Ctrl-C or a termination signal. */
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

/** `mcp`: serves the tool table to an MCP client over stdio. */
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
  addRefreshCommand(program);
  addCatalogCommands(program);
  addFolderCommands(program);
  addReportCommands(program);
  addSettingsCommands(program);
  addAskCommand(program);
  command(program, 'mcp', t('Run the MCP server over stdio'))
    .option('--allow-apply', t('Let tools that need approval run with no person'))
    .action(mcpCommand);
  translateHelp(program);
  return program;
}

/** Runs the CLI. Sets `process.exitCode`, and exits once stdout has drained. */
export async function run(argv: string[]): Promise<void> {
  await withLanguage(await displayLanguage(argv), () => runProgram(argv));
}

/** The config's language, or English when there is no readable config. */
async function displayLanguage(argv: string[]): Promise<Language> {
  // Nothing in a version line is translated, so it need not read the config.
  const isVersionOnly = argv.length === 1 && (argv[0] === '-V' || argv[0] === '--version');
  if (isVersionOnly) return 'en';
  const config = await loadConfig().catch(() => undefined);
  if (!config) return 'en';
  return config.language === 'system' ? systemLanguage() : config.language;
}

/** Parses `argv` and runs its command, turning any error into a report and an exit code. */
async function runProgram(argv: string[]): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (error) {
    const isCommander = error instanceof CommanderError;
    // `--version` and `--help` end with exit 0. Help shown for a bare command group is a usage error.
    if (isCommander && error.exitCode === 0) return;
    if (isCommander && error.code === 'commander.help') {
      process.exitCode = EXIT_USAGE;
      return;
    }
    report(error, program, argv);
  }
}
