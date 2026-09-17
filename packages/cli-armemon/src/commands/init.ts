/**
 * FILE: init.ts
 * PATH: packages/cli-armemon/src/commands/init.ts
 *
 * WHAT: Registers the `armemon init <target>` commander subcommand and its flags.
 * WHY:  Keeping the target check here (not in the flow) leaves room for
 *       `armemon init expo` later without redesigning the flow layer. The flags
 *       beyond --all-accept exist because --all-accept was previously the ONLY
 *       non-interactive option: accept literally everything, or answer everything by
 *       hand. Automating any specific configuration — which is what a CI matrix
 *       needs — was impossible.
 * HOW:  A commander factory wiring argument/option parsing to
 *       runInitReactNativeFlow(), through the shared runCommand() error handler. The
 *       RN version flag is --rn-version, not --version: commander's root -V/--version
 *       is eager and intercepts any `--version` anywhere in argv before subcommand
 *       parsing, so a same-named subcommand option is silently shadowed.
 * WHEN: Registered once when the program is built in src/index.ts.
 *
 * EXPORTS: registerInitCommand
 * DEPENDS ON: commander, ../runCommand, ../flows/initReactNative
 * USED BY: packages/cli-armemon/src/index.ts
 */

import { Command } from 'commander';
import { logger } from '@armemon-library/cli-kit';
import { runCommand } from '../runCommand.js';
import { buildCommandReference } from '../commandReference.js';
import { runInitReactNativeFlow } from '../flows/initReactNative.js';

export function registerInitCommand(program: Command): void {
  const init = program.command('init').description('Scaffold a new app');

  init
    .command('react-native')
    .argument('[appName]', 'App name — letters and numbers, starting with a letter')
    .description('Scaffold a new React Native app')
    .option('--rn-version <version>', 'React Native version (e.g. 0.76.0, or "latest")')
    .option('--pm <manager>', 'Package manager: npm, yarn, pnpm or bun')
    .option('--language <lang>', 'ts | js (React Native ships no JS template; armemon converts)')
    .option('--logo <path>', 'Splash logo image, relative to where you run this')
    .option('--platforms <list>', 'Comma-separated: ios,android,web,windows,macos')
    .option('--plugins <list>', 'Comma-separated plugin ids or package names (empty string for none)')
    .option(
      '--all-accept',
      "Skip every prompt: every platform, every recommended plugin, and each question's own default",
    )
    .option('--dry-run', 'Print the resolved configuration and exit without writing anything')
    .option(
      '--no-verify',
      "Skip armemon's own checks on the finished app (they run by default)",
    )
    // Accepted as well as --no-verify, because "run the checks" is the spelling
    // people reach for in a CI script even though it is already the default, and
    // commander answers an undeclared --verify with an error rather than a shrug.
    .option('--verify', 'Run those checks (the default; accepted for explicitness)')
    .option('--json', 'Print only a JSON summary on stdout (implies --all-accept)')
    .action(
      async (
        appName: string | undefined,
        cmdOptions: {
          rnVersion?: string;
          pm?: string;
          language?: string;
          logo?: string;
          platforms?: string;
          plugins?: string;
          allAccept?: boolean;
          dryRun?: boolean;
          verify?: boolean;
          json?: boolean;
        },
      ) => {
        await runCommand(() =>
          runInitReactNativeFlow({
            appName,
            version: cmdOptions.rnVersion,
            packageManager: cmdOptions.pm,
            language: cmdOptions.language,
            logo: cmdOptions.logo,
            platforms: cmdOptions.platforms,
            plugins: cmdOptions.plugins,
            allAccept: cmdOptions.allAccept,
            dryRun: cmdOptions.dryRun,
            // commander maps --no-verify to verify:false
            noVerify: cmdOptions.verify === false,
            json: cmdOptions.json,
            // Built from the root program, which this closure already has — so the
            // guide in the new app lists exactly the commands this CLI registers,
            // without the flow layer importing the program it belongs to.
            commandReference: buildCommandReference(program),
            cwd: process.cwd(),
          }),
          { json: cmdOptions.json },
        );
      },
    );

  init.action(() => {
    logger.error('Only "armemon init react-native" is supported today.');
    process.exitCode = 1;
  });
}
