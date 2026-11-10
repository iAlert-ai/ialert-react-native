# ialert-react-native

iAlert React Native SDK. It registers the app as an `android` or `ios` device and receives notifications while the app runs, over iAlert's own channel: a WebSocket to the iAlert Gateway, plus the device Inbox for anything sent while the app was closed. Each notification reaches your listeners once, across both channels and restarts. No runtime dependencies.

## Install

```bash
npm install ialert-react-native
```

## Usage

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createIAlert } from "ialert-react-native";

const ialert = createIAlert({ publicKey: "ia_pk_live_…", storage: AsyncStorage });

ialert.onMessage((message) => showBanner(message.title, message.body, message.data));
ialert.onConnectionStateChange((state) => console.log(state)); // connecting | ready | closed

await ialert.register({ externalUserId: "user-42", tags: { plan: "gold" } });

await ialert.setTags({ plan: "silver", trial: null }); // merged; null removes
await ialert.ack([message.id], "clicked");
await ialert.unsubscribe();
```

- Use the app's **public** key (`ia_pk_…`); secret keys are refused.
- The platform comes from `Platform.OS`. `register({ pushToken })` sends your FCM/APNs token; without one, a stable installation id is used.
- `storage` accepts anything with async `getItem` / `setItem` / `removeItem`. Pass `AsyncStorage` (an optional peer dependency). Without it, the registration and dedupe only last for the current run.
- `delivered` is acked automatically (`autoAckDelivered: false` turns it off). Report `read` / `clicked` yourself.
- Other options: `apiUrl`, `gatewayUrl`, `fetch`, `WebSocket`, `autoConnect`. After a restart, call `register()` again, or `await ialert.ready()` then `connect()`.

## Next step: native push

0.1.0 delivers only while the app runs. Next comes FCM/APNs integration (for example with `@react-native-firebase/messaging`): pass the token to `register({ pushToken })`, and dedupe provider pushes by their `ialert_id` field against Gateway/Inbox messages.

## Development

```bash
npm install
npm test          # node --test, no device needed
npm run typecheck
npm run build     # dist/
```

API reference: `docs/api-v1.md` in the iAlert server repository.

## License

Copyright 2026 iAlert.ir

Licensed under the [Apache License, Version 2.0](LICENSE). See [NOTICE](NOTICE).
