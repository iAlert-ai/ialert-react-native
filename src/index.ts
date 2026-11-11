import { IAlert, type IAlertOptions } from "./ialert.ts";
import { currentPlatform } from "./native.ts";
import type { DevicePlatform } from "./types.ts";

export { IAlert, SDK_VERSION, authRequestOf, type IAlertOptions } from "./ialert.ts";
export { IAlertError } from "./errors.ts";
export { currentPlatform, type InitOptions, type NativeBridge, type NativePayload } from "./native.ts";
export { MemoryStorage } from "./storage.ts";
export { parseLiveActivityUpdate, type LiveActivityUpdate } from "./liveActivity.ts";
export type {
    AuthRequestInfo,
    AuthRequestResult, AckEvent, ConnectionState, Device, DevicePlatform, IAlertMessage, KeyValueStorage, RegisterOptions, RemotePush, TagValue, UpdateOptions } from "./types.ts";

/** Create the SDK for the current platform: `createIAlert({ publicKey, storage: AsyncStorage })`. */
export function createIAlert(options: Omit<IAlertOptions, "platform"> & { platform?: DevicePlatform }): IAlert {
    return new IAlert({ ...options, platform: options.platform ?? currentPlatform() });
}
