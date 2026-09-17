/**
 * FILE: childOutput.ts
 * PATH: packages/cli-kit/src/exec/childOutput.ts
 *
 * WHAT: The stdio a child process should get when its output is meant for the person
 *       at the terminal — React Native's CLI, an install, CocoaPods.
 * WHY:  Those ran with `stdio: 'inherit'`, so their stdout was the CLI's stdout. Under
 *       --json that put React Native's banner and npm's install summary in front of
 *       the JSON, and `armemon init --json | jq` failed on the first line — while every
 *       status line armemon writes itself had already been moved to stderr.
 * HOW:  Follows the logger: when status lines go to stderr, a child's stdout does too.
 *       stdin and stderr are inherited either way, so prompts and errors still reach
 *       the terminal.
 * WHEN: Every execa call whose output a person should see.
 *
 * EXPORTS: childStdio
 * DEPENDS ON: ../logger
 * USED BY: exec/packageManager.ts, exec/rnCli.ts, exec/rnWindowsCli.ts, exec/rnMacosCli.ts,
 *          cli-armemon's init flow, the splash plugin's asset generator
 */

import { getLogStream } from '../logger.js';

export function childStdio(): ['inherit', 'inherit' | 2, 'inherit'] {
  return ['inherit', getLogStream() === 'stderr' ? 2 : 'inherit', 'inherit'];
}
