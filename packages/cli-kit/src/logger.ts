/**
 * FILE: logger.ts
 * PATH: packages/cli-kit/src/logger.ts
 *
 * WHAT: Small chalk-based console logger with a consistent icon+color per message
 *       level, used everywhere the CLI prints status to the terminal.
 * WHY:  Every command and every plugin wizard needs to print status messages in a
 *       visually consistent way; centralizing it here avoids every call site picking
 *       its own colors/icons. Mirrors the logger shape already proven in the
 *       reference CLI (info/success/warn/error/step).
 *
 *       Warnings and errors go to stderr, and a command printing JSON moves the
 *       status lines there too: `armemon create-screen Order --json | jq` used to
 *       feed jq "➡ Checking the app still works…" before the JSON, and fail.
 * HOW:  Thin wrappers over console.log / console.error + chalk. The only state is
 *       which stream status lines use.
 * WHEN: Imported by every command, flow, and wizard that needs to print to the user.
 *
 * EXPORTS: logger, setLogStream, getLogStream, LogStream
 * DEPENDS ON: chalk
 * USED BY: packages/cli-armemon/src/**, packages/cli-kit/src/**, every plugin's wizard
 */

import chalk from 'chalk';

export type LogStream = 'stdout' | 'stderr';

let statusStream: LogStream = 'stdout';

/** Where info, success and step lines go. JSON output needs stdout to itself. */
export function setLogStream(stream: LogStream): void {
  statusStream = stream;
}

export function getLogStream(): LogStream {
  return statusStream;
}

const write = (stream: LogStream, line: string) => (stream === 'stderr' ? console.error(line) : console.log(line));

export const logger = {
  info: (msg: string) => write(statusStream, `${chalk.blue('ℹ')} ${msg}`),
  success: (msg: string) => write(statusStream, `${chalk.green('✔')} ${msg}`),
  step: (msg: string) => write(statusStream, `${chalk.cyan('➡')} ${msg}`),
  warn: (msg: string) => console.error(`${chalk.yellow('⚠')} ${msg}`),
  error: (msg: string) => console.error(`${chalk.red('✖')} ${msg}`),
};
