/**
 * FILE: createComponent.ts
 * PATH: packages/cli-armemon/src/flows/createComponent.ts
 *
 * WHAT: `armemon create-component` and `armemon create-hook` — creates one file, in
 *       the folder you choose, and stops.
 * WHY:  These deliberately do less than every other command. A component is not a
 *       route: there is no registry it belongs to, no managed file that needs to know
 *       about it, and no correct guess about where it should be imported. Wiring it
 *       up automatically would mean deciding that for you, and deciding it wrong is
 *       worse than leaving it — so the only decision made here is which folder, and
 *       that one is asked rather than assumed.
 * HOW:  No managed file is read or written at all. The whole command is: pick a name,
 *       pick a folder, write a file.
 * WHEN: On demand, inside a scaffolded app.
 *
 * EXPORTS: CreateComponentOptions, runCreateComponentFlow
 * DEPENDS ON: node:path, node:fs/promises, @armemon-library/cli-kit, @armemon-library/config-types,
 *             ./screenShared
 * USED BY: packages/cli-armemon/src/commands/createComponent.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import {
  CliError,
  buildComponentFile,
  buildHookFile,
  convertFilesToJavaScript,
  isAutoAcceptEnabled,
  logger,
  normalizeScreenName,
  promptSelect,
  promptText,
  targetFolder,
  validateComponentName,
  validateHookName,
  type ComponentTarget,
} from '@armemon-library/cli-kit';
import { SCREENS_DIR } from '@armemon-library/config-types';
import {
  applyOutputMode,
  emit,
  openApp,
  pathExists,
  type ScreenCommandOptions,
} from './screenShared.js';

export interface CreateComponentOptions extends ScreenCommandOptions {
  name?: string;
  /** Which of the two commands is running. */
  kind: 'component' | 'hook';
  /** Put it in this screen's own folder. */
  screen?: string;
  /** Put it in the shared folder. */
  shared?: boolean;
  force?: boolean;
}

/** The screens this app has, for the "where should it go" question. */
async function screensIn(appRoot: string): Promise<string[]> {
  const entries = await fs
    .readdir(path.join(appRoot, ...SCREENS_DIR.split('/')), { withFileTypes: true })
    .catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('Screen'))
    .map((entry) => entry.name.replace(/Screen$/, ''))
    .sort();
}

export async function runCreateComponentFlow(options: CreateComponentOptions): Promise<void> {
  applyOutputMode(options);

  const { kind } = options;
  const label = kind === 'hook' ? 'hook' : 'component';

  if (options.shared && options.screen !== undefined) {
    throw new CliError(
      '--shared and --screen contradict each other.',
      'Pass one of them, or neither to be asked.',
    );
  }
  if (!options.name && isAutoAcceptEnabled()) {
    throw new CliError(
      `Give the ${label} a name — there is no sensible default to accept.`,
      kind === 'hook' ? 'e.g. armemon create-hook useOrderTotals' : 'e.g. armemon create-component OrderRow',
    );
  }

  const { appRoot, config } = await openApp(options);
  const validate = kind === 'hook' ? validateHookName : validateComponentName;

  const name =
    options.name ??
    (await promptText({
      message: kind === 'hook' ? 'Hook name?' : 'Component name?',
      placeholder: kind === 'hook' ? 'useOrderTotals' : 'OrderRow',
      validate,
    }));

  const problem = validate(name);
  if (problem) throw new CliError(`"${name}" is not a usable ${label} name.`, problem);

  // ---- where it goes ------------------------------------------------------------
  const screens = await screensIn(appRoot);
  let placement: ComponentTarget['placement'];

  if (options.shared) {
    placement = { kind: 'shared' };
  } else if (options.screen !== undefined) {
    const routeName = normalizeScreenName(options.screen).routeName;
    if (!screens.includes(routeName)) {
      throw new CliError(
        `This app has no ${routeName}Screen.`,
        screens.length > 0
          ? `It has: ${screens.join(', ')}. Or pass --shared to put it in ${SCREENS_DIR.replace('screens', 'shared')}/.`
          : 'Create it first with armemon create-screen, or pass --shared.',
      );
    }
    placement = { kind: 'screen', routeName };
  } else {
    // Shared first: it is the answer that is right when you are unsure, because
    // moving one screen's part into shared later is a rename, and pulling a shared
    // one back out is a rename plus finding everyone who used it meanwhile.
    const choice = await promptSelect<string>({
      message: `Where should ${name} go?`,
      options: [
        { value: 'shared', label: 'shared', hint: 'used by more than one screen' },
        ...screens.map((routeName) => ({
          value: routeName,
          label: `${routeName}Screen`,
          hint: 'only this screen uses it',
        })),
      ],
      initialValue: 'shared',
    });
    placement = choice === 'shared' ? { kind: 'shared' } : { kind: 'screen', routeName: choice };
  }

  // ---- the file -----------------------------------------------------------------
  const target: ComponentTarget = { name, placement, language: config.language };
  let files = [kind === 'hook' ? buildHookFile(target) : buildComponentFile(target)];
  if (config.language === 'javascript') files = (await convertFilesToJavaScript(files)).files;

  const file = files[0]!;
  if ((await pathExists(path.join(appRoot, file.path))) && !options.force) {
    throw new CliError(`${file.path} already exists.`, 'Pass --force to replace it, or pick another name.');
  }

  if (options.dryRun) {
    logger.info(`Would create ${file.path}`);
    emit({ ok: true, dryRun: true, name, kind, file: file.path }, options);
    return;
  }

  const full = path.join(appRoot, file.path);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, file.content, 'utf8');

  logger.success(`Created ${file.path}`);
  // Said plainly because it is the one thing that surprises people about these two
  // commands: nothing else changed, on purpose.
  logger.info(`Nothing imports it yet — import it where you need it.`);

  emit(
    {
      ok: true,
      name,
      kind,
      file: file.path,
      folder: targetFolder(placement, kind === 'hook' ? 'hooks' : 'components'),
    },
    options,
  );
}
