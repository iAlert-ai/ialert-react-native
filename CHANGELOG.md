# Changelog

## 0.3.0

- Native push: `didReceivePush(message)` and `didOpenPush(message)` take `@react-native-firebase/messaging` messages (FCM data with `ialert_id`, or an APNs `ialert` payload), deduplicate them against the Gateway and Inbox, and ack delivered / clicked.

## 0.2.0

- Live Activity broadcasts on Android: `subscribeLiveActivity(channelId)` / `unsubscribeLiveActivity(channelId)` (iOS rejects with `platform_not_supported`; subscribe with ActivityKit there), and `parseLiveActivityUpdate(data)` reads the broadcast from an FCM data message.
- A 404 for an unknown channel no longer clears the device registration.

## 0.1.0

- First release: device registration with a public key, tags and external user id, a live connection to the iAlert Gateway over WebSocket with reconnect, Inbox sync after each connect, delivered/read/clicked acknowledgements and message de-duplication.
- Licensed under Apache 2.0.
