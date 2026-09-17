/**
 * FILE: questions.ts
 * PATH: packages/builtin-splash/src/wizard/questions.ts
 *
 * WHAT: The always-on splash-screen question flow — logo, background color, and
 *       minimum splash duration.
 * WHY:  Asked unconditionally per the user's "built-in advanced init setup and
 *       splash screen" requirement — every armemon app gets a real native splash,
 *       not just whatever the RN CLI's own bare-bones default happens to be.
 *       Progress-during-startup isn't asked here: core's DefaultSplashScreen already
 *       shows a live task name, so this step doesn't need to duplicate that.
 * HOW:  Sequential @armemon-library/cli-kit prompts; the logo path is validated to exist on
 *       disk (relative to the app root) when provided.
 * WHEN: Called once, unconditionally, during Step 6 of the init flow.
 *
 * EXPORTS: askSplashQuestions, SplashAnswers
 * DEPENDS ON: node:path, node:fs, @armemon-library/cli-kit, @armemon-library/config-types
 * USED BY: packages/builtin-splash/src/wizard/index.ts
 */

import path from 'node:path';
import fs from 'node:fs';
import { CliError, promptConfirm, promptText, resolveDependencyVersions } from '@armemon-library/cli-kit';
import type { WizardContext } from '@armemon-library/config-types';

export interface SplashAnswers {
  logoPath: string | null;
  backgroundColor: string;
  minSplashDurationMs: number;
  dependencyVersions: Record<string, string>;
}

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

export async function askSplashQuestions(ctx: WizardContext): Promise<SplashAnswers> {
  // --logo skips the two prompts entirely. Without it the logo path is
  // interactive-only, which means no automated run can exercise it — and it is the
  // part of the splash most likely to break, since it spans a copy, a native
  // generator and the web markup.
  const flagLogo = ctx.flags.logo;
  const hasLogo = flagLogo
    ? true
    : await promptConfirm({
        message: 'Do you have a logo/icon image ready for the splash screen?',
        initialValue: false,
      });

  let logoPath: string | null = null;
  if (hasLogo) {
    // Resolved against the directory the user is IN as well as the new app.
    // Requiring it inside the app was close to unusable: the app directory is
    // created part-way through this same run, so the only way to satisfy it was to
    // drop the file in from a second terminal while the wizard waited.
    const resolveLogo = (value: string): string | null => {
      for (const base of [ctx.cwd, ctx.appRoot]) {
        const candidate = path.resolve(base, value);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      }
      return null;
    };

    const answer =
      flagLogo ??
      (await promptText({
        message: 'Path to the logo image (relative to where you are now, e.g. ./logo.png)',
        placeholder: './logo.png',
        validate: (value) => {
          if (!value) return 'Enter a path, or answer no to skip the logo.';
          if (!resolveLogo(value)) {
            return `Couldn't find "${value}" - looked in ${ctx.cwd} and in the new app.`;
          }
          return undefined;
        },
      }));

    // Stored absolute so later steps don't have to re-guess which base it came from.
    logoPath = resolveLogo(answer);
    if (!logoPath) {
      throw new CliError(
        `Couldn't find the logo "${answer}".`,
        `Looked in ${ctx.cwd} and in the new app. Pass a path relative to where you are now.`,
      );
    }
  }

  const backgroundColor = await promptText({
    message: 'Splash background color (hex)',
    placeholder: '#FFFFFF',
    defaultValue: '#FFFFFF',
    validate: (value) =>
      HEX_COLOR_PATTERN.test(value) ? undefined : 'Enter a hex color like #FFFFFF.',
  });

  const minDurationInput = await promptText({
    message: 'Minimum splash duration in ms (avoids a flash on fast cold starts)',
    placeholder: '0',
    defaultValue: '0',
    // Upper bound because this value literally holds the app's first screen hostage:
    // an accidental extra zero used to be accepted, and would have been ignored
    // anyway — the answer never reached the runtime at all until now.
    validate: (value) => {
      const n = Number.parseInt(value, 10);
      return /^\d+$/.test(value) && n <= 10000
        ? undefined
        : 'Enter a whole number of milliseconds, 0-10000.';
    },
  });

  const dependencyVersions = await resolveDependencyVersions(ctx.rnVersion, [
    { packageName: 'react-native-bootsplash' },
  ]);

  return {
    logoPath,
    backgroundColor,
    minSplashDurationMs: Number.parseInt(minDurationInput, 10),
    dependencyVersions,
  };
}
