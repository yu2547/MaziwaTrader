import { useCallback, useEffect, useRef, useState } from 'react';
import { api_base, LogTypes, observer as globalObserver } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';

/**
 * Places real contracts on whatever connection api_base currently holds, for
 * the one-click buttons on this page.
 *
 * This is not a second trading engine. It is the same three messages the bot
 * engine sends for a single contract - proposal, buy, then read the outcome
 * off the proposal_open_contract stream api_base already subscribes to at
 * connect (api-base.ts subscribe()) - without the Blockly workspace, the
 * interpreter, or the run/stop state machine in between. Nothing here is
 * simulated: a click spends real money on the connected account.
 *
 * Every contract is broadcast on the same globalObserver events the engine
 * broadcasts (`bot.contract`, `ui.log.success`), so it lands in the app's
 * real Summary/Transactions/Journal panel rather than a private copy of it -
 * a click here and a bot run write to the same record.
 *
 * The OTP transport names the instrument `underlying_symbol` on a proposal
 * where the classic API names it `symbol` (confirmed live - see
 * docs/DERIV_OAUTH_LEGACY_TOKEN_BRIDGE_REPORT.md section 8.4), the same
 * substitution tradeOptionToProposal() makes for the engine.
 */

export type TPlaceTradeParams = {
    contract_type: string;
    symbol: string;
    stake: number;
    duration: number;
    barrier?: number;
};

type TApiError = { error?: { message?: string; code?: string } };

const readError = (thrown: unknown): string | null => {
    const error = (thrown as TApiError)?.error;
    if (error) return error.message || error.code || 'Request failed.';
    if (thrown instanceof Error) return thrown.message;
    return null;
};

// A contract can only settle after its ticks have elapsed; this is how long
// after that we keep waiting on the stream before asking for the contract
// directly. Covers the case where the global proposal_open_contract
// subscription drops an update rather than the contract never settling.
const SETTLEMENT_GRACE_MS = 15000;

