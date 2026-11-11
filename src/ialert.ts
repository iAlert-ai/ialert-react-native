import { ApiClient, type InboxEntry } from "./api.ts";
import { IAlertError } from "./errors.ts";
import { GatewayConnection, type WebSocketFactory } from "./gateway.ts";
import { MemoryStorage, Store } from "./storage.ts";
import type { AckEvent, AuthRequestInfo, AuthRequestResult, ConnectionState, Device, DevicePlatform, IAlertMessage, KeyValueStorage, RegisterOptions, RemotePush, TagValue, UpdateOptions } from "./types.ts";

export const SDK_VERSION = "0.4.0";

const TAG_KEY = /^[A-Za-z0-9_.:-]{1,64}$/;
const SEEN_LIMIT = 500;

export interface IAlertOptions {
    /** Public key of the app (`ia_pk_…`); it can only register and manage its own device. */
    publicKey: string;
    /** `android` or `ios`; the package entry point fills it from `Platform.OS`. */
    platform?: DevicePlatform;
    apiUrl?: string;
    gatewayUrl?: string;
    /** Pass `AsyncStorage` so the registration and dedupe survive restarts; defaults to memory. */
    storage?: KeyValueStorage;
    fetch?: typeof globalThis.fetch;
    WebSocket?: WebSocketFactory;
    /** Connect to the Gateway right after `register()`; default true. */
    autoConnect?: boolean;
    /** Ack "delivered" for every message handed to listeners; default true. */
    autoAckDelivered?: boolean;
}

interface Registration {
    deviceId: string;
    deviceToken: string;
}

interface State {
    registration: Registration | null;
    seen: string[];
    installation: string | null;
}

type MessageListener = (message: IAlertMessage) => void;
type StateListener = (state: ConnectionState) => void;

/**
 * iAlert React Native SDK. Registers the app as an `android` / `ios` device,
 * keeps a Gateway socket open while the app runs, syncs the Inbox after every
 * (re)connect and hands each notification to listeners exactly once.
 */
export class IAlert {
    private readonly api: ApiClient;
    private readonly store: Store;
    private readonly options: IAlertOptions;
    private readonly messageListeners = new Set<MessageListener>();
    private readonly stateListeners = new Set<StateListener>();
    private gateway: GatewayConnection | null = null;
    private state: State | null = null;
    private loading: Promise<State> | null = null;
    private syncing: Promise<IAlertMessage[]> | null = null;

    constructor(options: IAlertOptions) {
        if (!options.publicKey.startsWith("ia_pk_")) {
            throw new IAlertError(0, "invalid_public_key", "Use the app's public key (ia_pk_…); secret keys must never ship in apps.");
        }

        if (options.platform !== "android" && options.platform !== "ios") {
            throw new IAlertError(0, "unsupported_platform", "iAlert React Native supports android and ios only.");
        }

        this.options = options;
        const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
        this.api = new ApiClient(options.apiUrl ?? "https://api.ialert.ir/api/v1", options.publicKey, fetchFn);
        this.store = new Store(options.storage ?? new MemoryStorage(), options.publicKey.slice(-12));
    }

    /** The registered device id, or null before `register()` (or before the stored state loaded). */
    get deviceId(): string | null {
        return this.state?.registration?.deviceId ?? null;
    }

    /** Load the stored registration; every method does this itself. */
    async ready(): Promise<void> {
        await this.load();
    }

    /**
     * Register (or re-register) this app install. Safe to call on every launch:
     * the same installation id (or push token) maps to the same device.
     */
    async register(options: RegisterOptions = {}): Promise<Device> {
        const fields = this.deviceFields(options);
        const state = await this.load();
        const result = await this.api.register({
            platform: this.options.platform,
            push_token: options.pushToken ?? (await this.installationId()),
            sdk_version: SDK_VERSION,
            ...fields,
            ...environmentFields(options),
        });

        state.registration = { deviceId: result.data.id, deviceToken: result.device_token };
        await this.store.set("registration", state.registration);

        if (this.options.autoConnect !== false) {
            this.connect();
        }

        return result.data;
    }

