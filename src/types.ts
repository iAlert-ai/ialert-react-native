export type TagValue = string | number | boolean;

/** Device as returned by the iAlert API (the push token itself is never returned). */
export interface Device {
    id: string;
    platform: "android" | "ios" | "web";
    push_token_suffix: string;
    external_user_id: string | null;
    tags: Record<string, TagValue>;
    locale: string | null;
    timezone: string | null;
    app_version: string | null;
    sdk_version: string | null;
    device_model: string | null;
    os_version: string | null;
    subscribed: boolean;
    unsubscribed_at: string | null;
    last_seen_at: string | null;
    created_at: string;
    updated_at: string;
}

/** A notification as received from the Gateway or the Inbox; `id` is the notification id. */
export interface IAlertMessage {
    id: string;
    title: string | null;
    body: string | null;
    image: string | null;
    data: Record<string, unknown>;
    collapse_id: string | null;
    created_at: string | null;
    /** Where the SDK got it first. */
    source: "gateway" | "inbox" | "push";
}

export type AckEvent = "delivered" | "read" | "clicked";

export interface RegisterOptions {
    externalUserId?: string | null;
    /** Merged into existing tags; `null` removes a tag. */
    tags?: Record<string, TagValue | null>;
    locale?: string;
    timezone?: string;
    appVersion?: string;
    /** FCM (Android) or APNs (iOS) token once native push is wired; defaults to a stable installation id. */
    pushToken?: string;
}

export interface UpdateOptions {
    externalUserId?: string | null;
    tags?: Record<string, TagValue | null>;
    locale?: string;
    timezone?: string;
    appVersion?: string;
}

/** Async key/value storage; `@react-native-async-storage/async-storage` matches it. */
export interface KeyValueStorage {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
}

export type ConnectionState = "idle" | "connecting" | "ready" | "closed";
export type DevicePlatform = "android" | "ios";

/** The fields of a `@react-native-firebase/messaging` RemoteMessage that iAlert reads. */
export interface RemotePush {
    data?: Record<string, unknown>;
    notification?: { title?: string; body?: string; android?: { imageUrl?: string } };
}
