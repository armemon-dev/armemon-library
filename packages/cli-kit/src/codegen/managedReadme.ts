/**
 * FILE: managedReadme.ts
 * PATH: packages/cli-kit/src/codegen/managedReadme.ts
 *
 * WHAT: The guide written into every scaffolded app — what the folders are, how to do
 *       everyday things, what each plugin gives you, and how to use the plugins without
 *       the CLI at all.
 * WHY:  It is read by people who have never used armemon, often on the day they open
 *       the project. So it is written for them: short sentences, plain words, and every
 *       command ready to paste. The full option reference is generated from the CLI
 *       itself and appended after this, so nothing here has to list options.
 *
 *       Written for the app it sits in. It used to describe every plugin whatever the
 *       app had, and show TypeScript to JavaScript apps — so a reader was told about
 *       Redux in an app without it, and pasted `(state: any) =>` into a .js file.
 * HOW:  The folder names follow the app's layout. Given the app's plugins and language,
 *       only the tasks and plugin sections that apply are included, and snippets and
 *       file names are written in that language; without them, the full guide covers
 *       everything, which is what the repository publishes. A test runs every
 *       `armemon …` line in the full guide against the real command definitions, and a
 *       probe type-checks every code block against the real packages.
 * WHEN: Written by init; rewritten by `armemon sync`.
 *
 * EXPORTS: managedReadme, GuideApp
 * DEPENDS ON: @armemon-library/config-types
 * USED BY: packages/cli-armemon/src/flows/initReactNative.ts, ./flows/sync.ts,
 *          packages/cli-armemon/src/userGuide.ts
 */

import {
  SCREENS_DIR,
  SHARED_DIR,
  SLICES_DIR,
  type AppLanguage,
  type AppLayout,
} from '@armemon-library/config-types';

/** The app a guide is written for. */
export interface GuideApp {
  /** Plugin ids from armemon.config — `ui`, `redux`, `navigation`, `essentials`, `splash`. */
  plugins: string[];
  language: AppLanguage;
}

/** The guide, for an app whose armemon files live in `layout.managed`. */
export function managedReadme(layout: AppLayout, app?: GuideApp): string {
  const zone = `${layout.managed}/`;
  const has = (plugin: string) => app === undefined || app.plugins.includes(plugin);
  const js = app?.language === 'javascript';
  /** Source file names in the app's own language. */
  const ts = js ? 'js' : 'ts';
  const tsx = js ? 'jsx' : 'tsx';
  const when = (condition: boolean, text: string) => (condition ? text : '');

  const settable = [
    has('ui') && 'armemon set ui.themeMode dark\narmemon set ui.brandColor "#ff6600"',
    has('essentials') && 'armemon set essentials.notifications.position bottom',
  ].filter(Boolean);

  const pluginSections = [
    has('ui') &&
      `### UI — theme, text and buttons

\`\`\`${tsx}
import { Text, Button, Container, useTheme } from '@armemon-library/ui';

export default function HomeScreen() {
  const { mode } = useTheme();

  return (
    <Container>
      <Text level="large">Hello</Text>
      <Text muted>The theme is {mode}</Text>
      <Button label="Save" onPress={() => {}} />
    </Container>
  );
}
\`\`\`

- Text sizes: \`small\`, \`medium\`, \`large\`, \`xlarge\`.
- Settings file: \`${zone}ui/theme.config.${ts}\`
`,
    has('redux') &&
      `### Redux — app state

The example is in "Add app state" above. You also get \`createSlice\`,
\`createAsyncThunk\` and \`nanoid\` from \`@armemon-library/redux\`.

- Settings file: \`${zone}redux/store.config.${ts}\`
`,
    has('navigation') &&
      `### Navigation — screens and web addresses

Move to another screen:

\`\`\`${tsx}
import { useNavigation } from '@react-navigation/native';

export function GoToProfile() {
  const navigation = useNavigation();
  return () => navigation.navigate('Profile');
}
\`\`\`

- Settings folder: \`${zone}navigation/\`
`,
    has('essentials') &&
      `### Essentials — messages, network and loading

\`\`\`${tsx}
import { useNotifications, useNetworkStatus, useLoading } from '@armemon-library/essentials';

export function useSaveButton() {
  const { notify } = useNotifications();
  const { isOnline } = useNetworkStatus();
  const { showLoading, hideLoading } = useLoading();

  return async () => {
    if (!isOnline) {
      notify({ message: 'You are offline', type: 'warning' });
      return;
    }
    showLoading();
    notify({ message: 'Saved', type: 'success' });
    hideLoading();
  };
}
\`\`\`

- Message types: \`success\`, \`error\`, \`info\`, \`warning\`.
- Settings file: \`${zone}essentials/essentials.config.${ts}\`
`,
    has('splash') &&
      `### Splash — the screen shown while the app starts

Change the colour and logo in \`${zone}splash/splash.config.${ts}\`.
`,
  ].filter(Boolean);

  return `# Your armemon app guide

This file explains your app and every armemon command.

- Every command is ready to copy and paste.
- Run commands from inside your app folder.
- If your terminal says \`armemon: command not found\`, install the CLI once with
  \`npm install -g @armemon-library/cli\` — or put \`npx @armemon-library/cli\` in front,
  like \`npx @armemon-library/cli doctor\`.
- \`memon\` is a shorter name for the same command — \`memon doctor\` works exactly like
  \`armemon doctor\`.

## Quick start

\`\`\`bash
# see every command
armemon --help

# add a screen
armemon create-screen Profile

# check that everything is set up
armemon doctor
\`\`\`

## Your folders

| Folder | What goes there | Who changes it |
| --- | --- | --- |
| \`${zone}\` | Settings for navigation, Redux, theme and plugins | armemon (you can too) |
| \`${SCREENS_DIR}/\` | Your screens, one folder each | You |
| \`${SHARED_DIR}/\` | Components and hooks more than one screen uses | You |
${when(has('redux'), `| \`${SLICES_DIR}/\` | Your Redux state | You |\n`)}
**One simple rule:** armemon updates the files in \`${zone}\`. Files in \`src/\` are
yours — armemon creates them once and never touches them again.

## Everyday tasks

### Add a screen

\`\`\`bash
armemon create-screen Profile
\`\`\`

${
  has('navigation')
    ? `This creates the screen, adds it to your navigator, and gives it a web address:
