# @armemon-library/redux

Redux Toolkit plugin for armemon — store, optional AsyncStorage persistence, and starter slice templates.

Redux Toolkit for armemon apps: store setup, optional AsyncStorage
persistence, and starter slice templates (counter, auth, user, todos).

Persistence lives behind a separate entry point so `redux-persist` and
AsyncStorage are only resolved — and only need installing — when it's enabled:

```ts
import { persistAdapter } from '@armemon-library/redux/persist';
```

Re-exports `useSelector`, `useDispatch`, `useStore`, `createSlice`,
`createAsyncThunk` and `nanoid` (RTK's, which works under Hermes).

---

Part of [armemon](https://github.com/armemon-dev/armemon-library) — interactive React Native scaffolding.
MIT © Ahmed Raza Memon
