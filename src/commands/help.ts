/** Translated help for every command, and the error report that ends with a pointer to it. */
import { t } from './i18n/index.ts';
import { type Command, CommanderError } from 'commander';
import { UserError } from '../core/config.ts';
import { sanitize } from '../core/sanitize.ts';
import { note } from './shared.ts';

/** Exit status of a usage, config or provider error. */
export const EXIT_USAGE = 2;

/** The section titles commander prints in help, each a message key. */
const HELP_TITLES = ['Usage:', 'Options:', 'Commands:', 'Arguments:', 'Global Options:'] as const;
type HelpTitle = (typeof HELP_TITLES)[number];

const isHelpTitle = (title: string): title is HelpTitle =>
  (HELP_TITLES as readonly string[]).includes(title);

const helpConfig = {
  styleTitle: (title: string) => (isHelpTitle(title) ? t(title) : title),
};

/** Gives a command and every command under it translated help. */
export function translateHelp(entry: Command): void {
  entry.configureHelp(helpConfig);
  entry.helpOption('-h, --help', t('Display help'));
  if (entry.commands.length > 0)
    entry.addHelpCommand('help [command]', t('Display help for command'));
  entry.commands.forEach(translateHelp);
}

/** The words of the command `argv` names, for the hint that ends every error. */
function commandName(program: Command, argv: string[]): string {
  const names = [program.name()];
  let current = program;
  for (const arg of argv) {
    const subcommand = current.commands.find((entry) => entry.name() === arg);
    if (subcommand) {
      names.push(arg);
      current = subcommand;
      continue;
    }
    // Options may sit between command words. Any other word is an argument, and ends the name.
    if (!arg.startsWith('-')) break;
  }
  return names.join(' ');
}

/** Prints an error with a hint, and sets exit 2. A bug's stack is printed only under `DEBUG`. */
export function report(error: unknown, program: Command, argv: string[]): void {
  const isExpected = error instanceof UserError || error instanceof CommanderError;
  const message = error instanceof Error ? error.message : String(error);
  note(message.replace(/^error: /, ''));
  const showStack = !isExpected && process.env.DEBUG && error instanceof Error;
  if (showStack) note(sanitize(error.stack ?? ''));
  note(t('Run: {command} --help', { command: commandName(program, argv) }));
  process.exitCode = EXIT_USAGE;
}
