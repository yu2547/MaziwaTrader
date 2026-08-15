import { useEffect } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';

/**
 * Feeds the header's balance from the account's live `balance` stream.
 *
 * Why this exists: the header rendered `oauth_session.selected_account.balance`,
 * which is the snapshot the REST account list carried at login. It was never
 * updated again for the life of the session, and `?? 0` turned "no snapshot
 * yet" into a confident 0.00 USD.
 *
 * The stream itself was already being requested - api_base.subscribe() sends
 * `{balance: 1, subscribe: 1}` the moment the socket is authorised - but
 * nothing routed the replies to this store. CoreStoreProvider's handler is
 * the only other consumer and it writes into ClientStore's all_accounts_balance
 * map, whose `balance.loginid` branch returns early when that map is empty,
 * which it always is on an OAuth session. So the replies arrived and were
 * dropped.
 *
 * No new socket is opened here. This reads api_base's existing authenticated
 * connection, and re-binds when api_base swaps it - on first connect, on
 * reconnect, and on a Real/Demo switch - because each of those replaces the
 * instance the subscription was taken from. api_base exposes no observable
 * for that and its single reconnected_callback slot belongs to the trade
 * engine, so this compares instance identity on a slow interval.
 */
const useLiveBalance = () => {
    const { oauth_session } = useStore() ?? {};

    useEffect(() => {
        if (!oauth_session) return undefined;

        let subscribed_api: unknown = null;
        let subscription: { unsubscribe?: () => void } | undefined;

        const attach = () => {
            const api = api_base.api;
            if (!api || api === subscribed_api) return;
            subscription?.unsubscribe?.();
            subscribed_api = api;
            // A new socket means a new account or a fresh session; whatever
            // was on screen belonged to the old one.
            oauth_session.clearLiveBalance();
            subscription = api.onMessage?.().subscribe(({ data }: { data: Record<string, unknown> }) => {
                if (data?.msg_type !== 'balance') return;
                const balance = data.balance as { balance?: unknown; currency?: unknown } | undefined;
                if (!balance) return;
                oauth_session.setLiveBalance(balance.balance, balance.currency);
            });
        };

        attach();
        const rebind_timer = setInterval(attach, 1000);

        return () => {
            clearInterval(rebind_timer);
            subscription?.unsubscribe?.();
        };
    }, [oauth_session]);
};

export default useLiveBalance;