    /**
     * Approve or deny an Auth Push sign-in request (see `authRequestOf(message)`).
     * With number matching pass the number the user typed; a wrong one denies.
     */
    async respondToAuthRequest(requestId: string, approve: boolean, code?: string): Promise<AuthRequestResult> {
        const registration = await this.requireRegistration();

        return this.withToken(() => this.api.respondToAuthRequest(registration.deviceId, registration.deviceToken, requestId, approve ? "approve" : "deny", code), false);
    }

    /** Update the external user id, tags (merged) or locale of this device. */
    async update(options: UpdateOptions): Promise<Device> {
        const fields = this.deviceFields(options);
        const registration = await this.requireRegistration();

        return this.withToken(() => this.api.update(registration.deviceId, registration.deviceToken, fields));
    }

    setTags(tags: Record<string, TagValue | null>): Promise<Device> {
        return this.update({ tags });
    }

    setExternalUserId(externalUserId: string | null): Promise<Device> {
        return this.update({ externalUserId });
    }

    /**
     * Hand a native push to the SDK, e.g. from `messaging().onMessage`: listeners get it
     * once, deduplicated against the Gateway and Inbox, and it is acked as delivered.
     * Returns `null` for pushes that are not from iAlert or already seen.
     */
    async didReceivePush(push: RemotePush): Promise<IAlertMessage | null> {
        const message = fromPush(push);

        return message !== null && (await this.receive(message)) ? message : null;
    }

    /** Report a tap on an iAlert notification, e.g. from `messaging().onNotificationOpenedApp`. */
    async didOpenPush(push: RemotePush): Promise<void> {
        const message = fromPush(push);

        if (message === null) {
            return;
        }

        await this.receive(message, false);
        await this.ack([message.id], "clicked");
    }

    /**
     * Join a Live Activity channel so its broadcasts reach this Android device as FCM
     * data messages (read them with `parseLiveActivityUpdate`). Register with the FCM
     * token as `pushToken` first, and subscribe again after it changes. On iOS,
     * subscribe the Live Activity itself with ActivityKit instead.
     */
    subscribeLiveActivity(channelId: string): Promise<void> {
        return this.liveActivity(channelId, true);
    }

    /** Leave a Live Activity channel (Android). */
    unsubscribeLiveActivity(channelId: string): Promise<void> {
        return this.liveActivity(channelId, false);
    }

    private async liveActivity(channelId: string, subscribe: boolean): Promise<void> {
        if (this.options.platform === "ios") {
            throw new IAlertError(0, "platform_not_supported", "On iOS, subscribe the Live Activity with ActivityKit: Activity.request(..., pushType: .channel(channelId)).");
        }

        const registration = await this.requireRegistration();
        await this.withToken(() => this.api.liveActivity(registration.deviceId, registration.deviceToken, channelId, subscribe), false);
    }

    /** Stop receiving notifications; call `register()` to subscribe again. */
    async unsubscribe(): Promise<Device> {
        const registration = await this.requireRegistration();
        this.disconnect();

        return this.withToken(() => this.api.unsubscribe(registration.deviceId, registration.deviceToken));
    }

    /** Open the Gateway socket (done by `register()` unless `autoConnect: false`). Needs a loaded registration. */
    connect(): void {
        const registration = this.state?.registration;
        const WebSocketImpl = this.options.WebSocket ?? globalThis.WebSocket;

        if (registration == null) {
            throw new IAlertError(0, "not_registered", "Call register() (or await ready()) first.");
        }

        if (this.gateway !== null || WebSocketImpl === undefined) {
            return;
        }

        this.gateway = new GatewayConnection({
            url: this.options.gatewayUrl ?? "wss://gw.ialert.ir/v1/connect",
            deviceToken: registration.deviceToken,
            WebSocket: WebSocketImpl,
            handlers: {
                onReady: () => {
                    void this.syncInbox().catch(() => undefined);
                },
                onMessage: (message) => {
                    void this.receive(fromGateway(message));
                },
                onUnauthorized: () => {
                    this.gateway = null;
                    void this.forget();
                    this.emitState("closed");
                },
                onStateChange: (state) => this.emitState(state),
            },
        });
        this.gateway.start();
    }

    disconnect(): void {
        this.gateway?.stop();
        this.gateway = null;
    }

