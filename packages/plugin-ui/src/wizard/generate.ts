/**
 * FILE: generate.ts
 * PATH: packages/plugin-ui/src/wizard/generate.ts
 *
 * WHAT: Turns UiAnswers into a PluginInstallPlan — writes theme.config.ts (plain
 *       data), a per-app glue file calling configureUiPlugin(), and optionally a
 *       starter ExampleScreen.tsx.
 * WHY:  Same glue-file pattern as plugin-redux's generate.ts — see that file's WHY
 *       for the full rationale (factory + app-local glue vs. a static export).
 * HOW:  No external template files needed (unlike Redux's slices) since the UI
 *       plugin's generated content is small enough to inline directly.
 * WHEN: Called once by the wizard's plan() step, after askUiQuestions() resolves.
 *
 * EXPORTS: planUi
 * DEPENDS ON: @armemon-library/config-types, ./questions
 */

import { EXAMPLES_DIR, layoutOf, managedFile, type PluginInstallPlan, type WizardContext } from '@armemon-library/config-types';
import type { UiAnswers } from './questions.js';

export async function planUi(answers: UiAnswers, ctx: WizardContext): Promise<PluginInstallPlan> {
  const layout = layoutOf(ctx);
  const filesToWrite: PluginInstallPlan['filesToWrite'] = [
    {
      path: managedFile.themeConfig(layout),
      content: `import type { UiConfig } from '@armemon-library/ui';

/**
 * Theme, type scale and text scaling.
 *
 * Every option is below with what it does. Nothing here needs a rebuild — change a
 * value and reload.
 */
export const uiConfig: UiConfig = {
  // ---------------------------------------------------------------------------
  // themeMode
  //   'auto'   follow the device's light/dark setting (recommended)
  //   'light'  always light
  //   'dark'   always dark
  //
  // Read the resolved result with useTheme():
  //   const { mode, colors } = useTheme();
  //   colors is { background, surface, text, textMuted, brand }
  // ---------------------------------------------------------------------------
  themeMode: '${answers.themeMode}',

  // ---------------------------------------------------------------------------
  // baseFontSize — the size of 'medium' text, in points. Every other level is
  // derived from it by typeScaleRatio, so this one number moves all your type.
  // ---------------------------------------------------------------------------
  baseFontSize: ${answers.baseFontSize},

  // ---------------------------------------------------------------------------
  // typeScaleRatio — the step between levels. Sizes are base * ratio^step, with
  // small = -1, medium = 0, large = +1, xlarge = +2.
  //
  //   1.125  subtle, good for dense UI
  //   1.2    balanced (the common default)
  //   1.333  dramatic, good for marketing-style screens
  //
  // At base 14 and ratio 1.2: small 12, medium 14, large 17, xlarge 20.
  // ---------------------------------------------------------------------------
  typeScaleRatio: ${answers.typeScaleRatio},

  // ---------------------------------------------------------------------------
  // textScaleMode — how your type scale combines with the OS accessibility text
  // size. This is a real trade-off, so armemon makes you pick rather than guessing.
  //
  //   'native'  fully respect the OS setting. Best for accessibility; a user at
  //             200% gets 200%, and your layouts must cope.
  //   'custom'  ignore the OS entirely. Pixel-precise, and inaccessible to anyone
  //             who has enlarged their system text.
  //   'both'    average the two, so text grows but not as far. A middle ground.
  //
  // The OS value is re-read whenever the app returns to the foreground, since that
  // is the only moment it can have changed.
  // ---------------------------------------------------------------------------
  textScaleMode: '${answers.textScaleMode}',

  // ---------------------------------------------------------------------------
  // brandColor — used for Button backgrounds and available as colors.brand.
  // Any 3- or 6-digit hex.
  // ---------------------------------------------------------------------------
  brandColor: '${answers.brandColor}',
};

/**
 * Using the theme:
 *
 *   import { Container, Text, Button, useTheme, useScaling } from '@armemon-library/ui';
 *
 *   <Container style={{ padding: 24, gap: 12 }}>   // View + theme background
 *     <Text level="xlarge">Title</Text>            // 'small'|'medium'|'large'|'xlarge'
 *     <Text muted>Secondary copy</Text>            // uses colors.textMuted
 *     <Button label="Save" onPress={save} />       // brand-coloured
 *   </Container>
 *
 *   const { colors, mode } = useTheme();           // mode is 'light' | 'dark'
 *   const { fontSize } = useScaling();             // fontSize('large') -> a number
 *
 * Text, Button and Container all pass extra props straight through to the React
 * Native component underneath, and your \`style\` wins over the theme's.
 */
`,
    },
    {
      path: managedFile.uiGlue(layout),
      content: `import { configureUiPlugin } from '@armemon-library/ui';
import { uiConfig } from './theme.config';

/**
 * Glue file: turns your theme.config into the plugin object armemon.config
 * registers. You rarely edit this — edit ./theme.config instead.
 *
 * configureUiPlugin() takes a Partial<UiConfig>, so you can also override a
 * field here without touching theme.config (useful for a value that comes from
 * somewhere else at startup, e.g. a brand colour fetched per white-label build):
 *
 *   export const UiPlugin = configureUiPlugin({
 *     ...uiConfig,
 *     brandColor: process.env.BRAND_COLOR ?? uiConfig.brandColor,
 *   });
 */
export const UiPlugin = configureUiPlugin(uiConfig);
`,
    },
  ];

  if (answers.generateStarterComponents) {
    filesToWrite.push({
      path: `${EXAMPLES_DIR}/UiKitScreen.tsx`,
      content: `/**
 * A live catalogue of everything @armemon-library/ui exports.
 *
 * NOTHING IMPORTS THIS FILE. It is here to be read, copied from, and deleted — the
 * whole ${EXAMPLES_DIR}/ folder is armemon's stock parts, not your app. To see
 * it running, render <UiKitScreen /> from one of your own screens for a minute.
 *
 *
 * Every component, prop and hook the plugin has is either used below or shown as
 * a commented example — uncomment what you need, delete the rest. Nothing here is
 * special: it is an ordinary screen you own and can rewrite completely.
 *
 * THE FULL EXPORT LIST
 *   Components: <Container>, <Text>, <Button>
 *   Hooks:      useTheme(), useScaling()
 *   Helpers:    resolveThemeColors(mode, brandColor)
 *               resolveFontSize(baseFontSize, typeScaleRatio, level)
 *   Types:      UiConfig, ThemeColors, FontSizeLevel
 */
import React from 'react';
import { Container, Text, Button } from '@armemon-library/ui';

// The two hooks. Both must be called inside the app tree (the plugin's providers
// wrap it for you in armemon.config), and both throw a clear error if they aren't.
//
//   import { useTheme, useScaling } from '@armemon-library/ui';
//
//   useTheme()   -> { mode: 'light' | 'dark', colors: ThemeColors }
//   useScaling() -> { fontSize: (level?: FontSizeLevel) => number }
//
// ThemeColors has exactly these five keys, resolved from themeMode + brandColor:
//   colors.background  screen background
//   colors.surface     cards, sheets, anything raised off the background
//   colors.text        primary text
//   colors.textMuted   secondary text (what <Text muted> uses)
//   colors.brand       your brandColor (what <Button> fills with)
//
// FontSizeLevel is one of: 'small' | 'medium' | 'large' | 'xlarge'.

export default function UiKitScreen() {
  // Uncomment to read the resolved theme — useful for styling plain react-native
  // components (View, ScrollView, FlatList) with the same colours as this plugin:
  //
  //   const { mode, colors } = useTheme();
  //   const { fontSize } = useScaling();
  //
  //   <View style={{ backgroundColor: colors.surface, padding: 16 }}>
  //     <RNText style={{ color: colors.text, fontSize: fontSize('large') }}>
  //       {mode === 'dark' ? 'Dark mode' : 'Light mode'}
  //     </RNText>
  //   </View>

  return (
    // <Container> is a themed <View>: flex: 1 plus colors.background, and every
    // ViewProps prop (style, onLayout, pointerEvents, testID, ...). Your style wins,
    // so pass flex: 0 or a height if you don't want it filling its parent.
    <Container style={{ padding: 24, gap: 12 }}>
      {/*
        <Text> is a themed react-native <Text>. Two extra props on top of TextProps:
          level  'small' | 'medium' | 'large' | 'xlarge'   (default 'medium')
                 Size comes from baseFontSize x typeScaleRatio in theme.config,
                 then the device font-scale if textScaleMode allows it.
          muted  boolean (default false) -> colors.textMuted instead of colors.text

        Everything react-native's Text accepts still works:
          <Text numberOfLines={1} ellipsizeMode="tail">Long single line…</Text>
          <Text onPress={() => {}} accessibilityRole="link">Tappable text</Text>
          <Text style={{ fontWeight: '700', letterSpacing: 0.5 }}>Bold</Text>
      */}
      <Text level="xlarge">Themed with armemon UI</Text>
      <Text muted>Edit ${managedFile.themeConfig(layout)} to change colors and scale.</Text>
      {/* <Text level="small" muted>Smallest step on the type scale.</Text> */}

      {/*
        <Button> wraps <Pressable>. Required prop: label (string).
        Optional: style (ViewStyle) plus every PressableProps prop except style:
          onPress, onLongPress, onPressIn, onPressOut,
          disabled, hitSlop, delayLongPress, testID, accessibilityLabel

          <Button label="Save" onPress={save} />
          <Button label="Delete" onPress={remove} style={{ backgroundColor: '#c0392b' }} />
          <Button label="Unavailable" disabled onPress={() => {}} />
          <Button label="Wide" style={{ alignSelf: 'stretch' }} onPress={() => {}} />

        For a button shape the plugin doesn't ship (outline, icon-only, loading
        spinner), copy this file's pattern: Pressable + useTheme() for colours.
      */}
      <Button label="Example action" onPress={() => {}} />
    </Container>
  );
}
`,
    });
  }

  return {
    npmDependencies: {},
    filesToWrite,
    appEntryContributions: {
      providerImport: { importName: 'UiPlugin', from: './ui/index' },
      registerInRuntimeConfig: true,
    },
    // The welcome screen uses the components and points at UiKitScreen, which only
    // exists when the starter was generated.
    provides: answers.generateStarterComponents ? ['themed-components'] : undefined,
  };
}
