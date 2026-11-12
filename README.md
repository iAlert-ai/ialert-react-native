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

`init` asks for notification permission, gets the native push token from this package's own native module, registers, keeps the Gateway connected, shows iAlert notifications while the app is open, reports taps (and opens the message's `url`) and syncs the Inbox. `await ialert.initialized` for the device.

**iOS** needs two things Apple does not let a package do: the **Push Notifications** capability in Xcode, and the app's APNs key (`.p8`) in the iAlert panel. For delivery during an internet shutdown, also enable **Background Modes → Background fetch** and add `<bundle id>.ialert-sync` under `BGTaskSchedulerPermittedIdentifiers` in Info.plist; missed Inbox messages are then shown as local notifications in the background (iOS decides when).

**Custom sound:** put the sound file in the app (iOS: add `order.caf` to the Runner target; Android: `res/raw/order.mp3`) and send with `"sound": "order.caf"`. `"sound": "none"` is silent.

**Android:** nothing to configure in the app. For Android's official push (FCM), upload your Firebase project's service account JSON and its `google-services.json` in the iAlert panel; the native module (on the iAlert Android SDK) then gets the FCM token with no `google-services.json` or Firebase plugin in the app. Without them, devices get messages over the iAlert Gateway, the Inbox and the background sync. It also brings notifications with images and custom sounds; taps open the message's `url`; and a background sync every 15 minutes shows messages that could not be pushed while FCM is unreachable. The app's `minSdk` must be 23 or later.

## Notification links and deep links

Send a notification with `url` (API field or the panel's "Link on click"). On tap the native side
acks the click and opens it: `https://…` opens the browser (or a verified App Link / Universal
Link), and a deep link with your app's scheme (`myapp://orders/42`) comes back into your app.
Register the scheme as usual (Android intent filter, iOS URL Types) and route it with
React Native's `Linking` (`Linking.getInitialURL()` and `Linking.addEventListener('url', …)`). `IAlertMessage.url` carries the link for messages you handle in
`onMessage`; older messages with `data.url` behave the same.

## Conversation notifications (sender photo)

Send a message with a `sender` and it is shown like a chat message: the sender's photo and name in place of the app icon (the app icon becomes a small badge).

```json
{ "title": "New message", "body": "Your order is ready", "sender": { "id": "chat-7", "name": "Sara", "avatar": "https://cdn.example.com/u/7.jpg" }, "target": { "type": "all" } }
```

`sender.name` is required, `avatar` is an HTTPS image (square, 192×192 or larger), `id` keeps one sender's messages together (the name when omitted). The panel has the same fields. `message.sender` carries it in code.

**Android:** nothing to do (the iAlert Android SDK 0.7.0 does it). The SDK shows it with `MessagingStyle` and a long-lived conversation shortcut, so Android 11+ lists it under Conversations with the round photo; older versions show the photo as the large icon. These messages arrive as high-priority FCM data messages; after a Force stop (or on some aggressive battery savers) Android holds them back, and the background sync or the next launch shows them from the Inbox. The conversation shortcut opens your launcher activity with the `ialert_sender_id` extra (`AndroidNotifier.EXTRA_SENDER_ID`), so you can open that chat.

**iOS** (in `ios/<App>.xcworkspace`):

1. Add a **Notification Service Extension** target (File → New → Target), add the `IAlertNotificationService` product of `https://github.com/iAlert-ai/ialert-ios` to it (Swift Package Manager works next to CocoaPods), set its deployment target to iOS 15+, and make its class:

   ```swift
   import IAlertNotificationService

   class NotificationService: IAlertNotificationService {}
   ```

2. On the **app** target: Signing & Capabilities → + Capability → **Communication Notifications**.
3. In the **app's** `Info.plist`:

   ```xml
   <key>NSUserActivityTypes</key>
   <array>
       <string>INSendMessageIntent</string>
   </array>
   ```

Without steps 2–3 iOS shows the message as a normal notification (with the app icon and the image), so nothing is lost.

The same extension also attaches the message `image` on iOS.

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
