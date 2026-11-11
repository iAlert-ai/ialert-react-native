# ialert-react-native

iAlert React Native SDK. It registers the app as an `android` or `ios` device and receives notifications while the app runs, over iAlert's own channel: a WebSocket to the iAlert Gateway, plus the device Inbox for anything sent while the app was closed. Each notification reaches your listeners once, across both channels and restarts. No runtime dependencies.

## Install

```bash
npm install ialert-react-native
```

## Quick start

No Firebase or other packages, and no AppDelegate / MainApplication code. Install, then (iOS) `cd ios && pod install`:

```ts
import { IAlert } from "ialert-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const ialert = IAlert.init({ publicKey: "ia_pk_live_…", storage: AsyncStorage, externalUserId: "user-42" });
ialert.onMessage((m) => console.log(m.title, m.body)); // optional
```

`init` asks for notification permission, gets the native push token from this package's own native module, registers, keeps the Gateway connected, shows iAlert notifications while the app is open, reports taps (and opens `data.url`) and syncs the Inbox. `await ialert.initialized` for the device.

**iOS** needs two things Apple does not let a package do: the **Push Notifications** capability in Xcode, and the app's APNs key (`.p8`) in the iAlert panel. For delivery during an internet shutdown, also enable **Background Modes → Background fetch** and add `<bundle id>.ialert-sync` under `BGTaskSchedulerPermittedIdentifiers` in Info.plist; missed Inbox messages are then shown as local notifications in the background (iOS decides when).

**Custom sound:** put the sound file in the app (iOS: add `order.caf` to the Runner target; Android: `res/raw/order.mp3`) and send with `"sound": "order.caf"`. `"sound": "none"` is silent.

**Android:** nothing to configure. The native module uses the iAlert Android SDK: an FCM token from iAlert's shared Firebase project (or your own, once you upload its service account in the panel), so no `google-services.json` or Firebase plugin; notifications with images and custom sounds; taps open `data.url`; and a background sync every 15 minutes shows messages that could not be pushed while FCM is unreachable. The app's `minSdk` must be 23 or later.

## Usage (manual)

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

**Android** joins through iAlert once `IAlert.init` has registered the device with its FCM token:

```ts
await ialert.initialized;
await ialert.subscribeLiveActivity(channelId); // and unsubscribeLiveActivity(channelId)
```

The native module shows each channel as one ongoing notification, updated in place and removed when the broadcast ends. (Using `@react-native-firebase/messaging` yourself instead, `parseLiveActivityUpdate(message.data)` reads a broadcast.)

Subscribe again when FCM issues a new token (`onTokenRefresh`).

**iOS** subscribes the Live Activity itself with ActivityKit in native code, using the channel's `channel_id`: `Activity.request(attributes:content:pushType: .channel(channelId))`. `subscribeLiveActivity` rejects with `platform_not_supported` on iOS.

## Auth Push (approve a sign-in on the phone)

When your server creates an Auth Push request (`POST /v1/auth-requests`), every device of that user gets a high-priority push. Show your own approve/deny screen and answer with the device's token:

```ts
ialert.onMessage(async (message) => {
    const request = authRequestOf(message); // null for other messages
    if (!request) return;
    // show your approve/deny screen with request.context (ip, city, device…)
    await ialert.respondToAuthRequest(request.id, userApproved, request.numberMatching ? typedNumber : undefined);
});
```

With number matching, the user types the two-digit number shown on your sign-in page; a wrong number denies the request. An unknown or expired request throws without clearing the device registration.

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
