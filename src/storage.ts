import type { KeyValueStorage } from "./types.ts";

/** In-memory storage: registration and dedupe only last for this app run. Use it in tests. */
export class MemoryStorage implements KeyValueStorage {
    private readonly items = new Map<string, string>();

    async getItem(key: string): Promise<string | null> {
        return this.items.get(key) ?? null;
    }

    async setItem(key: string, value: string): Promise<void> {
        this.items.set(key, value);
    }

    async removeItem(key: string): Promise<void> {
        this.items.delete(key);
    }
}

/** Namespaced JSON helpers over an async KeyValueStorage; never throws. */
export class Store {
    private readonly storage: KeyValueStorage;
    private readonly prefix: string;

    constructor(storage: KeyValueStorage, namespace: string) {
        this.storage = storage;
        this.prefix = `ialert:${namespace}:`;
    }

    async get<T>(key: string): Promise<T | null> {
        try {
            const raw = await this.storage.getItem(this.prefix + key);

            return raw === null ? null : (JSON.parse(raw) as T);
        } catch {
            return null;
        }
    }

    async set(key: string, value: unknown): Promise<void> {
        try {
            await this.storage.setItem(this.prefix + key, JSON.stringify(value));
        } catch {
            // Storage full or blocked: the SDK keeps working for this run.
        }
    }

    async remove(key: string): Promise<void> {
        try {
            await this.storage.removeItem(this.prefix + key);
        } catch {
            // ignore
        }
    }
}
