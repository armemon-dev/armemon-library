/**
 * FILE: runCommand.ts
 * PATH: packages/cli-armemon/src/runCommand.ts
 *
 * WHAT: The single place every command's async body is invoked from, so no failure
 *       escapes as an unhandled promise rejection.
 * WHY:  Commander does not catch rejections thrown by an async action handler, and
 *       nothing else caught them either — so every failure reached Node as an
 *       unhandled rejection and printed a raw stack trace full of internal bundle
 *       paths (`at runInitReactNativeFlow (…/chunk-BU42GGKO.js:189:27)`), after
 *       clack had already drawn an intro box that never got closed. The most
 *       predictable case was the most user-hostile: piping stdin produced a bare
 *       ERR_TTY_INIT_FAILED from inside @clack/core.
 *
 *       A command run with --json is being read by a script, so its failures are
 *       JSON too — `{ "ok": false, "error": { message, hint } }` on stdout — and every
 *       status line moves to stderr, where it can't corrupt what the script parses.
 * HOW:  Three outcomes. A CancelledError gets a tidy outro and exit code 130 — the
 *       shell's code for Ctrl-C, so a script can tell "stopped" from "failed". A
 *       CliError is something we anticipated: message plus hint, no stack. Anything
 *       else is a real bug: a short message, the exact command to get the full stack
 *       (ARMEMON_DEBUG=1), and the stack immediately if that's already set. Other
 *       failures exit 1. Exit codes are set via process.exitCode so pending output
 *       flushes.
 * WHEN: Wraps the body of every registered command.
 *
 * EXPORTS: runCommand, RunCommandOptions
 * DEPENDS ON: @clack/prompts, @armemon-library/cli-kit
 * USED BY: packages/cli-armemon/src/commands/*
 */

import * as clack from '@clack/prompts';
import { logger, isCliError, isCancelledError, setLogStream } from '@armemon-library/cli-kit';
import { writeJson } from './jsonOutput.js';

export interface RunCommandOptions {
  /** The command was asked for JSON: failures print as JSON, status lines go to stderr. */
  json?: boolean;
}

export async function runCommand(body: () => Promise<void>, options: RunCommandOptions = {}): Promise<void> {
  if (options.json) setLogStream('stderr');

  try {
    await body();
  } catch (error) {
    process.exitCode = isCancelledError(error) ? 130 : 1;

    if (options.json) {
      const message = isCancelledError(error) ? 'Cancelled.' : error instanceof Error ? error.message : String(error);
      const hint = isCliError(error) ? error.hint : undefined;
      writeJson({ ok: false, error: { message, ...(hint ? { hint } : {}) } });
      if (!isCliError(error) && process.env.ARMEMON_DEBUG === '1' && error instanceof Error && error.stack) {
        console.error(error.stack);
      }
      return;
    }

    if (isCancelledError(error)) {
      clack.cancel('Cancelled.');
      return;
    }

    if (isCliError(error)) {
      logger.error(error.message);
      if (error.hint) logger.info(error.hint);
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);

    if (process.env.ARMEMON_DEBUG === '1') {
      if (error instanceof Error && error.stack) console.error(error.stack);
    } else {
      logger.info('Re-run with ARMEMON_DEBUG=1 to see the full stack trace.');
    }
  }
}