\`/Profile\`.

### Add a screen with an ID in its address, like /order/42

\`\`\`bash
armemon create-screen Order --params "id:string" --link order/:id
\`\`\``
    : `This creates the screen's folder. This app has no navigator, so show the screen
from wherever you want it — \`App.${tsx}\` renders your first one.`
}

### Rename or remove a screen

\`\`\`bash
armemon rename-screen Profile Account
armemon remove-screen Account
\`\`\`
${when(
  has('navigation'),
  `
### Give every screen a web address

If every screen opens at \`localhost:5173\` with nothing after it, run:

\`\`\`bash
armemon link init
\`\`\`

### See or change web addresses

\`\`\`bash
armemon link list
armemon link add Profile me
armemon link remove Profile
\`\`\`
`,
)}${when(
  has('redux'),
  `
### Add app state (Redux)

\`\`\`bash
armemon create-slice cart
\`\`\`

Then use it in any screen:

\`\`\`${tsx}
import { useSelector, useDispatch } from '@armemon-library/redux';

const cart = useSelector((${js ? 'state' : 'state: any'}) => state.cart.value);
const dispatch = useDispatch();
dispatch({ type: 'cart/set', payload: ['apple'] });
\`\`\`

### Rename or remove app state

\`\`\`bash
armemon rename-slice cart basket
armemon remove-slice basket
\`\`\`
`,
)}
### Add a component or a hook

\`\`\`bash
# used by many screens
armemon create-component ProductCard --shared

# used by one screen only
armemon create-component ProductRow --screen Order

armemon create-hook useCart --shared
\`\`\`

These only create the file. Import it yourself where you need it.
${when(
  settable.length > 0,
  `
### Change a setting

\`\`\`bash
${settable.join('\n')}
\`\`\`
`,
)}
### Try a command without saving anything

