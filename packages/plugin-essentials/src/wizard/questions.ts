/**
 * FILE: questions.ts
 * PATH: packages/plugin-essentials/src/wizard/questions.ts
 *
 * WHAT: The Essentials plugin's question flow — which sub-features to enable
 *       (all three preselected), then per-sub-feature follow-up questions only for
 *       the ones actually selected.
 * WHY:  Bundling three sub-features under one plugin means the wizard needs its own
 *       internal multiselect gate before drilling into each sub-feature's specific
 *       questions — deselecting all three still keeps the plugin registered (simpler
 *       than making the whole plugin conditional), just with the toast stack /
 *       offline banner / loading overlay never showing anything.
 * HOW:  Sequential @armemon-library/cli-kit prompts, gated by which sub-features were
 *       selected in the first question.
 * WHEN: Called once if the user selects Essentials during Step 4 of the init flow.
 *
 * EXPORTS: askEssentialsQuestions, EssentialsAnswers
 * DEPENDS ON: @armemon-library/cli-kit, @armemon-library/config-types
 * USED BY: packages/plugin-essentials/src/wizard/index.ts
 */

import {
  promptConfirm,
  promptMultiselect,
  promptSelect,
  promptText,
  resolveDependencyVersions,
} from '@armemon-library/cli-kit';
import type { WizardContext } from '@armemon-library/config-types';

export type SubFeature = 'notifications' | 'network' | 'loading';

export interface EssentialsAnswers {
  subFeatures: SubFeature[];
  toastPosition: 'top' | 'bottom';
  toastDelay: number;
  toastSwipeable: boolean;
  networkMode: 'internet' | 'connection';
  networkPolling: boolean;
  pollInterval: number;
  showOfflineBanner: boolean;
  historyLimit: number;
  loadingStyle: 'progressbar' | 'spinner' | 'blank';
  dependencyVersions: Record<string, string>;
}

export async function askEssentialsQuestions(ctx: WizardContext): Promise<EssentialsAnswers> {
  const subFeatures = await promptMultiselect<SubFeature>({
    message: 'Which sub-features?',
    options: [
      { value: 'notifications', label: 'Notifications — toast messages' },
      { value: 'network', label: 'Network monitoring — connectivity status + offline banner' },
      { value: 'loading', label: 'Loading & Error screens — global loading/error overlay' },
    ],
    initialValues: ['notifications', 'network', 'loading'],
  });

  let toastPosition: 'top' | 'bottom' = 'top';
  let toastDelay = 3000;
  let toastSwipeable = true;
  let historyLimit = 100;

  if (subFeatures.includes('notifications')) {
    toastPosition = await promptSelect({
      message: 'Toast position?',
      options: [
        { value: 'top', label: 'Top' },
        { value: 'bottom', label: 'Bottom' },
      ],
      initialValue: 'top',
    });

    const delayInput = await promptText({
      message: 'Default auto-dismiss delay (ms)?',
      placeholder: '3000',
      defaultValue: '3000',
      validate: (value) => (/^\d+$/.test(value) ? undefined : 'Enter a whole number.'),
    });
    toastDelay = Number.parseInt(delayInput, 10);

    toastSwipeable = await promptConfirm({
      message: 'Swipeable to dismiss?',
      initialValue: true,
    });

    const historyInput = await promptText({
      message: 'How many past notifications to keep in history?',
      placeholder: '100',
      defaultValue: '100',
      validate: (value) =>
        /^\d+$/.test(value) && Number.parseInt(value, 10) >= 1
          ? undefined
          : 'Enter a whole number of at least 1.',
    });
    historyLimit = Number.parseInt(historyInput, 10);
  }

  let networkMode: 'internet' | 'connection' = 'internet';
  let networkPolling = false;
  let pollInterval = 10000;
  let showOfflineBanner = true;

  if (subFeatures.includes('network')) {
    networkMode = await promptSelect({
      message: 'Monitoring mode?',
      options: [
        { value: 'internet', label: 'Internet reachability (recommended)' },
        { value: 'connection', label: 'Connection only (faster, less accurate)' },
      ],
      initialValue: 'internet',
    });

    networkPolling = await promptConfirm({
      message: 'Enable active polling fallback (in addition to event-based updates)?',
      initialValue: false,
    });

    if (networkPolling) {
      // Was hardcoded to 10000 in the generated config while being presented as
      // configurable nowhere — either ask or don't have the field.
      const pollInput = await promptText({
        message: 'Poll interval (ms)?',
        placeholder: '10000',
        defaultValue: '10000',
        validate: (value) =>
          /^\d+$/.test(value) && Number.parseInt(value, 10) >= 1000
            ? undefined
            : 'Enter a whole number of milliseconds, at least 1000.',
      });
      pollInterval = Number.parseInt(pollInput, 10);
    }

    showOfflineBanner = await promptConfirm({
      message: 'Show an offline banner automatically?',
      initialValue: true,
    });
  }

  let loadingStyle: 'progressbar' | 'spinner' | 'blank' = 'progressbar';

  if (subFeatures.includes('loading')) {
    loadingStyle = await promptSelect({
      message: 'Loading overlay style?',
      options: [
        { value: 'progressbar', label: 'Progress bar look (spinner + dim overlay)' },
        { value: 'spinner', label: 'Plain spinner' },
        { value: 'blank', label: 'Blank dim overlay only' },
      ],
      initialValue: 'progressbar',
    });
  }

  const nativeDeps = subFeatures.includes('network') ? ['@react-native-community/netinfo'] : [];
  const dependencyVersions = await resolveDependencyVersions(
    ctx.rnVersion,
    nativeDeps.map((packageName) => ({ packageName })),
  );

  return {
    subFeatures,
    toastPosition,
    toastDelay,
    toastSwipeable,
    networkMode,
    networkPolling,
    pollInterval,
    showOfflineBanner,
    loadingStyle,
    historyLimit,
    dependencyVersions,
  };
}
