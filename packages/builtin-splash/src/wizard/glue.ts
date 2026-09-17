/**
 * FILE: glue.ts
 * PATH: packages/builtin-splash/src/wizard/glue.ts
 *
 * WHAT: The generated armemon/splash/index.ts — the app-local file that binds
 *       the platform-specific hide function to the plugin.
 * WHY:  Kept out of generate.ts only to keep that file readable; the reason it
 *       exists at all is that `./hide` is extensionless, so Metro resolves it to
 *       hide.ts and Vite to hide.web.ts. That one indirection is what lets a single
 *       splash definition serve native and web from the same app.
 * HOW:  A fixed three-line template.
 * WHEN: Included in planSplash's filesToWrite.
 *
 * EXPORTS: splashGlueSource
 * DEPENDS ON: @armemon-library/config-types
 */

import { EXAMPLES_DIR, managedFile, specifierFor, type AppLayout } from '@armemon-library/config-types';

/**
 * Takes the layout because the StartupSplash it names lives in the author's zone
 * while this file lives in the managed one: the hop between them is two levels from
 * `src/armemon/splash/` and three from `armemon/splash/`, so it has to be computed.
 */
export function splashGlueSource(layout: AppLayout): string {
  const startupSplash = specifierFor(
    managedFile.splashGlue(layout),
    `${EXAMPLES_DIR}/StartupSplash.tsx`,
  );
  return `import { configureSplashPlugin } from '@armemon-library/splash';
// Extensionless on purpose: Metro resolves ./hide to hide.ts (native), Vite to
// hide.web.ts (web). One splash, one config, the right mechanism per bundle.
import { hideSplash } from './hide';

/**
 * Glue file: builds the plugin object armemon.config registers.
 *
 * WHAT EACH FILE DOES
 *   splash.config.ts   the one definition — colour, logo, minimum duration
 *   hide.ts            takes the NATIVE splash down (react-native-bootsplash)
 *   hide.web.ts        takes the WEB splash down (removes the element from
 *                      web/index.html); Vite picks this file, Metro picks hide.ts
 *
 *   ${startupSplash}   what's on screen while init tasks run.
 *                      armemon's default — replace it with one of your own screens
 *                      via runtimeOverrides.SplashScreenComponent in ../runtime.config.
 *
 * configureSplashPlugin() takes one option:
 *
 *   hide   () => void | Promise<void> — called once, after init tasks finish and
 *          the minimum duration has elapsed. Swap in your own to do something else
 *          (fade a custom overlay, run an animation, wait on a video):
 *
 *            configureSplashPlugin({
 *              hide: async () => {
 *                await fadeOutOverlay();
 *                await hideSplash();
 *              },
 *            });
 *
 *          It must not throw out: nothing was shown in a debug build without the
 *          native wiring, or after a hot reload, and that is normal. The supplied
 *          hideSplash already swallows that case.
 *
 * To hold the splash open past task completion — waiting on a login check, say —
 * set readyCustom in ../runtime.config and call notifyReady() when you're done.
 */
export const SplashPlugin = configureSplashPlugin({ hide: hideSplash });
`;
}
