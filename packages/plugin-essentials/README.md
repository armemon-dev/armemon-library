# @armemon-library/essentials

Notifications, network monitoring, and loading/error overlays for armemon-scaffolded apps.

Toast notifications, network monitoring, and a loading/error overlay.

Each sub-feature is independently switchable. Network monitoring lives behind a
separate entry point so `@react-native-community/netinfo` is only resolved when
it's on:

```ts
import { netInfoAdapter } from '@armemon-library/essentials/netinfo';
```

Hooks: `useNotifications()`, `useNetworkStatus()`, `useLoading()`.

---

Part of [armemon](https://github.com/armemon-dev/armemon-library) — interactive React Native scaffolding.
MIT © Ahmed Raza Memon
