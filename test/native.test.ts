import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IAlert, type IAlertMessage, type NativeBridge } from "../src/index.ts";
import { ackResponder, fakeFetch, flush, newStorage, registerResponder } from "./helpers.ts";

function fakeBridge(token: string | null = "abcdef0123") {
    const listeners: Record<string, (value: unknown) => void> = {};
    const registrations: Record<string, string>[] = [];
    const calls: string[] = [];
    const bridge: NativeBridge = {
        requestPermission: async () => (calls.push("requestPermission"), true),
        getToken: async () => (calls.push("getToken"), token),
        takeInitialOpen: async () => null,
        deviceInfo: async () => ({ model: "iPhone16,2", osVersion: "18.1" }),
        setRegistration: (registration) => registrations.push(registration),
        addListener: (event, listener) => {
            listeners[event] = listener;
        },
    };

    return { bridge, calls, registrations, emit: (event: string, value: unknown) => listeners[event]?.(value) };
}

const init = (fetch: typeof globalThis.fetch, bridge: NativeBridge) =>
    IAlert.init({ publicKey: "ia_pk_live_abcdefghijkl", platform: "ios", apiUrl: "https://api.test/api/v1", fetch, storage: newStorage(), autoConnect: false, bridge, externalUserId: "user-42" });

describe("init", () => {
    it("asks permission, registers with the native token and shares the registration", async () => {
        const { fetch, requests } = fakeFetch(registerResponder);
        const { bridge, calls, registrations } = fakeBridge();

        const device = await init(fetch, bridge).initialized;

        assert.ok(device);
        const body = requests.find((r) => r.url.endsWith("/devices"))?.body as Record<string, unknown>;
        assert.equal(body.push_token, "abcdef0123");
        assert.equal(body.external_user_id, "user-42");
        assert.equal(body.device_model, "iPhone16,2");
        assert.equal(body.os_version, "18.1");
        assert.match(String(body.installation_id), /^ia_rn_/);
        assert.deepEqual(calls, ["requestPermission", "getToken"]);
        assert.equal(registrations[0]?.apiUrl, "https://api.test/api/v1");
    });

    it("re-registers on a new token, emits foreground pushes once and acks taps", async () => {
        const { fetch, requests } = fakeFetch(registerResponder, ackResponder);
        const { bridge, emit } = fakeBridge();
        const ialert = init(fetch, bridge);
        await ialert.initialized;
        const received: IAlertMessage[] = [];
        ialert.onMessage((m) => received.push(m));

        emit("onToken", "ffff");
        const push = { userInfo: { ialert: { id: "ntf_1", data: { url: "app://orders" } } }, title: "Hi", body: "There" };
        emit("onPush", push);
        emit("onPush", push);
        emit("onOpen", push);
        await flush();
        await flush();

        const tokens = requests.filter((r) => r.url.endsWith("/devices")).map((r) => (r.body as { push_token: string }).push_token);
        assert.deepEqual(tokens, ["abcdef0123", "ffff"]);
        assert.equal(received.length, 1);
        assert.equal(received[0]?.title, "Hi");
        assert.equal(received[0]?.url, "app://orders");
        const events = requests.filter((r) => r.url.endsWith("/inbox/ack")).map((r) => (r.body as { event: string }).event);
        assert.ok(events.includes("delivered") && events.includes("clicked"));
    });

    it("works without the native module (Gateway and Inbox only)", async () => {
        const { fetch } = fakeFetch(registerResponder);
        assert.ok(await init(fetch, null as unknown as NativeBridge).initialized);
    });
});
