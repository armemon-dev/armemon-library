/**
 * FILE: platformGuide.ts
 * PATH: packages/cli-kit/src/codegen/platformGuide.ts
 *
 * WHAT: The README armemon leaves in place of a platform folder it could not
 *       generate on this machine.
 * WHY:  A missing folder says nothing. Someone opening the repo on Windows has no
 *       way to know the target was wanted, that everything else in the app is
 *       already prepared for it, or that one command finishes the job — so the
 *       likely outcomes are "assume it's unsupported" or "run the raw React Native
 *       tool and miss the four things armemon does around it".
 *
 *       It doubles as the record that the decision was made: `armemon add windows`
 *       is in the repo, in the folder where the answer belongs, rather than in the
 *       scrollback of whoever ran init.
 * HOW:  Plain Markdown, no placeholders left for the reader to work out — the app's
 *       own package manager and React Native version are written into the commands.
 * WHEN: Written by the init flow when a platform is requested and its attach step
 *       cannot run on this host.
 *
 * EXPORTS: buildPlatformGuide, PlatformGuideOptions
 * DEPENDS ON: nothing
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts
 */

export interface PlatformGuideOptions {
  platform: 'windows' | 'macos';
  appName: string;
  /**
   * The RESOLVED React Native version this app runs — 0.87.1, never "latest".
   * The guide's whole point about pairing collapses if it prints "latest" while
   * explaining that "latest" tells you nothing.
   */
  rnVersion: string;
  packageManager: string;
  /** The host that couldn't do it, named so the reader knows this isn't their fault. */
  scaffoldedOn: string;
}

/**
 * How each package manager runs a CLI the app doesn't depend on. The package name is
 * spelled out because `armemon` alone is not our package on npm, and the app has no
 * local copy of the CLI for a bare `yarn armemon` to find. Yarn gets npx: `yarn dlx`
 * exists only from Yarn 2 on, and npx comes with Node whichever Yarn is installed.
 * Running the CLI through npx never touches the app's lockfile — `add` installs with
 * the app's own package manager.
 */
const RUN_CLI: Record<string, string> = {
  npm: 'npx @armemon-library/cli',
  yarn: 'npx @armemon-library/cli',
  pnpm: 'pnpm dlx @armemon-library/cli',
  bun: 'bunx @armemon-library/cli',
};

const DETAIL: Record<
  'windows' | 'macos',
  { title: string; needs: string; why: string; builds: string }
> = {
  windows: {
    title: 'Windows',
    needs: 'Windows, with Visual Studio and the Windows SDK',
    why:
      "react-native-windows' CLI plugin looks for `pwsh.exe` and `dotnet.exe` just to load, " +
      'so on any other operating system its `init-windows` command never registers at all. ' +
      'This is a limit of that tool, not of armemon — no flag works around it.',
    builds: 'npm run windows',
  },
  macos: {
    title: 'macOS',
    needs: 'a Mac with Xcode',
    why:
      'react-native-macos could not generate the project on this machine. That is unusual — ' +
      'its init tool normally runs anywhere — so the cause is most likely that no ' +
      'react-native-macos release pairs with this app’s React Native version yet.',
    builds: 'npm run macos',
  },
};

export function buildPlatformGuide(options: PlatformGuideOptions): string {
  const { platform, appName, rnVersion, packageManager, scaffoldedOn } = options;
  const detail = DETAIL[platform];
  const runCli = RUN_CLI[packageManager] ?? RUN_CLI.npm;

  return `# ${detail.title} target — not generated yet

**This folder is a placeholder.** ${appName} was scaffolded on \`${scaffoldedOn}\`, which
cannot generate a ${detail.title} project. Everything else in the app is already ready
for one.

## Why it isn't here

${detail.why}

## Adding it — one command

On ${detail.needs}, clone this repo, install, then:

\`\`\`bash
${packageManager} install
${runCli} add ${platform}
\`\`\`

Then commit the generated \`${platform}/\` folder. **Nobody has to do this again** — from
that point it is an ordinary part of the repo, like \`android/\`, and every clone gets it.

## What that command does for you

1. Reads this app's React Native version — \`${rnVersion}\`, from package.json, not the
   \`${rnVersion === 'latest' ? 'version' : '"latest"'}\` that may have been typed at init.
2. Asks the npm registry which \`react-native-${platform}\` release pairs with it, and
   warns you if the newest one is still behind React Native.
3. Installs it and generates \`${platform}/\`.
4. Adds the \`${platform}\` script to package.json.
5. Adds \`"${platform}"\` to the platforms list in armemon.config, so \`armemon doctor\`
   and every later command know the target exists.

Doing it by hand means doing all five, and steps 2 and 5 are the ones people miss.

## Once it is added

\`\`\`bash
${detail.builds}
\`\`\`

## Worth knowing before you do

- **The pairing is resolved when you run the command, not when the app was created.**
  \`react-native-${platform}\` tracks React Native's minor line but ships behind it. If a
  matching release doesn't exist yet, armemon takes the newest one that isn't ahead of
  your React Native and tells you it did. That combination usually builds, with a peer
  warning.
- **Adding a target later is not the same as having chosen it at init.** Any native
  module you have already installed set itself up for the platforms that existed at the
  time. Most React Native libraries handle a new platform through autolinking on the
  next build, but a library with manual setup steps for ${detail.title} will need them
  applied by hand — check the ones you depend on.
- **It costs every teammate an install.** \`react-native-${platform}\` becomes a dependency
  of the app for everyone, including people who only build Android. That is the normal
  price of a multi-platform repo, and it is small — but it is a real change to everyone's
  install, so it belongs in a commit of its own with a message that says why.
`;
}
