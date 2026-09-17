/**
 * FILE: generate.ts
 * PATH: packages/builtin-splash/src/wizard/generate.ts
 *
 * WHAT: Turns SplashAnswers into one splash definition rendered three ways —
 *       native cold-start assets, pre-paint web markup, and an in-app screen — all
 *       from a single background colour and logo.
 * WHY:  "Splash screen" is three different mechanisms wearing one name, and a user
 *       who picks a colour and a logo means all of them:
 *         - iOS/Android draw a real cold-start splash from generated assets, before
 *           any JavaScript exists.
 *         - Web has no such thing, so the equivalent is markup in index.html that
 *           paints immediately and is removed when React mounts.
 *         - Windows, macOS and every platform during init get core's splash screen.
 *       Generating all three from one `splash.config` is what makes them match. The
 *       config file used to be written and read by nothing at all; it is now the
 *       single source the other three read.
 * HOW:  The native/web split is resolved per-BUNDLE, not per-app, because one app
 *       can be both: `hide.ts` imports react-native-bootsplash, `hide.web.ts`
 *       removes the DOM node, and Metro and Vite each pick the right file. That
 *       keeps bootsplash — which calls TurboModuleRegistry.getEnforcing at import
 *       time and has no web build — out of the web bundle entirely.
 *
 *       Native wiring (AppDelegate/MainActivity) stays manual: it varies by RN
 *       version, Obj-C vs Swift and architecture in ways that are unsafe to patch
 *       blind, and corrupting a native project is worse than printing two lines.
 * WHEN: Called once by the wizard's plan() step.
 *
 * EXPORTS: planSplash
 * DEPENDS ON: execa, @armemon-library/config-types, ./questions
 */

import path from 'node:path';
import { execa } from 'execa';
import { childStdio } from '@armemon-library/cli-kit';
import {
  EXAMPLES_DIR,
  layoutOf,
  managedFile,
  specifierFor,
  type PluginInstallPlan,
  type WizardContext,
} from '@armemon-library/config-types';
import type { SplashAnswers } from './questions.js';
import { splashGlueSource } from './glue.js';

function nativePlatforms(ctx: WizardContext): string[] {
  return ctx.platforms.filter((platform) => platform === 'ios' || platform === 'android');
}