Add \`--dry-run\` to any command that changes files:

\`\`\`bash
armemon create-screen Profile --dry-run
\`\`\`

### After you edit files in ${zone} yourself

\`\`\`bash
armemon sync
\`\`\`

This tidies the files so the next command can read them, and updates this guide.

You can edit anything in \`${zone}\`. The one file armemon rewrites completely is this
guide — so keep your own notes somewhere else.

### Update armemon's packages

After updating the CLI itself, run this inside your app:

\`\`\`bash
armemon upgrade
\`\`\`

It moves the app to the package versions that match the CLI, installs them, and tidies
the files in \`${zone}\`.

### Something is not working

\`\`\`bash
armemon doctor
\`\`\`

It checks your setup and tells you exactly what to fix.

## Plugins

${
  app === undefined
    ? 'Plugins add features to your app. Your app may use some or all of them.'
    : pluginSections.length > 0
      ? 'Plugins add features to your app. These are the ones this app uses.'
      : 'This app uses no plugins yet.'
}

### Add or remove a plugin

\`\`\`bash
# what there is, and what this app has
armemon plugin list

# add one — set up exactly as choosing it at init would have
armemon plugin add redux

# take one out again
armemon plugin remove redux
\`\`\`

Nothing changes until every step is worked out. Removing deletes only files that are
still exactly as armemon wrote them, and stops while your code still uses something it
would take away — it tells you what, and where. Add \`--dry-run\` to see the whole change
first.
${pluginSections.map((section) => `\n${section}`).join('')}
## Use the plugins without the armemon CLI

You don't need the CLI. The plugins are normal npm packages, so you can add them to
any React Native app.

### Step 1 — install

Always install core:

\`\`\`bash
npm install @armemon-library/core
\`\`\`

Then add only the plugins you want:

\`\`\`bash
# UI
npm install @armemon-library/ui

# Redux
npm install @armemon-library/redux @reduxjs/toolkit react-redux

# Redux, if you also want to save state when the app closes (optional)
npm install redux-persist @react-native-async-storage/async-storage

# Navigation
npm install @armemon-library/navigation @react-navigation/native @react-navigation/native-stack react-native-screens react-native-safe-area-context

# Essentials
npm install @armemon-library/essentials

# Essentials, if you also want network status (optional)
npm install @react-native-community/netinfo
\`\`\`

### Step 2 — set up your plugins in one file

\`\`\`${ts}
// armemon.setup.${ts}
import { registerRuntimeConfig } from '@armemon-library/core';
import { configureUiPlugin } from '@armemon-library/ui';
import { configureReduxPlugin } from '@armemon-library/redux';
import { configureEssentialsPlugin } from '@armemon-library/essentials';

registerRuntimeConfig({
  plugins: [
    configureUiPlugin({ themeMode: 'auto', brandColor: '#5eead4' }),
    configureReduxPlugin({ slices: {} }),
    configureEssentialsPlugin(),
  ],
  userTasks: [],
});
\`\`\`

Only list the plugins you installed.

### Step 3 — wrap your app

\`\`\`${tsx}
// App.${tsx}
import './armemon.setup';
import { KitProvider } from '@armemon-library/core';
import HomeScreen from './src/screens/HomeScreen';

export default function App() {
  return (
    <KitProvider>
      <HomeScreen />
    </KitProvider>
  );
}
\`\`\`

### Want network status?

Essentials only checks the network when you give it \`netInfoAdapter\`. Install
\`@react-native-community/netinfo\` (Step 1), then:

\`\`\`${ts}
// armemon.setup.${ts}
import { registerRuntimeConfig } from '@armemon-library/core';
import { configureEssentialsPlugin } from '@armemon-library/essentials';
import { netInfoAdapter } from '@armemon-library/essentials/netinfo';

registerRuntimeConfig({
  plugins: [configureEssentialsPlugin({ netInfoAdapter })],
  userTasks: [],
});
\`\`\`

Now \`useNetworkStatus()\` reports whether the device is really online.

### Common mistakes

- **"No armemon runtime config registered"** — \`import './armemon.setup';\` must be at
  the top of \`App.${tsx}\`, above everything else.
- **"no NetInfo adapter was provided"** — you turned the network check on with
  \`network: { enabled: true }\` but didn't pass \`netInfoAdapter\`. Pass it as shown in
  "Want network status?" above.
- \`plugins\` and \`userTasks\` are both required. Use \`[]\` when you have none.
- The CLI commands in this guide (\`armemon create-screen\` and the rest) need an app
  made with \`armemon init\`. Without the CLI, you add screens and state yourself.

Two commands never change \`${zone}\`: \`armemon create-component\` and
\`armemon create-hook\` only create one file in \`src/\`.

The full list of commands and options is below.
`;
}
