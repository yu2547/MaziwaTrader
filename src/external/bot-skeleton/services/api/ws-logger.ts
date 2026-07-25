export type TLogCategory = 'Connection' | 'Subscription' | 'Heartbeat' | 'Reconnect';

/**
 * Gated so these don't clutter the production console: dev builds show them by
 * default, production requires an explicit opt-in via
 * localStorage.setItem('ws_debug', '1') (and '0' to opt back out), which also makes
 * them easy to turn on for a specific user session without a rebuild.
 */
const isDebugEnabled = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        const override = window.localStorage.getItem('ws_debug');
        if (override === '1') return true;
        if (override === '0') return false;
    } catch {
        // localStorage inaccessible (e.g. private browsing) - fall through to the env default.
    }
    return process.env.NODE_ENV !== 'production';
};

/** Structured replacement for ad-hoc `[WS DEBUG]` logs - one of a fixed set of
 * categories (Connection/Subscription/Heartbeat/Reconnect) so the console can be
 * filtered and the message itself states what happened rather than requiring the
 * reader to decode it from raw state dumps. */
export const wsLog = (category: TLogCategory, message: string, data?: unknown): void => {
    if (!isDebugEnabled()) return;
    // eslint-disable-next-line no-console
    if (data !== undefined) console.log(`[${category}] ${message}`, data);
    else console.log(`[${category}] ${message}`);
};