/** Escapes a value for embedding in an HTML attribute. */
function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export async function planSplash(
  answers: SplashAnswers,
  ctx: WizardContext,
): Promise<PluginInstallPlan> {
  const npmDependencies: Record<string, string> = {};
  const filesToWrite: PluginInstallPlan['filesToWrite'] = [];
  const filesToCopy: NonNullable<PluginInstallPlan['filesToCopy']> = [];
  const postInstallNotes: string[] = [];

  const layout = layoutOf(ctx);
  const startupSplashPath = `${EXAMPLES_DIR}/StartupSplash.tsx`;
  const runtimeConfigPath = managedFile.runtimeConfig(layout, ctx.language);

  const native = nativePlatforms(ctx);
  // The logo is stored absolute (it may have come from outside the app). Copy it in
  // first, then refer to that in-app copy everywhere — bootsplash runs with cwd at
  // the app root, and Vite only serves what's under web/public.
  const logoName = answers.logoPath ? path.basename(answers.logoPath) : null;
  const inAppLogo = logoName ? `assets/${logoName}` : null;
  if (answers.logoPath && inAppLogo) {
    filesToCopy.push({ from: answers.logoPath, to: inAppLogo });
  }
  const hasWeb = ctx.platforms.includes('web');
  const background = answers.backgroundColor;

  // ---- the single source every rendering reads -------------------------------
  filesToWrite.push({
    path: managedFile.splashConfig(layout),
    content: `/**
 * The one splash definition — every platform reads these values.
 *
 *   iOS / Android  the OS draws a real cold-start splash from generated assets,
 *                  before any JavaScript exists
 *   Web            web/index.html paints markup on the first frame, removed once
 *                  React mounts
 *   Everywhere     ./SplashScreen is shown while init tasks run, including on
 *                  Windows and macOS where there is no native splash
 *
 * Changing backgroundColor or the logo means regenerating the native assets —
 * the exact command for this app:
 *
 *   npx react-native-bootsplash generate ${inAppLogo ?? '<your-logo.png>'} --platforms=${native.length > 0 ? native.join(',') : 'ios,android'} --background=${background}
 *
 * The web splash updates on its own, since it reads from web/index.html — edit the
 * #armemon-splash rule there to restyle it.
 */
export const splashConfig = {
  // Background behind the logo. Native assets are generated against this, so
  // changing it here alone leaves the native splash on the old colour until you
  // re-run the generate command above.
  backgroundColor: '${background}',

  // Where the logo lives in THIS app, relative to the project root. armemon copied
  // it here from wherever you pointed --logo at${hasWeb ? ', and to web/public/ for the web splash' : ''}.
  // Not read at runtime: the native splash reads generated assets and the web splash
  // reads web/index.html. It's here so the regenerate command above has a path, and
  // so you can find the source image again.
  //
  // Replacing the logo: drop a new file in, point this at it, re-run that command.
  logoPath: ${inAppLogo ? `'${inAppLogo}'` : 'null'},

  // How long the splash stays up at minimum, in ms, even when startup is instant.
  //   0     hide as soon as init finishes — no artificial delay
  //   800   enough to avoid a jarring flash on a fast device
  //   3000  a deliberate brand moment
  //
  // This is a FLOOR, not a fixed duration: slow startup takes as long as it takes.
  // armemon passes it to @armemon-library/core; see ${managedFile.runtimeGenerated(layout, ctx.language)}.
  minSplashDurationMs: ${answers.minSplashDurationMs},
};
`,
  });

  // ---- the in-app screen, shown on every platform while init runs -------------
  filesToWrite.push({
    path: startupSplashPath,
    content: `import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useTaskProgress } from '@armemon-library/core';
import { splashConfig } from '${specifierFor(startupSplashPath, managedFile.splashConfig(layout))}';

/**
 * Shown by KitProvider while init tasks run — on every platform, including the ones
 * with no native splash of their own (Windows, macOS, and web after the first
 * frame). Colours come from ${managedFile.splashConfig(layout)} so all three splashes
 * match.
 *
 * THIS IS ARMEMON'S DEFAULT, not your app. Edit it freely, or replace it outright
 * with one of your own screens — one line in ${runtimeConfigPath}:
 *
 *   import MySplash from '../screens/MySplashScreen';
 *   export const runtimeOverrides = { SplashScreenComponent: MySplash };
 *
 * Then delete this file. The three ways it usually grows are written out below —
 * uncomment what you want.
 *
 * WHAT useTaskProgress() GIVES YOU
 *   currentTask     name of the task running right now, or null
 *   currentPlugin   which plugin it belongs to, or null for your own tasks
 *   completedTasks  how many have finished
 *   totalTasks      how many there are in total
 *
 * 1. SHOW WHAT IS HAPPENING
 *      import { Text } from 'react-native';
 *      {currentTask ? <Text style={styles.label}>{currentTask}</Text> : null}
 *
 * 2. SHOW A PROGRESS BAR
 *      const pct = totalTasks > 0 ? completedTasks / totalTasks : 0;
 *      <View style={styles.track}>
 *        <View style={[styles.fill, { flex: pct }]} />
 *      </View>
 *
 * 3. SHOW YOUR LOGO${logoName ? ` (armemon copied it to ${inAppLogo})` : ''}
 *      import { Image } from 'react-native';
 *      <Image
 *        source={require('../../${inAppLogo ?? 'assets/logo.png'}')}
 *        style={{ width: 120, height: 120, resizeMode: 'contain' }}
 *      />
 *
 * The progress values below come from useTaskProgress(), which works in any
 * component rendered during startup.
 */
export default function StartupSplash() {
  const { currentTask, completedTasks, totalTasks } = useTaskProgress();
  // Referenced so the values are live in the debugger and in the examples above;
  // nothing is rendered from them until you uncomment one.
  void currentTask;
  void completedTasks;
  void totalTasks;

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: splashConfig.backgroundColor,
  },
  // Used by the commented examples above.
  label: { marginTop: 12, fontSize: 13, opacity: 0.7 },
  track: { height: 3, width: 160, marginTop: 16, flexDirection: 'row', backgroundColor: '#00000014' },
  fill: { backgroundColor: '#00000055' },
});
`,
  });

  filesToWrite.push({ path: managedFile.splashGlue(layout), content: splashGlueSource(layout) });

  // ---- taking it down: one call, two implementations --------------------------
  if (native.length > 0) {
    npmDependencies['react-native-bootsplash'] = answers.dependencyVersions['react-native-bootsplash'] ?? 'latest';
  }

  filesToWrite.push({
    path: managedFile.splashHide(layout),
    content:
      native.length > 0
        ? `import BootSplash from 'react-native-bootsplash';

/**
 * Native: hide the OS-drawn cold-start splash. Rejects when none was shown (a debug
 * build without the native wiring, or a hot reload), which is normal — the caller
 * swallows it.
 */
export function hideSplash(): Promise<void> {
  return BootSplash.hide({ fade: true });
}
`
        : `/** No native platform is targeted, so there is no native splash to hide. */
export function hideSplash(): void {}
`,
  });

  // The web splash is markup in index.html, because anything React renders is by
  // definition too late — it appears only after the bundle has loaded and run,
  // which is exactly the gap a splash covers.
  let htmlContributions: PluginInstallPlan['htmlContributions'];
  if (hasWeb) {
    filesToWrite.push({
      path: managedFile.splashHideWeb(layout),
      content: `/**
 * Web: remove the static splash that web/index.html painted before the bundle
 * loaded.
 *
 * Metro never resolves this file (\`.web\` isn't one of its platforms) and Vite
 * always prefers it, so react-native-bootsplash — which has no web build and calls
 * TurboModuleRegistry.getEnforcing at import time — stays out of the web bundle.
 */

// React Native's tsconfig has no DOM lib, so these are otherwise unresolved names
// (TS2584). Declared locally rather than widening lib for the native code too.
declare const document: {
  getElementById(id: string): { style: { opacity: string }; remove(): void } | null;
};
declare const window: { setTimeout(handler: () => void, timeout: number): number };

export function hideSplash(): void {
  const element = document.getElementById('armemon-splash');
  if (!element) return;
  element.style.opacity = '0';
  window.setTimeout(() => element.remove(), 220);
}
`,
    });

    const logoMarkup = logoName
      ? `<img id="armemon-splash-logo" src="/${attr(logoName)}" alt="" />`
      : '';

    if (answers.logoPath && logoName) {
      filesToCopy.push({ from: answers.logoPath, to: `web/public/${logoName}` });
    }

    htmlContributions = {
      head: [
        `<style>
      /* armemon splash — painted before the JS bundle parses, removed on mount. */
      #armemon-splash {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: ${background};
        z-index: 2147483647;
        transition: opacity 200ms ease-out;
      }
      #armemon-splash-logo { max-width: 40%; max-height: 40%; }
    </style>`,
      ],
      bodyStart: [`<div id="armemon-splash">${logoMarkup}</div>`],
    };
  }

  return {
    npmDependencies,
    filesToWrite,
    filesToCopy: filesToCopy.length > 0 ? filesToCopy : undefined,
    htmlContributions,
    // The answer holds an absolute path to wherever the user's logo lived; the app
    // holds a copy at assets/. Record the copy, so armemon.config describes this
    // app rather than the machine that scaffolded it.
    recordedAnswers: inAppLogo ? { ...answers, logoPath: inAppLogo } : undefined,
    runtimeConfigContributions: {
      minSplashDurationMs:
        answers.minSplashDurationMs > 0 ? answers.minSplashDurationMs : undefined,
      splashScreenComponent: {
        importName: 'default',
        from: specifierFor(managedFile.runtimeGenerated(layout, ctx.language), startupSplashPath),
      },
    },
    appEntryContributions: {
      providerImport: { importName: 'SplashPlugin', from: './splash/index' },
      registerInRuntimeConfig: true,
    },
    postInstallSteps: buildNativeSteps(answers, native, postInstallNotes, inAppLogo),
    postInstallNotes,
    // What `react-native-bootsplash generate` and the RNBootSplash.init step leave in the
    // native projects. While any of it is there, the native build needs the package.
    nativeReferences:
      native.length > 0
        ? ['Theme.BootSplash', 'BootSplash.storyboard', 'RNBootSplash'].map((marker) => ({
            marker,
            package: 'react-native-bootsplash',
          }))
        : undefined,
    removalNotes:
      native.length > 0
        ? [
            "The images `react-native-bootsplash generate` made — assets/bootsplash/, bootsplash_logo in android/app/src/main/res, and the BootSplash images in ios/ — stay behind once nothing refers to them; delete them if you want them gone.",
          ]
        : undefined,
  };
}

