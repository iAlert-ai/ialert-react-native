/** One Live Activity broadcast as delivered to Android: an FCM data message with `ialert_type = live_activity`. */
export interface LiveActivityUpdate {
    channelId: string;
    broadcastId: string | null;
    event: "update" | "end";
    contentState: Record<string, unknown>;
    title: string | null;
    body: string | null;
    sound: string | null;
    /** When the update was sent (Unix seconds); drop updates older than one already shown. */
    timestamp: number;
    staleDate: number | null;
    dismissalDate: number | null;
    relevanceScore: number | null;
}

function numberOrNull(value: unknown): number | null {
    if (typeof value !== "string" || value === "") {
        return null;
    }

    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

/**
 * Reads `remoteMessage.data` (e.g. from @react-native-firebase/messaging); `null` when it
 * is not an iAlert Live Activity update. Show or update one ongoing notification per
 * `channelId` and remove it on `event: "end"`.
 */
export function parseLiveActivityUpdate(data: Record<string, unknown> | undefined): LiveActivityUpdate | null {
    if (data?.ialert_type !== "live_activity" || typeof data.ialert_channel !== "string" || data.ialert_channel === "") {
        return null;
    }

    if (data.event !== "update" && data.event !== "end") {
        return null;
    }

    let contentState: Record<string, unknown> = {};

    if (typeof data.content_state === "string") {
        try {
            const decoded: unknown = JSON.parse(data.content_state);

            if (decoded !== null && typeof decoded === "object" && !Array.isArray(decoded)) {
                contentState = decoded as Record<string, unknown>;
            }
        } catch {
            contentState = {};
        }
    }

    return {
        channelId: data.ialert_channel,
        broadcastId: stringOrNull(data.ialert_broadcast),
        event: data.event,
        contentState,
        title: stringOrNull(data.title),
        body: stringOrNull(data.body),
        sound: stringOrNull(data.sound),
        timestamp: numberOrNull(data.timestamp) ?? 0,
        staleDate: numberOrNull(data.stale_date),
        dismissalDate: numberOrNull(data.dismissal_date),
        relevanceScore: numberOrNull(data.relevance_score),
    };
}
