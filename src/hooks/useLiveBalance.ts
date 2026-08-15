import { useEffect } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';

/**
 * Feeds the header's balance from the account's live `balance` stream.
 *
 * Why the header showed 0.00, and then "Loading..." forever:
 *
 * api_base.subscribe() does send {balance: 1, subscribe: 1} as soon as the
 * socket is authorised - but it sends it through SubscriptionManager, which
 * does `await this.send(request)`. That await consumes the *initial* balance
 * reply into a promise at connect time. Everything after it is a push, and
 * Deriv only pushes when the balance changes. So a listener that attaches
 * later - this header, mounted well after the socket came up - misses the one
 * message that ever carried the current figure, and on an idle account no
 * second one is ever sent.
 *
 * Hence the explicit read below. Same socket, no second connection, and
 * `balance` is a read - it neither creates a contract nor moves funds.
 * The stream listener stays for everything after it.
 */

/** Accepts the shapes a balance reply plausibly arrives in, and nothing else. */
const readBalance = (payload: unknown): { balance: number; currency?: string } | null => {
    if (!payload || typeof payload !== 'object') return null;
    const record = payload as Record<string, unknown>;

    // {balance: {balance, currency}} - the classic envelope.
    const nested = record.balance;
    if (nested && typeof nested === 'object') {
        const inner = nested as Record<string, unknown>;
        const value = typeof inner.balance === 'string' ? Number(inner.balance) : inner.balance;
        if (typeof value === 'number' && !Number.isNaN(value)) {
            return { balance: value, currency: typeof inner.currency === 'string' ? inner.currency : undefined };
        }
    }

    // {balance: 123.45, currency: 'USD'} - the envelope flattened.
    const flat = typeof record.balance === 'string' ? Number(record.balance) : record.balance;
    if (typeof flat === 'number' && !Number.isNaN(flat)) {
        return { balance: flat, currency: typeof record.currency === 'string' ? record.currency : undefined };
    }

    // {amount, currency} - what an accounts-style payload would look like.
    const amount = typeof record.amount === 'string' ? Number(record.amount) : record.amount;
    if (typeof amount === 'number' && !Number.isNaN(amount)) {
        return { balance: amount, currency: typeof record.currency === 'string' ? record.currency : undefined };
    }

    return null;
};

const useLiveBalance = () => {
    const { oauth_session } = useStore() ?? {};

    useEffect(() => {
        if (!oauth_session) return undefined;

        let subscribed_api: unknown = null;
        let subscription: { unsubscribe?: () => void } | undefined;
        let is_cancelled = false;

        const apply = (payload: unknown, source: string) => {
            const parsed = readBalance(payload);
            // TEMPORARY: logs the shape of the reply so the field mapping can
            // be confirmed against the real response. Prints a balance and a
            // currency only - never the access token. Remove once verified.
            // eslint-disable-next-line no-console
            console.info('[MW-BALANCE]', source, 'parsed:', parsed, 'raw:', payload);
            if (parsed) oauth_session.setLiveBalance(parsed.balance, parsed.currency);
        };

        const attach = () => {
            const api = api_base.api;
            if (!api || api === subscribed_api) return;
            subscription?.unsubscribe?.();
            subscribed_api = api;
            // A new socket means a new account or a fresh session; whatever
            // was on screen belonged to the old one.
            oauth_session.clearLiveBalance();

            // The read that fills the header. Without it the header waits for
            // a change that may never come.
            api.send({ balance: 1 })
                .then((response: unknown) => {
                    if (!is_cancelled) apply(response, 'read');
                })
                .catch((error: unknown) => {
                    // eslint-disable-next-line no-console
                    console.info('[MW-BALANCE] read failed', error);
                });

            // Everything after the first value.
            subscription = api.onMessage?.().subscribe(({ data }: { data: Record<string, unknown> }) => {
                if (data?.msg_type !== 'balance') return;
                apply(data, 'stream');
            });
        };

        attach();
        // api_base swaps its socket on first connect, on reconnect, and on a
        // Real/Demo switch. It exposes no observable for that, and its single
        // reconnected_callback slot belongs to the trade engine, so this
        // compares instance identity on a slow interval.
        const rebind_timer = setInterval(attach, 1000);

        return () => {
            is_cancelled = true;
            clearInterval(rebind_timer);
            subscription?.unsubscribe?.();
        };
    }, [oauth_session]);
};

export default useLiveBalance;
