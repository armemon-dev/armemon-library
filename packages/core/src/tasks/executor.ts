/**
 * FILE: executor.ts
 * PATH: packages/core/src/tasks/executor.ts
 *
 * WHAT: Runs a single TaskObject with an enforced timeout, retry/backoff, and
 *       runIf-based conditional skipping.
 * WHY:  Real init tasks fail transiently (a flaky network call, a slow first cold
 *       start), so retry/backoff lives here rather than in every task. Non-critical
 *       failures are logged, not thrown, so one optional feature can't take the app
 *       down.
 *
 *       Three things this file previously got wrong, all of which surface as "the
 *       splash screen never goes away":
 *       1. The timeout aborted a signal but never RACED the task against it, so a
 *          task that didn't voluntarily check ctx.signal ran forever — which is most
 *          tasks, making the 180s default timeout a no-op. It's a real race now, and
 *          ctx.abortable() remains the cooperative path for tasks that can cancel
 *          actual work rather than just being abandoned.
 *       2. ctx.abortable() attached an 'abort' listener, which never fires on an
 *          ALREADY-aborted signal — so calling it after the deadline produced a race
 *          against a promise that could never settle. It now checks signal.aborted
 *          first, and removes its listener afterwards instead of leaking one per call.
 *       3. runIf() was awaited outside the try, so a predicate that threw bypassed
 *          both the retry loop and the `critical: false` escape hatch and took the
 *          whole app to the error screen.
 * HOW:  Per attempt: a fresh AbortController, a timer that both aborts it and
 *       rejects the race, and a finally that always clears the timer and detaches
 *       listeners. Backoff is linear or exponential, capped at maxRetryDelay.
 * WHEN: Called once per task by phaseRunner.ts, for both blocking and background
 *       tasks.
 *
 * EXPORTS: executeTaskWithRetries, TaskTimeoutError
 * DEPENDS ON: @armemon-library/config-types
 * USED BY: packages/core/src/init/phaseRunner.ts
 */

import type { TaskExecutionContext, TaskObject } from '@armemon-library/config-types';

export class TaskTimeoutError extends Error {
  constructor(taskName: string, timeoutMs: number) {
    super(`Task "${taskName}" timed out after ${timeoutMs}ms.`);
    this.name = 'TaskTimeoutError';
  }
}

function computeRetryDelay(task: TaskObject, attempt: number): number {
  const base = task.retryDelay ?? 1000;
  const max = task.maxRetryDelay ?? 30000;
  const delay = task.retryStrategy === 'exponential' ? base * 2 ** attempt : base * (attempt + 1);
  return Math.min(delay, max);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface AttemptHarness {
  ctx: TaskExecutionContext;
  /** Rejects with TaskTimeoutError when the deadline passes. Never resolves. */
  deadline: Promise<never>;
  dispose: () => void;
}

function createAttempt(task: TaskObject, timeoutMs: number): AttemptHarness {
  const controller = new AbortController();
  const listeners: Array<() => void> = [];
  let rejectDeadline: ((error: Error) => void) | undefined;
  let settled = false;

  const deadline = new Promise<never>((_, reject) => {
    rejectDeadline = reject;
  });
  // A rejection nobody is racing yet must not surface as an unhandled rejection —
  // it always ends up inside a Promise.race below, but only after this tick.
  deadline.catch(() => {});

  const timeoutId = setTimeout(() => {
    if (settled) return;
    controller.abort();
    rejectDeadline?.(new TaskTimeoutError(task.name, timeoutMs));
  }, timeoutMs);

  const ctx: TaskExecutionContext = {
    signal: controller.signal,
    abortable<T>(promise: Promise<T>): Promise<T> {
      // Already past the deadline: an 'abort' listener would never fire, so the
      // race would hang forever. Reject straight away instead.
      if (controller.signal.aborted) {
        return Promise.reject(new TaskTimeoutError(task.name, timeoutMs));
      }

      return new Promise<T>((resolve, reject) => {
        const onAbort = (): void => reject(new TaskTimeoutError(task.name, timeoutMs));
        controller.signal.addEventListener('abort', onAbort, { once: true });
        const detach = (): void => controller.signal.removeEventListener('abort', onAbort);
        listeners.push(detach);
        promise.then(
          (value) => {
            detach();
            resolve(value);
          },
          (error: unknown) => {
            detach();
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      });
    },
  };

  return {
    ctx,
    deadline,
    dispose: () => {
      settled = true;
      clearTimeout(timeoutId);
      for (const detach of listeners) detach();
      listeners.length = 0;
    },
  };
}

export async function executeTaskWithRetries(task: TaskObject): Promise<void> {
  const maxAttempts = Math.max(1, (task.retries ?? 0) + 1);
  const timeoutMs = task.timeout ?? 180000;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const harness = createAttempt(task, timeoutMs);

    try {
      // Inside the try so a throwing predicate is retried and honours `critical`,
      // rather than escaping past both.
      if (task.runIf) {
        const shouldRun = await Promise.race([Promise.resolve(task.runIf()), harness.deadline]);
        if (!shouldRun) return;
      }

      await Promise.race([Promise.resolve(task.task(harness.ctx)), harness.deadline]);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts - 1) {
        await sleep(computeRetryDelay(task, attempt));
      }
    } finally {
      harness.dispose();
    }
  }

  if (task.critical === false) {
    console.warn(
      `[armemon] Non-critical task "${task.name}" failed after ${maxAttempts} attempt(s):`,
      lastError,
    );
    return;
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