    /** Pull unread Inbox entries and hand the new ones to listeners. Concurrent calls share one request. */
    syncInbox(): Promise<IAlertMessage[]> {
        this.syncing ??= this.pullInbox().finally(() => {
            this.syncing = null;
        });

        return this.syncing;
    }

    /** Report that the user read or clicked notifications (by notification id). */
    async ack(ids: string[], event: AckEvent): Promise<void> {
        if (ids.length === 0) {
            return;
        }

        const registration = await this.requireRegistration();

        if (this.gateway?.isReady) {
            this.gateway.ack(ids, event);

            return;
        }

        await this.withToken(() => this.api.ack(registration.deviceId, registration.deviceToken, ids, event));
    }

    /** Listen for notifications; returns a function that removes the listener. */
    onMessage(listener: MessageListener): () => void {
        this.messageListeners.add(listener);

        return () => this.messageListeners.delete(listener);
    }

    onConnectionStateChange(listener: StateListener): () => void {
        this.stateListeners.add(listener);

        return () => this.stateListeners.delete(listener);
    }

    private load(): Promise<State> {
        if (this.state !== null) {
            return Promise.resolve(this.state);
        }

        this.loading ??= (async () => {
            const [registration, seen, installation] = await Promise.all([
                this.store.get<Registration>("registration"),
                this.store.get<string[]>("seen"),
                this.store.get<string>("installation"),
            ]);
            this.state = { registration, seen: seen ?? [], installation };

            return this.state;
        })();

        return this.loading;
    }

    private async pullInbox(): Promise<IAlertMessage[]> {
        const registration = await this.requireRegistration();
        const entries = await this.withToken(() => this.api.inbox(registration.deviceId, registration.deviceToken, true));
        const received: IAlertMessage[] = [];

        // Oldest first, so listeners see messages in the order they were sent.
        for (const entry of [...entries].reverse()) {
            const message = fromInbox(entry);

            if (await this.receive(message, false)) {
                received.push(message);
            }
        }

        if (this.options.autoAckDelivered !== false) {
            const undelivered = entries.filter((entry) => entry.delivered_at === null).map((entry) => entry.id);
            await this.ack(undelivered, "delivered").catch(() => undefined);
        }

        return received;
    }

    /** Dedupe by notification id across Gateway, Inbox and restarts. */
    private async receive(message: IAlertMessage, ack = true): Promise<boolean> {
        const state = await this.load();

        if (state.seen.includes(message.id)) {
            return false;
        }

        state.seen.push(message.id);
        state.seen = state.seen.slice(-SEEN_LIMIT);
        void this.store.set("seen", state.seen);

        for (const listener of this.messageListeners) {
            try {
                listener(message);
            } catch (error) {
                setTimeout(() => {
                    throw error;
                }, 0);
            }
        }

        if (ack && this.options.autoAckDelivered !== false) {
            void this.ack([message.id], "delivered").catch(() => undefined);
        }

        return true;
    }

    private deviceFields(options: UpdateOptions): Record<string, unknown> {
        const fields: Record<string, unknown> = {};

        if (options.externalUserId !== undefined) {
            fields.external_user_id = options.externalUserId;
        }

        if (options.tags !== undefined) {
            const invalid = Object.keys(options.tags).filter((key) => !TAG_KEY.test(key));

            if (invalid.length > 0) {
                throw new IAlertError(0, "invalid_tag_key", `Tag keys must match [A-Za-z0-9_.:-]{1,64}: ${invalid.join(", ")}`);
            }

            fields.tags = options.tags;
        }

        if (options.locale !== undefined) {
            fields.locale = options.locale;
        }

        if (options.timezone !== undefined) {
            fields.timezone = options.timezone;
        }

        if (options.appVersion !== undefined) {
            fields.app_version = options.appVersion;
        }

        return fields;
    }

    private async installationId(): Promise<string> {
        const state = await this.load();

        if (state.installation === null) {
            state.installation = `ia_rn_${uuid()}`;
            await this.store.set("installation", state.installation);
        }

        return state.installation;
    }

    private async requireRegistration(): Promise<Registration> {
        const registration = (await this.load()).registration;

        if (registration === null) {
            throw new IAlertError(0, "not_registered", "Call register() first.");
        }

        return registration;
    }

