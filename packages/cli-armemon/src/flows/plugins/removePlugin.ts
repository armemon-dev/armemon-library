/**
 * FILE: removePlugin.ts
 * PATH: packages/cli-armemon/src/flows/plugins/removePlugin.ts
 *
 * WHAT: `armemon plugin remove <id>` — takes a plugin back out of an app: its files, its
 *       packages, and everything it wired into files the app shares.
 * WHY:  Removing is where a tool does damage. A plugin's settings file may hold hours
 *       of someone's choices; a package it brought may be imported by code written
 *       since; a Babel entry may be the only reason `@/` imports resolve. So removal
 *       deletes only what is still exactly as armemon wrote it, never while app code
 *       still uses what goes, and says what it leaves behind.
 * HOW:  Composes the app with and without the plugin from the same recorded answers and
 *       reconciles the two — which is also where the import scan (R4) and the
 *       dependency checks (R5) run — then carries the change out as one transaction.
 * WHEN: On demand, inside a scaffolded app.
 *
 * EXPORTS: runRemovePluginFlow, RemovePluginOptions
 * DEPENDS ON: @armemon-library/cli-kit, ../screenShared, ./appState, ./choose, ./compose,
 *             ./reconcile, ./transaction
 * USED BY: packages/cli-armemon/src/commands/plugin.ts
 */

import { CliError, logger } from '@armemon-library/cli-kit';
import { applyOutputMode, emit } from '../screenShared.js';
import { readAppState, replayPlans } from './appState.js';
import { choosePlugin } from './choose.js';
import { compose } from './compose.js';
import { reconcile } from './reconcile.js';
import { carryOut, type PluginRunOptions } from './transaction.js';

export interface RemovePluginOptions extends PluginRunOptions {
  /** Plugin id or package name. */
  plugin?: string;
}

export async function runRemovePluginFlow(options: RemovePluginOptions): Promise<void> {
  applyOutputMode(options);
  const state = await readAppState(options);
  const chosen = await choosePlugin(state, options.plugin, 'remove');
  const pluginId = typeof chosen === 'string' ? chosen : chosen.manifest.pluginId;

  if (!(pluginId in state.config.plugins)) {
    if (options.json) {
      emit({ ok: true, action: 'remove', plugin: pluginId, notInstalled: true }, options);
      return;
    }
    logger.info(`"${pluginId}" isn't in this app — nothing to remove.`);
    return;
  }
  if (typeof chosen === 'string') {
    throw new CliError(
      `Can't find the ${pluginId} plugin's package, so armemon can't tell what it added to this app.`,
      `Install the app's packages first ("${state.packageManager} install"), then run this again.`,
    );
  }
  const plugin = chosen;

  const current = await replayPlans(state, state.config.plugins);
  for (const id of current.missing) {
    logger.warn(`armemon.config lists "${id}", but its package isn't installed here — its files are treated as the app's own.`);
  }
  const own = current.plans.find((entry) => entry.pluginId === pluginId);
  if (!own) throw new CliError(`Couldn't work out what the ${pluginId} plugin added to this app.`);

  const remaining = { ...state.config.plugins };
  delete remaining[pluginId];
  const next = await replayPlans(state, remaining);

  const before = await compose(state, current.plans);
  const after = await compose(state, next.plans);

  const target = { pluginId, plugin, plan: own.plan, action: 'remove' as const };
  const rec = await reconcile({ state, before, after, target, commandReference: options.commandReference });

  await carryOut({ state, rec, target, options });
}
