/**
 * FILE: provider.tsx
 * PATH: packages/plugin-essentials/src/runtime/notifications/provider.tsx
 *
 * WHAT: Toast notification queue + history state and the useNotifications() hook.
 * WHY:  In-memory only for v1 (no AsyncStorage-persisted history like the reference
 *       kit-old implementation) — a deliberate scope reduction to keep this plugin's
 *       first version shippable; persistence can layer on top later without an API
 *       change (history would just get seeded from storage on mount).
 * HOW:  notify() pushes into both `queue` (currently visible) and `history` (ever
 *       shown); a tracked setTimeout removes the item from `queue` after its delay.
 *       History is capped at config.historyLimit — it used to be unbounded, so a
 *       long session with frequent toasts grew it forever. Every timer is tracked so
 *       dismiss(), clear() and unmount can cancel it rather than letting it fire into
 *       an unmounted tree. Re-notifying with an explicit duplicate id replaces the
 *       queued entry instead of rendering two nodes with the same React key.
 * WHEN: Mounted once by configureEssentialsPlugin()'s provider; read via
 *       useNotifications() by any app screen that wants to show a toast.
 *
 * EXPORTS: NotificationsProvider, useNotifications, NotificationItem, NotificationType, NotifyOptions
 * DEPENDS ON: react, ../config, ./components/ToastStack
 * USED BY: packages/plugin-essentials/src/runtime/index.tsx
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { NotificationsConfig } from '../config.js';
import { ToastStack } from './components/ToastStack.js';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  message: string;
  delay: number;
  read: boolean;
}

export interface NotifyOptions {
  type?: NotificationType;
  message: string;
  delay?: number;
  id?: string;
}

export interface NotificationsContextValue {
  queue: NotificationItem[];
  history: NotificationItem[];
  notify: (options: NotifyOptions) => string;
  dismiss: (id: string) => void;
  clear: () => void;
  markRead: (id: string) => void;
  clearHistory: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

let idCounter = 0;

export interface NotificationsProviderProps {
  config: NotificationsConfig;
  children: ReactNode;
}

export function NotificationsProvider({ config, children }: NotificationsProviderProps): ReactElement {
  const [queue, setQueue] = useState<NotificationItem[]>([]);
  const [history, setHistory] = useState<NotificationItem[]>([]);

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setQueue((current) => current.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback(
    (options: NotifyOptions): string => {
      idCounter += 1;
      const id = options.id ?? `notif_${Date.now()}_${idCounter}`;
      const item: NotificationItem = {
        id,
        type: options.type ?? 'info',
        message: options.message,
        delay: options.delay ?? config.defaultDelay,
        read: false,
      };

      setQueue((current) => [...current.filter((existing) => existing.id !== id), item]);
      // Capped: history is append-only with only an explicit clearHistory() to drain
      // it, so an app that toasts frequently over a long session grew it without
      // bound. Newest first, oldest dropped.
      setHistory((current) => [item, ...current].slice(0, config.historyLimit));

      // A toast re-sent under the same id replaces the old one, so its timer goes too.
      // Left running, the old timer dismissed the replacement early — including one
      // sent with delay 0 to stay up until dismissed.
      const previous = timers.current.get(id);
      if (previous) {
        clearTimeout(previous);
        timers.current.delete(id);
      }

      if (item.delay > 0) {
        const timer = setTimeout(() => dismiss(id), item.delay);
        timers.current.set(id, timer);
      }

      return id;
    },
    [config.defaultDelay, config.historyLimit, dismiss],
  );

  // Every pending auto-dismiss is cleared on unmount, so a provider that goes away
  // mid-toast doesn't leave timers firing setState into nothing.
  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const clear = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    setQueue([]);
  }, []);

  const markRead = useCallback((id: string) => {
    setHistory((current) => current.map((item) => (item.id === id ? { ...item, read: true } : item)));
  }, []);

  const clearHistory = useCallback(() => setHistory([]), []);

  const value = useMemo<NotificationsContextValue>(
    () => ({ queue, history, notify, dismiss, clear, markRead, clearHistory }),
    [queue, history, notify, dismiss, clear, markRead, clearHistory],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      {config.enabled ? (
        <ToastStack items={queue} position={config.position} swipeable={config.swipeable} onDismiss={dismiss} />
      ) : null}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error('useNotifications() must be used within the armemon Essentials plugin provider.');
  }
  return ctx;
}
