# Changelog

## 0.8.0

- **Device binding:** every registration sends `device_binding: true` and the stored `X-Device-Token`, so only this install can re-register its device. Another install that learns the push token or installation id (or a reinstall) gets a new, empty device instead of taking this one over (needs iAlert server with device binding).

## 0.7.0

- `IAlertMessage.sender` / `IAlertSender`: conversation notifications with the sender's photo on Android (Android SDK 0.7.0) and, with `IAlertNotificationService`, on iOS. FCM data-only messages carry their content in `ialert_*` keys.

## 0.6.1

- iOS: the last APNs token is kept across launches, so a launch that registers before the token arrives no longer replaces it with the installation id (pushes stopped arriving while the app was closed).

## 0.6.0

- Notification links: `IAlertMessage.url` (from `url`, `ialert_url` or `ialert.url`, falling back to `data.url`), opened on tap by the native side; deep links reach `Linking`.
- Registration sends a stable `installation_id` and the device model and OS version from the native module (`deviceInfo`), so one install stays one device. Android SDK 0.6.0.

## 0.5.1

- iOS background sync skips `pushed` entries (APNs showed them) and leaves them unacknowledged, so they are shown once the platform switches to its internal network.

## 0.5.0

- Ships its own native module: `IAlert.init()` sets up push without `@react-native-firebase/messaging` or AppDelegate code.
- iOS: permission, APNs token, foreground display, taps (opens `data.url`) and background Inbox sync as local notifications when `<bundle id>.ialert-sync` is permitted.
- Custom notification sounds in background-sync notifications on iOS (`none` is silent).
- Android, on the iAlert Android SDK 0.5.0: FCM token of the app's own Firebase project, whose service account and `google-services.json` are uploaded in the iAlert panel (no Firebase setup in the app), notifications with image and custom sound, taps (open `data.url`), background sync every 15 minutes for messages FCM could not deliver, and Live Activity broadcasts as ongoing notifications. `minSdk` 24.
- `IAlert.publicKey` and `IAlert.apiUrl` getters; the native `getToken` takes `{ publicKey, apiUrl }`.

## 0.4.0

- Auth Push: `respondToAuthRequest` approves or denies a sign-in request on this device (with the typed number for number matching), and a helper reads the request a message carries.

## 0.3.0

- Native push: `didReceivePush(message)` and `didOpenPush(message)` take `@react-native-firebase/messaging` messages (FCM data with `ialert_id`, or an APNs `ialert` payload), deduplicate them against the Gateway and Inbox, and ack delivered / clicked.

## 0.2.0

- Live Activity broadcasts on Android: `subscribeLiveActivity(channelId)` / `unsubscribeLiveActivity(channelId)` (iOS rejects with `platform_not_supported`; subscribe with ActivityKit there), and `parseLiveActivityUpdate(data)` reads the broadcast from an FCM data message.
- A 404 for an unknown channel no longer clears the device registration.

## 0.1.0

- First release: device registration with a public key, tags and external user id, a live connection to the iAlert Gateway over WebSocket with reconnect, Inbox sync after each connect, delivered/read/clicked acknowledgements and message de-duplication.
- Licensed under Apache 2.0.
