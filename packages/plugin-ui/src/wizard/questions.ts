/**
 * FILE: questions.ts
 * PATH: packages/plugin-ui/src/wizard/questions.ts
 *
 * WHAT: The UI Theming Kit's question flow — theme mode, base font size, type
 *       scale ratio, text scaling mode, brand color, and whether to generate a
 *       starter example screen.
 * WHY:  Mirrors the redux wizard's depth per plugin — a real, specific question set,
 *       not just a single "enable this plugin?" toggle.
 * HOW:  Sequential @armemon-library/cli-kit prompts with validated numeric/hex text inputs.
 * WHEN: Called once if the user selects the UI Theming Kit plugin during Step 4 of
 *       the init flow.
 *
 * EXPORTS: askUiQuestions, UiAnswers
 * DEPENDS ON: @armemon-library/cli-kit, @armemon-library/config-types
 * USED BY: packages/plugin-ui/src/wizard/index.ts
 */

import { promptConfirm, promptSelect, promptText } from '@armemon-library/cli-kit';
import type { WizardContext } from '@armemon-library/config-types';

export interface UiAnswers {
  themeMode: 'light' | 'dark' | 'auto';
  baseFontSize: number;
  typeScaleRatio: number;
  textScaleMode: 'native' | 'custom' | 'both';
  brandColor: string;
  generateStarterComponents: boolean;
}

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

export async function askUiQuestions(_ctx: WizardContext): Promise<UiAnswers> {
  const themeMode = await promptSelect({
    message: 'Theme mode?',
    options: [
      { value: 'auto', label: 'Auto (follow system)' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ],
    initialValue: 'auto',
  });

  const baseFontSizeInput = await promptText({
    message: 'Base font size?',
    placeholder: '14',
    defaultValue: '14',
    // Bounded, not just numeric: 0 collapses the whole type ramp and 500 is not a
    // font size. Both were accepted by the old /^\d+$/ check.
    validate: (value) => {
      const n = Number.parseInt(value, 10);
      return /^\d+$/.test(value) && n >= 8 && n <= 32
        ? undefined
        : 'Enter a whole number between 8 and 32.';
    },
  });

  const typeScaleRatioInput = await promptText({
    message: 'Type scale ratio?',
    placeholder: '1.2',
    defaultValue: '1.2',
    validate: (value) => {
      const n = Number.parseFloat(value);
      return /^\d+(\.\d+)?$/.test(value) && n >= 1 && n <= 2
        ? undefined
        : 'Enter a number between 1 and 2, e.g. 1.2.';
    },
  });

  const textScaleMode = await promptSelect({
    message: 'Text scaling mode?',
    options: [
      { value: 'both', label: 'Both — blend native OS scale with your type ramp (recommended)' },
      { value: 'native', label: 'Native — fully respect the OS accessibility text size' },
      { value: 'custom', label: 'Custom — ignore OS scale, use only your type ramp' },
    ],
    initialValue: 'both',
  });

  const brandColor = await promptText({
    message: 'Primary brand color (hex)?',
    placeholder: '#5eead4',
    defaultValue: '#5eead4',
    validate: (value) => (HEX_COLOR_PATTERN.test(value) ? undefined : 'Enter a hex color like #5eead4.'),
  });

  const generateStarterComponents = await promptConfirm({
    message: 'Generate a starter example screen using Text/Button/Container?',
    initialValue: true,
  });

  return {
    themeMode: themeMode as UiAnswers['themeMode'],
    baseFontSize: Number.parseInt(baseFontSizeInput, 10),
    typeScaleRatio: Number.parseFloat(typeScaleRatioInput),
    textScaleMode: textScaleMode as UiAnswers['textScaleMode'],
    brandColor,
    generateStarterComponents,
  };
}
