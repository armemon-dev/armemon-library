/**
 * FILE: addPlugin.ts
 * PATH: packages/cli-armemon/src/flows/plugins/addPlugin.ts
 *
 * WHAT: `armemon plugin add <id>` — adds a plugin to an app that already exists, doing
 *       everything `init` would have done for it.
 * WHY:  Plugins used to be a choice made once, at init. Adding Redux later meant
 *       editing package.json, runtime.generated, babel.config.js, index.js, jest.setup.js,
 *       web/index.html and the Vite config by hand, in the right order, and hoping.
 *       The result should be the app you would have had by choosing it at init.
 * HOW:  Checks the plugin can go in at all (R7), asks the plugin's own questions, then
 *       composes the app with and without it and reconciles the two — so the plugin's
 *       output reaches the app through exactly the path init uses — and carries the
 *       change out as one transaction.
 * WHEN: On demand, inside a scaffolded app.
 *
 * EXPORTS: runAddPluginFlow, AddPluginOptions
 * DEPENDS ON: node:path, node:fs/promises, @armemon-library/cli-kit, ../screenShared,
 *             ./appState, ./choose, ./compose, ./reconcile, ./transaction
 * USED BY: packages/cli-armemon/src/commands/plugin.ts
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { CliError, logger } from '@armemon-library/cli-kit';
import { applyOutputMode, emit } from '../screenShared.js';
import { CLI_DIR, loadWizard, pluginContext, readAppState, replayPlans } from './appState.js';
import { assertCompatible, choosePlugin } from './choose.js';
import { compose, isFirstParty } from './compose.js';
import { reconcile } from './reconcile.js';
import { carryOut, type PluginRunOptions } from './transaction.js';

export interface AddPluginOptions extends PluginRunOptions {
  /** Plugin id or package name. */
  plugin?: string;
  /** A logo for plugins that ask for one — the splash screen — relative to where you run this. */
  logo?: string;
  /**
   * The plugin's answers, given rather than asked — for a script that already knows
   * them, as armemon.config records them. Nothing is asked when these are set.
   */
  answers?: Record<string, unknown>;
}

export async function runAddPluginFlow(options: AddPluginOptions): Promise<void> {
  applyOutputMode(options);
  const state = await readAppState(options);
  const chosen = await choosePlugin(state, options.plugin, 'add');
  if (typeof chosen === 'string') throw new CliError(`"${chosen}" isn't a plugin armemon can find.`);
  const plugin = chosen;
  const pluginId = plugin.manifest.pluginId;

  if (pluginId in state.config.plugins) {
    if (options.json) {
      emit({ ok: true, action: 'add', plugin: pluginId, alreadyInstalled: true }, options);
      return;
    }
    logger.info(
      `${plugin.manifest.displayName} is already in this app.${
        plugin.manifest.settings ? ` Change its settings with "armemon set ${pluginId}.<option> <value>".` : ''
      }`,
    );
    return;
  }

  await assertCompatible(state, plugin);

  if (options.logo) {
    const logo = path.resolve(options.cwd, options.logo);
    if (!(await fs.access(logo).then(() => true, () => false))) {
      throw new CliError(`Couldn't find the logo "${options.logo}".`, `Looked in ${options.cwd}. Nothing was changed.`);
    }
  }

  const current = await replayPlans(state, state.config.plugins);
  for (const id of current.missing) {
    logger.warn(`armemon.config lists "${id}", but its package isn't installed here — its files are treated as the app's own.`);
  }
  const before = await compose(state, current.plans);

  // The plugin's own questions, with everything the app's other plugins answered.
  const resolveFrom = isFirstParty(plugin.packageName) ? [CLI_DIR, state.appRoot] : [state.appRoot, CLI_DIR];
  const wizard = await loadWizard(plugin, resolveFrom);
  const ctx = pluginContext(state, { ...state.config.plugins }, { logo: options.logo });
  if (!options.json && !options.answers) logger.step(wizard.intro);
  const answers = options.answers ?? ((await wizard.run(ctx)) as Record<string, unknown>);
  const plan = await wizard.plan(answers, ctx);

  const next = await replayPlans(
    state,
    { ...state.config.plugins, [pluginId]: answers },
    {
      resolveFor: (entry) => (entry.manifest.pluginId === pluginId ? resolveFrom : [state.appRoot, CLI_DIR]),
      planned: { pluginId, plan },
    },
  );
  const after = await compose(state, next.plans);

  const target = { pluginId, plugin, plan, action: 'add' as const };
  const rec = await reconcile({ state, before, after, target, commandReference: options.commandReference });
  await carryOut({ state, rec, target, options });
}
