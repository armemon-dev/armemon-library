/**
 * FILE: KitProvider.tsx
 * PATH: packages/core/src/provider/KitProvider.tsx
 *
 * WHAT: The single component every scaffolded App.tsx renders — runs the 3-phase
 *       init sequence, shows a splash screen until it finishes (or an error screen
 *       if anything fails), then renders the plugin provider chain around
 *       `children`. Takes no props: everything comes from the registered runtime
 *       config.
 * WHY:  Zero-prop by design — App.tsx imports the generated runtime config (which
 *       registers itself) and renders <KitProvider>, and that's the whole wiring.
 *
 *       The exported KitProvider is a thin shell whose only job is to install the
 *       error boundary BEFORE the body renders. That ordering is the point: the body
 *       reads the runtime config and validates the plugin list during render, and
 *       both of those throw deliberately with descriptive messages. Thrown from
 *       inside the boundary, those messages reach the error screen; thrown from
 *       outside it, they were an unexplained red screen.
 * HOW:  The body memoizes config and validated plugins, runs orchestrate() in a
 *       mount effect guarded against React 18 StrictMode's deliberate double-invoke
 *       (which otherwise ran every init task twice, since the old cleanup set a
 *       `cancelled` flag but never actually stopped the in-flight run), and tracks
 *       progress/ready/error state. While a plugin's own tasks are running its
 *       `loadingComponent` is shown in place of the splash, if it declared one.
 *       `readyCustom` holds the splash past task completion until notifyReady() or
 *       readyCustomTimeout; `minSplashDurationMs` holds it for a floor duration so a
 *       fast cold start doesn't flash.
 * WHEN: Rendered once, at the root of every scaffolded app.
 *
 * EXPORTS: KitProvider (default), KitProviderProps
 * DEPENDS ON: react, @armemon-library/config-types, ./ProviderChain, ./SplashRenderer,
 *             ./ErrorRenderer, ./ErrorBoundary, ./plugins/registration,
 *             ../init/orchestrator, ../config/configLoader, ../context/TaskContext,
 *             ../context/KitReadyContext
 * USED BY: generated App.tsx (in scaffolded apps)
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ProviderChain } from './ProviderChain.js';
import { DefaultSplashScreen } from './SplashRenderer.js';
import { DefaultErrorScreen } from './ErrorRenderer.js';
import { KitErrorBoundary } from './ErrorBoundary.js';
import { registerPlugins } from './plugins/registration.js';
import { orchestrate } from '../init/orchestrator.js';
import { getRuntimeConfig, tryGetRuntimeConfig } from '../config/configLoader.js';
import { TaskContext, type TaskProgressState } from '../context/TaskContext.js';
import { KitReadyContext } from '../context/KitReadyContext.js';

export interface KitProviderProps {
  children: ReactNode;
}

const INITIAL_PROGRESS: TaskProgressState = {
  currentTask: null,
  currentPlugin: null,
  totalTasks: 0,
  completedTasks: 0,
};

function KitProviderBody({ children }: KitProviderProps): ReactElement {
  const config = useMemo(() => getRuntimeConfig(), []);
  const plugins = useMemo(() => registerPlugins(config.plugins), [config.plugins]);

  const [progress, setProgress] = useState<TaskProgressState>(INITIAL_PROGRESS);
  const [tasksComplete, setTasksComplete] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [customReadyReceived, setCustomReadyReceived] = useState(!config.readyCustom);
  const mountedAtRef = useRef(Date.now());
  const startedRef = useRef(false);

  useEffect(() => {
    // React 18 StrictMode mounts, unmounts and remounts every effect in dev. Without
    // this guard that ran the whole init sequence twice — and because the old
    // cleanup only flipped a boolean, the first run kept firing side effects while
    // the second one started. Init is a once-per-process sequence; treat it as one.
    if (startedRef.current) return undefined;
    startedRef.current = true;

    const controller = new AbortController();
    let minDurationTimer: ReturnType<typeof setTimeout> | undefined;

    orchestrate({
      plugins,
      userTasks: config.userTasks,
      signal: controller.signal,
      onProgress: (state) => {
        if (!controller.signal.aborted) setProgress(state);
      },
    })
      .then(() => {
        if (controller.signal.aborted) return;
        const remaining = (config.minSplashDurationMs ?? 0) - (Date.now() - mountedAtRef.current);

        if (remaining > 0) {
          minDurationTimer = setTimeout(() => {
            if (!controller.signal.aborted) setTasksComplete(true);
          }, remaining);
        } else {
          setTasksComplete(true);
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      });

    return () => {
      controller.abort();
      if (minDurationTimer) clearTimeout(minDurationTimer);
    };
  }, [plugins, config.userTasks, config.minSplashDurationMs]);

  useEffect(() => {
    if (!tasksComplete || !config.readyCustom || customReadyReceived) return undefined;

    const timeoutMs = config.readyCustomTimeout ?? 10000;
    const timer = setTimeout(() => setCustomReadyReceived(true), timeoutMs);
    return () => clearTimeout(timer);
  }, [tasksComplete, config.readyCustom, config.readyCustomTimeout, customReadyReceived]);

  const notifyReady = useCallback(() => setCustomReadyReceived(true), []);
  const isKitReady = tasksComplete && customReadyReceived;

  // A plugin may supply its own loading UI for the window in which its tasks run.
  const pluginLoading = useMemo<ComponentType | undefined>(() => {
    if (!progress.currentPlugin) return undefined;
    return plugins.find((plugin) => plugin.name === progress.currentPlugin)?.loadingComponent;
  }, [plugins, progress.currentPlugin]);

  if (error) {
    const ErrorScreen = config.ErrorScreenComponent ?? DefaultErrorScreen;
    return <ErrorScreen error={error} />;
  }

  if (!isKitReady) {
    const SplashScreen = pluginLoading ?? config.SplashScreenComponent ?? DefaultSplashScreen;
    return (
      <TaskContext.Provider value={progress}>
        <SplashScreen />
      </TaskContext.Provider>
    );
  }

  return (
    <TaskContext.Provider value={progress}>
      <KitReadyContext.Provider value={{ isKitReady, notifyReady }}>
        <ProviderChain plugins={plugins}>{children}</ProviderChain>
      </KitReadyContext.Provider>
    </TaskContext.Provider>
  );
}

export default function KitProvider({ children }: KitProviderProps): ReactElement {
  // Read without throwing: the boundary below is what turns a missing/invalid config
  // into the app's own error screen, and it has to be mounted before the body runs.
  const ErrorScreen = tryGetRuntimeConfig()?.ErrorScreenComponent ?? DefaultErrorScreen;

  return (
    <KitErrorBoundary fallback={ErrorScreen}>
      <KitProviderBody>{children}</KitProviderBody>
    </KitErrorBoundary>
  );
}
