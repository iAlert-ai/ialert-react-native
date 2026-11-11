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

## Live Activity broadcasts

One push from your server updates a live notification on every subscribed device (scores, deliveries, flights). Your server creates the channel with `POST /v1/live-activity-channels` and gives its `id` to the app.

**Android** joins through iAlert, with the FCM token from `@react-native-firebase/messaging`:

```ts
import messaging from "@react-native-firebase/messaging";
import { parseLiveActivityUpdate } from "ialert-react-native";

await ialert.register({ pushToken: await messaging().getToken() });
await ialert.subscribeLiveActivity(channelId); // and unsubscribeLiveActivity(channelId)

messaging().onMessage(async (message) => {
    const update = parseLiveActivityUpdate(message.data);
    if (!update) return; // not a Live Activity update
    // show or update one ongoing notification per update.channelId (e.g. with Notifee),
    // and remove it when update.event === "end"
});
```

Subscribe again when FCM issues a new token (`onTokenRefresh`).

**iOS** subscribes the Live Activity itself with ActivityKit in native code, using the channel's `channel_id`: `Activity.request(attributes:content:pushType: .channel(channelId))`. `subscribeLiveActivity` rejects with `platform_not_supported` on iOS.

## Native push (notifications while the app is closed)

Use `@react-native-firebase/messaging` for the native side and give iAlert the token it needs: the **FCM token on Android** and the **APNs token on iOS** (iAlert sends to APNs directly with your `.p8`).

```ts
import messaging from "@react-native-firebase/messaging";
import { Platform } from "react-native";

await messaging().requestPermission();
const token = Platform.OS === "ios" ? await messaging().getAPNSToken() : await messaging().getToken();
await ialert.register({ pushToken: token ?? undefined, externalUserId: "user-42" });

messaging().onMessage((message) => ialert.didReceivePush(message)); // deduplicated, acked delivered
messaging().onNotificationOpenedApp((message) => ialert.didOpenPush(message)); // acked clicked
```

Register again when FCM issues a new token (`onTokenRefresh`). Without a native token the device still gets messages while the app runs (Gateway) and on the next launch (Inbox). Background Inbox sync with local notifications during an internet shutdown needs the native SDKs and is not part of this package yet.

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
