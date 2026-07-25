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
    private is_restoring = false;
    private send: (request: TSubscriptionRequest) => Promise<TSubscriptionResult | undefined>;

    constructor(send: (request: TSubscriptionRequest) => Promise<TSubscriptionResult | undefined>) {
        this.send = send;
    }

    /** Subscribes if not already active for this key; returns the existing one otherwise. */
    async subscribe(key: string, request: TSubscriptionRequest) {
        const existing = this.entries.get(key);
        if (existing?.subscription_id) {
            wsLog('Subscription', `${key} already active (id=${existing.subscription_id}) - skipping duplicate subscribe`);
            return existing;
        }

        wsLog('Subscription', `Subscribing: ${key}`, request);
        this.entries.set(key, { key, request, subscription_id: null });

        const response = await this.send(request);
        const entry = this.entries.get(key);
        if (entry) entry.subscription_id = response?.subscription?.id ?? null;
        return entry;
    }

    /**
     * Re-sends every registered subscription's original request, in registration
     * order (Map preserves insertion order). Call only once the connection is
     * authorized - the caller (api_base) is responsible for that ordering via the
     * connection state machine, this class has no visibility into auth state.
     * Guarded against overlapping calls so two reconnect signals firing close
     * together can't run the restore sequence twice concurrently.
     */
    async restoreAll() {
        if (this.is_restoring) {
            wsLog('Subscription', 'Restore already in progress - skipping duplicate restore trigger');
            return;
        }
        if (this.entries.size === 0) return;

        this.is_restoring = true;
        wsLog('Subscription', `Restoring ${this.entries.size} subscription(s): ${[...this.entries.keys()].join(', ')}`);

        try {
            for (const entry of this.entries.values()) {
                // The old subscription id belonged to a socket that no longer exists.
                entry.subscription_id = null;
                wsLog('Subscription', `Restoring ${entry.key}`);
                // eslint-disable-next-line no-await-in-loop
                const response = await this.send(entry.request);
                entry.subscription_id = response?.subscription?.id ?? null;
                wsLog('Subscription', `Restored ${entry.key} (id=${entry.subscription_id ?? 'n/a'})`);
            }
            wsLog('Subscription', `Complete (${this.entries.size} restored)`);
        } finally {
            this.is_restoring = false;
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