/** Asset generation runs after install, against the version actually installed. */
function buildNativeSteps(
  answers: SplashAnswers,
  native: string[],
  postInstallNotes: string[],
  inAppLogo: string | null,
): PluginInstallPlan['postInstallSteps'] {
  if (native.length === 0) return undefined;

  const args = (logoPath: string): string[] => [
    'react-native-bootsplash',
    'generate',
    logoPath,
    `--platforms=${native.join(',')}`,
    `--background=${answers.backgroundColor}`,
  ];

  postInstallNotes.push(
    'Native splash wiring is not automated (too version-dependent to patch safely): add RNBootSplash.init(view, self) to AppDelegate.mm after didFinishLaunchingWithOptions, and RNBootSplash.init(this, R.style.BootTheme) inside MainActivity.onCreate — see https://github.com/zoontek/react-native-bootsplash#usage for the exact snippets for your RN version.',
  );

  if (!inAppLogo) {
    postInstallNotes.push(
      `No logo was provided — once you have one, run: npx ${args('<logo>').join(' ')}`,
    );
    return undefined;
  }

  const logoPath = inAppLogo;
  return [
    {
      label: 'Generating native splash assets…',
      run: async (postCtx) => {
        await execa('npx', args(logoPath), {
          cwd: postCtx.appRoot,
          stdio: childStdio(),
          timeout: 120000,
        });
      },
      fallbackNote: `Splash asset generation failed — re-run it yourself: npx ${args(logoPath).join(' ')}`,
    },
  ];
}
