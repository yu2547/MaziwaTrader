import { wsLog } from './ws-logger';

export type TSubscriptionRequest = Record<string, unknown>;

export type TSubscriptionResult = {
    subscription?: { id: string };
    [key: string]: unknown;
};

type TSubscriptionEntry = {
    key: string;
    request: TSubscriptionRequest;
    subscription_id: string | null;
};

/**
 * How long one subscribe request may go unanswered before it is given up on.
 *
 * @deriv/deriv-api never settles a request whose socket closes under it: its
 * close handler does not reject pendingRequests, and a request sent to a socket
 * that is already closing is recorded as pending and silently never sent. So a
 * restore that was awaiting a reply when a phone dropped its connection -
 * screen lock, app switch, a network change - waited for ever. That kept the
 * restore marked in progress for the rest of the page's life, every later
 * reconnect skipped restoring, and the live socket never carried
 * proposal_open_contract again: the bot bought, and never heard the result.
 */
const REQUEST_TIMEOUT_MS = 10000;

/**
 * Tracks which server-side subscriptions SHOULD be active right now (balance,
 * transaction, proposal_open_contract - the ones api-base.ts owns), so they can be:
 *  - deduped (a second subscribe() for the same key reuses the existing one instead
 *    of sending a duplicate request), and
 *  - replayed in one place after a reconnect, in the order they were registered.
 *
 * Deliberately scoped to subscriptions this manager itself sends. The trade
 * engine's own client-side listener rebinding (Balance.js/Proposal.js/
 * OpenContract.js/ticks_service.js) is a separate, smaller fix via the
 * 'api.reconnected' event - those files don't send subscribe requests themselves,
 * they just listen for messages this manager's subscriptions produce.
 */
export default class SubscriptionManager {
    private entries: Map<string, TSubscriptionEntry> = new Map();
    // The connection the restore in progress is for, or null when none is. A
    // boolean used to stand here, and it could not tell "a second signal for
    // the same socket" - a true duplicate, rightly skipped - from "a restore
    // for a new socket while one for a dead socket is still waiting", which
    // must not be skipped: that was the new socket left with nothing.
    private restoring_for: unknown = null;
    private send: (request: TSubscriptionRequest) => Promise<TSubscriptionResult | undefined>;

    constructor(send: (request: TSubscriptionRequest) => Promise<TSubscriptionResult | undefined>) {
        this.send = send;
    }

    /**
     * send(), bounded. A request that is refused or never answered resolves to
     * undefined - the entry is left without a subscription id, which is the
     * truth about it - rather than rejecting out of, or hanging, the sequence
     * it is part of.
     */
    private async sendBounded(key: string, request: TSubscriptionRequest) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timed_out = Symbol('timed_out');
        try {
            const response = await Promise.race([
                this.send(request),
                new Promise<typeof timed_out>(resolve => {
                    timer = setTimeout(() => resolve(timed_out), REQUEST_TIMEOUT_MS);
                }),
            ]);
            if (response === timed_out) {
                wsLog('Subscription', `${key}: no answer in ${REQUEST_TIMEOUT_MS / 1000}s - giving up on this attempt`);
                return undefined;
            }
            return response;
        } catch (error) {
            wsLog('Subscription', `${key}: subscribe refused`, error);
            return undefined;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /** Subscribes if not already active for this key; returns the existing one otherwise. */
    async subscribe(key: string, request: TSubscriptionRequest) {
        const existing = this.entries.get(key);
        if (existing?.subscription_id) {
            wsLog(
                'Subscription',
                `${key} already active (id=${existing.subscription_id}) - skipping duplicate subscribe`
            );
            return existing;
        }

        wsLog('Subscription', `Subscribing: ${key}`, request);
        this.entries.set(key, { key, request, subscription_id: null });

        const response = await this.sendBounded(key, request);
        const entry = this.entries.get(key);
        if (entry) entry.subscription_id = response?.subscription?.id ?? null;
        return entry;
    }

    /**
     * Re-sends every registered subscription's original request, in registration
     * order (Map preserves insertion order). Call only once the connection is
     * authorized - the caller (api_base) is responsible for that ordering via the
     * connection state machine, this class has no visibility into auth state.
     *
     * `connection` is the socket being restored onto. A second call for the same
     * one is a duplicate signal and is skipped; a call for a different one
     * supersedes whatever restore is still running for an older socket, which
     * stops at its next step rather than writing ids that belong to a dead
     * connection. Every request is bounded (sendBounded), so a restore always
     * finishes - it can no longer be left "in progress" for good.
     */
    async restoreAll(connection: unknown = {}) {
        if (this.restoring_for !== null && this.restoring_for === connection) {
            wsLog('Subscription', 'Restore already in progress for this connection - skipping duplicate trigger');
            return;
        }
        if (this.entries.size === 0) return;

        if (this.restoring_for !== null) {
            wsLog('Subscription', 'Superseding a restore still running for an older connection');
        }
        this.restoring_for = connection;
        const isCurrent = () => this.restoring_for === connection;
        wsLog('Subscription', `Restoring ${this.entries.size} subscription(s): ${[...this.entries.keys()].join(', ')}`);

        try {
            for (const entry of this.entries.values()) {
                if (!isCurrent()) return;
                // The old subscription id belonged to a socket that no longer exists.
                entry.subscription_id = null;
                wsLog('Subscription', `Restoring ${entry.key}`);
                // eslint-disable-next-line no-await-in-loop
                const response = await this.sendBounded(entry.key, entry.request);
                if (!isCurrent()) return;
                entry.subscription_id = response?.subscription?.id ?? null;
                wsLog('Subscription', `Restored ${entry.key} (id=${entry.subscription_id ?? 'n/a'})`);
            }
            wsLog('Subscription', `Complete (${this.entries.size} restored)`);
        } finally {
            if (isCurrent()) this.restoring_for = null;
        }
    }

    /** Returns the ids of every currently-registered subscription, for forget/forget_all. */
    getActiveSubscriptionIds() {
        return [...this.entries.values()].map(entry => entry.subscription_id).filter((id): id is string => !!id);
    }

    /** True once at least one subscription has ever been registered (used to decide restore vs. fresh subscribe). */
    hasEntries() {
        return this.entries.size > 0;
    }

    /**
     * Marks every entry as having no live subscription id (the socket that held it
     * is gone), *without* forgetting the request itself - restoreAll() needs that
     * request to re-send after reconnect. Call this alongside sending `forget` for
     * the old ids (api_base does, best-effort, before the old socket is replaced).
     */
    markAllInactive() {
        this.entries.forEach(entry => {
            entry.subscription_id = null;
        });
    }

    /** Drops all tracked entries without sending forget requests (caller does that first if needed). */
    clear() {
        this.entries.clear();
    }
}
