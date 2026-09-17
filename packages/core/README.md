# @armemon-library/core

Runtime for armemon-scaffolded apps — task-orchestration init engine and plugin provider chain.

The runtime that ships inside an armemon-scaffolded app: a three-phase init
engine and the plugin provider chain.

```tsx
import { KitProvider } from '@armemon-library/core';
import './armemon/runtime.generated';

export default function App() {
  return <KitProvider><RootNavigator /></KitProvider>;
}
```

`KitProvider` takes no props. It reads the config that
`armemon/runtime.generated.ts` registered, runs every init task behind a
splash screen, and renders the plugin providers in `index` order once they
finish. A failure anywhere — including a render error in any plugin or screen —
lands on the configured error screen rather than a red screen.

### Init tasks

Add your own in `armemon/runtime.config.ts` (written once, never
overwritten):

```ts
import { TaskPresets } from '@armemon-library/core';

export const userTasks = [
  async () => { await warmCache(); },
  TaskPresets.network({
    name: 'fetch-config',
    task: async (ctx) => { await ctx.abortable(fetch('/config')); },
  }),
];
```

Tasks support `phase`, `timeout`, `retries`, `retryStrategy`, `critical`,
`background`, `parallel`, `group`, `runIf`, `id` and `dependsOn`. Timeouts are
enforced whether or not a task cooperates with `ctx.signal`.

### Hooks

`useTaskProgress()` for live init progress, `useKitReady()` for the
`readyCustom` escape hatch.

---

Part of [armemon](https://github.com/armemon-dev/armemon-library) — interactive React Native scaffolding.
MIT © Ahmed Raza Memon
