import { IAlert, type IAlertOptions } from "./ialert.ts";
import type { DevicePlatform } from "./types.ts";

export { IAlert, SDK_VERSION, type IAlertOptions } from "./ialert.ts";
export { IAlertError } from "./errors.ts";
export { MemoryStorage } from "./storage.ts";
export type { AckEvent, ConnectionState, Device, DevicePlatform, IAlertMessage, KeyValueStorage, RegisterOptions, TagValue, UpdateOptions } from "./types.ts";

declare const require: ((id: string) => unknown) | undefined;

/** `Platform.OS` from react-native (resolved lazily so the core stays testable in Node). */
export function currentPlatform(): DevicePlatform {
    const reactNative = typeof require === "function" ? (require("react-native") as { Platform?: { OS?: string } }) : undefined;
    const os = reactNative?.Platform?.OS;

    if (os !== "android" && os !== "ios") {
        throw new Error(`iAlert supports android and ios, not ${os ?? "unknown"}.`);
    }

    return os;
}

/** Create the SDK for the current platform: `createIAlert({ publicKey, storage: AsyncStorage })`. */
export function createIAlert(options: Omit<IAlertOptions, "platform"> & { platform?: DevicePlatform }): IAlert {
    return new IAlert({ ...options, platform: options.platform ?? currentPlatform() });
}