const useManualTrade = () => {
    const { run_panel } = useStore() ?? {};
    const [is_placing, setIsPlacing] = useState(false);
    const [pending_count, setPendingCount] = useState(0);
    const [error_message, setErrorMessage] = useState<string | null>(null);

    // Contracts bought here and not yet settled. Kept in a ref because the
    // onMessage subscription below is registered once and must see the
    // current set, not the set that existed when it was registered.
    const open_contracts = useRef(new Map<number, ReturnType<typeof setTimeout>>());
    const is_mounted = useRef(true);

    // The run panel only listens for bot events while a bot is running, so
    // this page registers them for as long as it is on screen. Deliberately
    // does not unregister while a bot is running - those listeners would be
    // the bot's, and tearing them down would blank its panel mid-run.
    useEffect(() => {
        run_panel?.registerBotListeners();
        return () => {
            if (!run_panel?.is_running) run_panel?.unregisterBotListeners();
        };
    }, [run_panel]);

    const broadcast = useCallback((contract: Record<string, unknown>) => {
        globalObserver.emit('bot.contract', {
            accountID: (api_base.account_info as { loginid?: string })?.loginid,
            ...contract,
        });
    }, []);

    const settle = useCallback(
        (contract: Record<string, unknown>) => {
            const contract_id = Number(contract.contract_id);
            const timeout = open_contracts.current.get(contract_id);
            if (timeout === undefined) return;

            clearTimeout(timeout);
            open_contracts.current.delete(contract_id);
            if (is_mounted.current) setPendingCount(open_contracts.current.size);

            broadcast(contract);
            // Same pair of journal lines Total.js writes when the engine
            // closes a contract, so a manual trade reads identically to a bot
            // one in the Journal.
            const profit = Number(contract.profit ?? 0);
            globalObserver.emit('ui.log.success', {
                log_type: profit >= 0 ? LogTypes.PROFIT : LogTypes.LOST,
                extra: { currency: contract.currency, profit },
            });
        },
        [broadcast]
    );

    // Reads the same proposal_open_contract stream OpenContract.js reads.
    // api_base already subscribes to it at connect, so nothing extra is
    // requested here.
    //
    // Re-bound whenever api_base swaps its socket - on first connect (this
    // page can mount before the connection is up), on reconnect, and on a
    // Real/Demo switch, all of which replace the instance the subscription
    // was taken from. api_base exposes no observable for that and its single
    // reconnected_callback slot belongs to the trade engine, so this compares
    // instance identity on a slow interval rather than taking that slot.
    useEffect(() => {
        is_mounted.current = true;
        // The Map identity never changes for the life of the hook, so this is
        // the same object the cleanup below needs - captured explicitly
        // because reading .current during cleanup is the pattern the lint
        // rule warns about.
        const pending = open_contracts.current;
        let subscribed_api: unknown = null;
        let subscription: { unsubscribe?: () => void } | undefined;

        const attach = () => {
            const api = api_base.api;
            if (!api || api === subscribed_api) return;
            subscription?.unsubscribe?.();
            subscribed_api = api;
            subscription = api.onMessage?.().subscribe(({ data }: { data: Record<string, unknown> }) => {
                if (data?.msg_type !== 'proposal_open_contract') return;
                const contract = data.proposal_open_contract as Record<string, unknown> | undefined;
                if (!contract || !pending.has(Number(contract.contract_id))) return;
                // Every update goes out, not just the last one: that is what
                // fills a transaction row in as it goes rather than making it
                // appear only once the contract has already closed.
                if (contract.is_sold) settle(contract);
                else broadcast(contract);
            });
        };

        attach();
        const rebind_timer = setInterval(attach, 1000);

        return () => {
            is_mounted.current = false;
            clearInterval(rebind_timer);
            subscription?.unsubscribe?.();
            pending.forEach(timeout => clearTimeout(timeout));
            pending.clear();
        };
    }, [settle, broadcast]);

    const placeTrade = useCallback(
        async ({ contract_type, symbol, stake, duration, barrier }: TPlaceTradeParams) => {
            const api = api_base.api;
            if (!api) {
                setErrorMessage('Not connected to Deriv yet.');
                return false;
            }
            if (!api_base.is_authorized) {
                setErrorMessage('Log in to place trades.');
                return false;
            }

            setErrorMessage(null);
            setIsPlacing(true);

            try {
                const currency = (api_base.account_info as { currency?: string })?.currency || 'USD';
                const proposal_request: Record<string, unknown> = {
                    proposal: 1,
                    amount: stake,
                    basis: 'stake',
                    contract_type,
                    currency,
                    duration,
                    duration_unit: 't',
                    ...(api_base.is_otp_transport ? { underlying_symbol: symbol } : { symbol }),
                };
                if (barrier !== undefined) proposal_request.barrier = barrier;

                const proposal_response = await api.send(proposal_request);
                if (readError(proposal_response)) throw proposal_response;

                const proposal = proposal_response.proposal;
                if (!proposal?.id) throw new Error('The price request came back without a proposal.');

                const buy_response = await api.send({ buy: proposal.id, price: proposal.ask_price });
                if (readError(buy_response)) throw buy_response;

                const buy = buy_response.buy;
                const contract_id = Number(buy.contract_id);

                // The contract runs for `duration` ticks; give the stream that
                // long plus a grace period, then ask for the contract directly
                // rather than leaving it pending on screen forever.
                const timeout = setTimeout(
                    () => {
                        api.send({ proposal_open_contract: 1, contract_id })
                            .then((response: Record<string, unknown>) => {
                                const contract = response?.proposal_open_contract as
                                    Record<string, unknown> | undefined;
                                if (contract?.is_sold) settle(contract);
                            })
                            .catch(() => {
                                // Leave it pending - the stream may still deliver it.
                            });
                    },
                    duration * 2000 + SETTLEMENT_GRACE_MS
                );

                open_contracts.current.set(contract_id, timeout);
                if (is_mounted.current) setPendingCount(open_contracts.current.size);

                globalObserver.emit('ui.log.success', {
                    log_type: LogTypes.PURCHASE,
                    extra: { longcode: buy.longcode, transaction_id: buy.transaction_id },
                });
                return true;
            } catch (thrown) {
                const message = readError(thrown) ?? 'The trade could not be placed.';
                if (is_mounted.current) setErrorMessage(message);
                globalObserver.emit('ui.log.error', message);
                return false;
            } finally {
                if (is_mounted.current) setIsPlacing(false);
            }
        },
        [settle]
    );

    return { placeTrade, is_placing, pending_count, error_message };
};

export default useManualTrade;
