import type { IAlert } from "./ialert.ts";
import type { Device, DevicePlatform, RegisterOptions, RemotePush } from "./types.ts";

declare const require: ((id: string) => unknown) | undefined;

/** What the native module sends for a notification: its userInfo / data and texts. */
export interface NativePayload {
    userInfo?: Record<string, unknown>;
    title?: string;
    body?: string;
}

/** The plugin's native module (`NativeModules.IAlertPush`), injectable for tests. */
export interface NativeBridge {
    requestPermission(): Promise<boolean>;
    /** Android needs the key and API URL to read the app's push config (iOS ignores them). */
    getToken(config: { publicKey: string; apiUrl: string }): Promise<string | null>;
    takeInitialOpen(): Promise<NativePayload | null>;
    /** Device model and OS version; optional so older native modules keep working. */
    deviceInfo?(): Promise<{ model?: string; osVersion?: string } | null>;
    setRegistration(registration: Record<string, string>): void;
    addListener(event: "onToken" | "onPush" | "onOpen", listener: (value: unknown) => void): void;
}

export interface InitOptions extends Omit<RegisterOptions, "pushToken"> {
    /** Ask for notification permission at start; default true. */
    requestPermission?: boolean;
}

type ReactNative = {
    Platform?: { OS?: string };
    NativeModules?: Record<string, unknown>;
    NativeEventEmitter?: new (module: unknown) => { addListener(event: string, listener: (value: unknown) => void): unknown };
};

function reactNative(): ReactNative | undefined {
    try {
        return typeof require === "function" ? (require("react-native") as ReactNative) : undefined;
    } catch {
        return undefined;
    }
}

/** `Platform.OS` from react-native (resolved lazily so the core stays testable in Node). */
export function currentPlatform(): DevicePlatform {
    const os = reactNative()?.Platform?.OS;

    if (os !== "android" && os !== "ios") {
        throw new Error(`iAlert supports android and ios, not ${os ?? "unknown"}.`);
    }

    return os;
}

/** The linked native module, or null (Expo Go, tests): then Gateway and Inbox only. */
export function defaultBridge(): NativeBridge | null {
    const rn = reactNative();
    const module = rn?.NativeModules?.IAlertPush as Omit<NativeBridge, "addListener"> | undefined;

    if (!module || !rn?.NativeEventEmitter) {
        return null;
    }

    const emitter = new rn.NativeEventEmitter(module);

    return {
        requestPermission: () => module.requestPermission(),
        getToken: (config) => module.getToken(config),
        takeInitialOpen: () => module.takeInitialOpen(),
        deviceInfo: typeof module.deviceInfo === "function" ? () => module.deviceInfo!() : undefined,
        setRegistration: (registration) => module.setRegistration(registration),
        addListener: (event, listener) => {
            emitter.addListener(event, listener);
        },
    };
}

function toPush(value: unknown): RemotePush | null {
    if (value === null || typeof value !== "object") {
        return null;
    }

    const payload = value as NativePayload;

    if (!payload.userInfo || typeof payload.userInfo !== "object") {
        return null;
    }

    return { data: payload.userInfo, notification: { title: payload.title || undefined, body: payload.body || undefined } };
}

/** Wire an `IAlert` to the native module and run the first registration. */
export async function startNative(ialert: IAlert, bridge: NativeBridge | null, options: InitOptions): Promise<Device> {
    const { requestPermission, ...fields } = options;
    let token: string | null = null;
    let info: { model?: string; osVersion?: string } | null = null;
    const register = () =>
        ialert.register({ deviceModel: info?.model, osVersion: info?.osVersion, ...fields, pushToken: token ?? undefined });

    if (bridge === null) {
        return register();
    }

    ialert.onRegistered = (registration) => bridge.setRegistration(registration);
    bridge.addListener("onToken", (value) => {
        if (typeof value === "string" && value !== token) {
            token = value;
            void register().catch(() => undefined);
        }
    });
    bridge.addListener("onPush", (value) => {
        const push = toPush(value);
        if (push) void ialert.didReceivePush(push);
    });
    bridge.addListener("onOpen", (value) => {
        const push = toPush(value);
        if (push) void ialert.didOpenPush(push);
    });

    info = (await bridge.deviceInfo?.().catch(() => null)) ?? null;

    try {
        if (requestPermission !== false) {
            await bridge.requestPermission();
        }
        token = await bridge.getToken({ publicKey: ialert.publicKey, apiUrl: ialert.apiUrl });
    } catch {
        // no permission or no native push: Gateway and Inbox only
    }

    const device = await register();
    const open = toPush(await bridge.takeInitialOpen().catch(() => null));

    if (open) {
        await ialert.didOpenPush(open);
    }

    return device;
}