    private async forget(): Promise<void> {
        const state = await this.load();
        state.registration = null;
        await this.store.remove("registration");
    }

    /**
     * A rejected device token means the device was deleted or unsubscribed elsewhere.
     * A 404 means the same, except where the path also names another resource (a channel).
     */
    private async withToken<T>(call: () => Promise<T>, forgetOnNotFound = true): Promise<T> {
        try {
            return await call();
        } catch (error) {
            if (error instanceof IAlertError && (error.code === "device_token_invalid" || (forgetOnNotFound && error.status === 404))) {
                this.disconnect();
                await this.forget();
            }

            throw error;
        }
    }

    private emitState(state: ConnectionState): void {
        for (const listener of this.stateListeners) {
            listener(state);
        }
    }
}

function fromGateway(message: Record<string, unknown>): IAlertMessage {
    const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

    return {
        id: String(message.id),
        title: text(message.title),
        body: text(message.body),
        image: text(message.image),
        data: message.data !== null && typeof message.data === "object" && !Array.isArray(message.data) ? (message.data as Record<string, unknown>) : {},
        collapse_id: text(message.collapse_id),
        created_at: text(message.created_at),
        source: "gateway",
    };
}

function fromInbox(entry: InboxEntry): IAlertMessage {
    const data = entry.content.data;

    return {
        id: entry.id,
        title: entry.content.title,
        body: entry.content.body,
        image: entry.content.image,
        data: data !== null && !Array.isArray(data) ? data : {},
        collapse_id: entry.collapse_id,
        created_at: entry.created_at,
        source: "inbox",
    };
}

/** Locale and timezone from Intl when the caller does not set them (Hermes has Intl). */
function environmentFields(options: RegisterOptions): Record<string, unknown> {
    const fields: Record<string, unknown> = {};

    try {
        const resolved = Intl.DateTimeFormat().resolvedOptions();

        if (options.locale === undefined && resolved.locale) {
            fields.locale = resolved.locale;
        }

        if (options.timezone === undefined && resolved.timeZone) {
            fields.timezone = resolved.timeZone;
        }
    } catch {
        // ignore
    }

    return fields;
}

/** RFC 4122 v4; Hermes has no crypto.randomUUID, so fall back to getRandomValues or Math.random. */
function uuid(): string {
    const bytes = new Uint8Array(16);
    const crypto = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto;

    if (crypto?.getRandomValues) {
        crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < 16; i++) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
    }

    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** FCM data carries `ialert_id`; an APNs payload carries an `ialert` object. */
function fromPush(push: RemotePush): IAlertMessage | null {
    const data = push.data ?? {};
    const apns = data.ialert !== null && typeof data.ialert === "object" ? (data.ialert as Record<string, unknown>) : null;
    const id = typeof data.ialert_id === "string" ? data.ialert_id : typeof apns?.id === "string" ? apns.id : null;

    if (id === null || id === "") {
        return null;
    }

    const { ialert_id: _ignored, ...custom } = data;
    const payload = apns !== null ? (apns.data !== null && typeof apns.data === "object" ? (apns.data as Record<string, unknown>) : {}) : custom;

    return {
        id,
        title: push.notification?.title ?? null,
        body: push.notification?.body ?? null,
        image: push.notification?.android?.imageUrl ?? (typeof apns?.image === "string" ? apns.image : null),
        data: payload,
        collapse_id: null,
        created_at: null,
        source: "push",
    };
}

/** The Auth Push request a message carries, or `null` for other messages. */
export function authRequestOf(message: { data: Record<string, unknown> }): AuthRequestInfo | null {
    const data = message.data;

    if (data.ialert_type !== "auth_request" || typeof data.auth_request_id !== "string") {
        return null;
    }

    const reserved = new Set(["ialert_type", "auth_request_id", "number_matching", "expires_at"]);
    const context: Record<string, string> = {};

    for (const [key, value] of Object.entries(data)) {
        if (!reserved.has(key) && typeof value === "string") {
            context[key] = value;
        }
    }

    return {
        id: data.auth_request_id,
        numberMatching: data.number_matching === "1" || data.number_matching === true,
        expiresAt: typeof data.expires_at === "string" ? data.expires_at : null,
        context,
    };
}
