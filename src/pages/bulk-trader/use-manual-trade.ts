import { useCallback, useEffect, useRef, useState } from 'react';
import { api_base, LogTypes, observer as globalObserver } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { getStoredAccessToken } from '@/utils/auth/deriv-oauth';

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
    /**
     * Left out entirely by the contracts that have no duration - an
     * accumulator runs until it knocks out or its take profit is hit, and a
     * multiplier until it is closed - and sending one gets those rejected.
     */
    duration?: number;
    /**
     * Deriv's own unit codes - 't' ticks, 's' seconds, 'm' minutes, 'h' hours,
     * 'd' days. Ticks by default, which is what every caller wanted until a
     * page needed to offer minutes as well.
     */
    duration_unit?: string;
    barrier?: number | string;
    /** Multipliers: how far the move is geared. */
    multiplier?: number;
    /** Accumulators: the per-tick growth, as a fraction (0.03 is 3%). */
    growth_rate?: number;
    /** Turbos: Deriv prices these from the payout per point, not a barrier. */
    payout_per_point?: string;
    /** Take profit / stop loss, which Deriv carries as orders on the contract. */
    limit_order?: Record<string, number>;
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

/**
 * Deriv can leave a request unanswered, and api.send() then never settles: a
 * socket that has gone quiet, one being replaced mid-reconnect, or one that
 * never opened at all. Awaiting that is what leaves a button reading
 * "Buying..." with nothing behind it.
 *
 * Every await below is raced against the clock, so a press always ends in an
 * answer or in a message, never in a page that has stopped responding.
 */
const CONNECT_TIMEOUT_MS = 15000;
const PRICE_TIMEOUT_MS = 10000;

/**
 * Longer than the others, and deliberately never retried on its own: a buy that
 * has gone out may have been taken even when the answer does not arrive, so the
 * only safe thing to do is say so and let the trader look.
 */
const BUY_TIMEOUT_MS = 20000;

class TimeoutError extends Error {}

/**
 * What Deriv answers these two requests with. Only the fields this file reads
 * are named; `api.send()` is untyped (@deriv/deriv-api ships no declarations),
 * so without them the awaited value arrives as `unknown` and nothing can be
 * read off it.
 */
type TProposalReply = { proposal?: { ask_price?: number; id?: string } };
type TBuyReply = { buy?: { contract_id?: number | string; longcode?: string; transaction_id?: number | string } };
type TSellReply = { sell?: { sold_for?: number; transaction_id?: number | string } };

/**
 * A sell is a closing trade, so it is given the buy's patience rather than the
 * price request's - and, like the buy, it is never retried on a silence.
 */
const SELL_TIMEOUT_MS = 20000;

/**
 * Races an untyped request against the clock. The one cast is here, in one
 * place, rather than at each call site: what comes back is whatever the socket
 * sent, and the caller names the shape it expects to read.
 *
 * The request itself is not cancelled - a WebSocket request cannot be - and no
 * answer is invented: on timeout this rejects with a TimeoutError carrying the
 * caller's message, and a real failure is passed through untouched.
 */
const withTimeout = <T>(work: Promise<unknown>, ms: number, message: string): Promise<T> =>
    new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
        work.then(
            value => {
                clearTimeout(timer);
                // The one cast: what the socket sent, named by the caller.
                resolve(value as T);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });

const useManualTrade = () => {
    const { run_panel, oauth_session } = useStore() ?? {};
    const [is_placing, setIsPlacing] = useState(false);
    const [is_selling, setIsSelling] = useState(false);
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

    /**
     * Brings the trading connection up before a click is refused, and returns
     * the reason it still cannot trade - or null when it can.
     *
     * An OAuth session can be fully logged in - balance on screen, account in
     * the header - while api_base is still holding the anonymous socket,
     * because the OTP transport is opened lazily. The bot's Run button already
     * recovers from exactly that (run-panel-store.ts onRunButtonClick); without
     * the same recovery here a click died on `is_authorized === false` and told
     * somebody who was already logged in to log in.
     *
     * It also re-points the socket when that socket is bound to a different
     * account than the header is showing. The OTP is issued for one account at
     * socket-open, so "switch account" genuinely means reconnecting, and it
     * must not happen in the same breath as a buy - the proposal would price
     * against the account on its way out. Same call the Run button makes:
     * switch, say so, and let the next click trade.
     */
    const prepareConnection = useCallback(async (): Promise<string | null> => {
        if (!api_base.api || !api_base.is_authorized) {
            if (!getStoredAccessToken()) return 'Log in to place trades.';
            let connected = false;
            try {
                connected = await withTimeout<boolean>(
                    api_base.initOtpConnection(),
                    CONNECT_TIMEOUT_MS,
                    'timed out opening the trading connection'
                );
            } catch {
                // A connection that never answers is a connection we do not
                // have, and the message below already says so.
                connected = false;
            }
            if (!connected) {
                return `Could not open a trading connection for your account. ${api_base.otp_error ?? ''}`.trim();
            }
        }

        const selected_account_id = oauth_session?.selected_account_id;
        if (api_base.is_otp_transport && selected_account_id && api_base.account_id !== selected_account_id) {
            const switched = await withTimeout<boolean>(
                api_base.switchOtpAccount(selected_account_id),
                CONNECT_TIMEOUT_MS,
                'timed out switching account'
            ).catch(() => false);
            return switched
                ? 'Reconnected to the account in the header. Press again to trade on it.'
                : 'The connection is on a different account than the header shows.';
        }

        return null;
    }, [oauth_session]);

    // Places one contract. Deliberately does not touch `is_placing` - a batch
    // fires several of these at once, and each one clearing the flag as it
    // finished would re-enable the buttons while the rest were still in
    // flight. The batch below owns that flag.
    const placeTrade = useCallback(
        async (
            {
                contract_type,
                symbol,
                stake,
                duration,
                duration_unit = 't',
                barrier,
                multiplier,
                growth_rate,
                payout_per_point,
                limit_order,
            }: TPlaceTradeParams,
            on_contract?: (contract_id: number) => void
        ) => {
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

            try {
                const currency = (api_base.account_info as { currency?: string })?.currency || 'USD';
                const proposal_request: Record<string, unknown> = {
                    proposal: 1,
                    amount: stake,
                    basis: 'stake',
                    contract_type,
                    currency,
                    ...(duration !== undefined ? { duration, duration_unit } : {}),
                    ...(api_base.is_otp_transport ? { underlying_symbol: symbol } : { symbol }),
                };
                if (barrier !== undefined) proposal_request.barrier = barrier;
                if (multiplier !== undefined) proposal_request.multiplier = multiplier;
                if (growth_rate !== undefined) proposal_request.growth_rate = growth_rate;
                if (payout_per_point !== undefined) proposal_request.payout_per_point = payout_per_point;
                if (limit_order !== undefined) proposal_request.limit_order = limit_order;

                // Nothing has been bought at this point, so a price request that
                // goes unanswered is safe to give up on and say so.
                const proposal_response = await withTimeout<TProposalReply>(
                    api.send(proposal_request),
                    PRICE_TIMEOUT_MS,
                    'Deriv did not answer the price request in time. Nothing was bought - check your connection and try again.'
                );
                if (readError(proposal_response)) throw proposal_response;

                const proposal = proposal_response.proposal;
                if (!proposal?.id) throw new Error('The price request came back without a proposal.');

                let buy_response: TBuyReply;
                try {
                    buy_response = await withTimeout<TBuyReply>(
                        api.send({ buy: proposal.id, price: proposal.ask_price }),
                        BUY_TIMEOUT_MS,
                        'The purchase was not confirmed in time.'
                    );
                } catch (thrown) {
                    // A buy that goes unanswered is not the same as a buy that
                    // failed - it may well have been taken. So nothing is
                    // retried and nothing is claimed either way: the press ends,
                    // and the trader is told to look before pressing again.
                    if (thrown instanceof TimeoutError) {
                        const unconfirmed =
                            'Deriv did not confirm the purchase in time. It may still have been placed - check your open positions before buying again.';
                        if (is_mounted.current) setErrorMessage(unconfirmed);
                        globalObserver.emit('ui.log.error', unconfirmed);
                        return false;
                    }
                    throw thrown;
                }
                if (readError(buy_response)) throw buy_response;

                const buy = buy_response.buy;
                // Deriv answers a successful buy with the contract; anything
                // else is surfaced rather than carried on with as a NaN id.
                if (!buy?.contract_id) throw new Error('The purchase came back without a contract.');
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
                    // A contract with no duration of its own (accumulator,
                    // multiplier) runs until it is closed, so this is only a
                    // late check: it asks once, and leaves the contract
                    // pending if it is still open.
                    (duration ?? 0) * 2000 + SETTLEMENT_GRACE_MS
                );

                open_contracts.current.set(contract_id, timeout);
                if (is_mounted.current) setPendingCount(open_contracts.current.size);

                // Handed back so a caller that needs to follow this particular
                // contract can tell it apart on the bot.contract stream, which
                // carries every contract the app has open - a strategy page
                // counting its own wins must not count a bot run's as well.
                on_contract?.(contract_id);

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
            }
        },
        [settle]
    );

    /**
     * Fires `count` contracts together rather than one after another.
     *
     * Sequentially, a batch of 20 took as long as 20 round trips to Deriv and
     * the later contracts opened against ticks the earlier ones had already
     * traded through - which is not "20 trades on this signal", it is 20
     * trades on 20 different signals. They go out concurrently so the whole
     * batch prices off the same moment.
     *
     * One failure no longer cancels the rest. Aborting the batch on the first
     * error meant a single rejected contract - a momentary price move, one
     * proposal refused - silently swallowed every trade behind it. Each
     * contract now stands or falls on its own and the count that actually
     * opened is reported back.
     */
    const placeTrades = useCallback(
        async (params: TPlaceTradeParams, count: number, on_contract?: (contract_id: number) => void) => {
            const attempts = Math.max(1, count);
            setIsPlacing(true);
            try {
                // Once per click, not once per contract: a batch of 20 against
                // a sleeping socket would otherwise open 20 connections.
                const blocked = await prepareConnection();
                if (blocked) {
                    if (is_mounted.current) setErrorMessage(blocked);
                    globalObserver.emit('ui.log.error', blocked);
                    return 0;
                }
                setErrorMessage(null);
                const results = await Promise.all(
                    Array.from({ length: attempts }, () => placeTrade(params, on_contract))
                );
                return results.filter(Boolean).length;
            } finally {
                if (is_mounted.current) setIsPlacing(false);
            }
        },
        [placeTrade, prepareConnection]
    );

    /**
     * Closes an open contract at whatever Deriv will pay for it now - the
     * other half of a trade, and the action behind DTrader's Sell button.
     *
     * `price: 0` is Deriv's own "sell at market": the contract goes at the
     * current bid rather than being held out for a figure that may never come
     * back. The bid moves between the button being drawn and the request
     * landing, which is what the slippage note beside the button is about.
     *
     * Nothing here settles the contract in the UI. The sale comes back on the
     * same proposal_open_contract stream as everything else, carrying is_sold,
     * and settle() above closes it exactly as it closes a contract that ran to
     * its end - so a sold contract and an expired one write the same record.
     *
     * Like the buy, a silence is never retried: the contract may well be sold.
     */
    const sellContract = useCallback(
        async (contract_id: number) => {
            const blocked = await prepareConnection();
            if (blocked) {
                if (is_mounted.current) setErrorMessage(blocked);
                globalObserver.emit('ui.log.error', blocked);
                return false;
            }

            const api = api_base.api;
            if (!api) {
                setErrorMessage('Not connected to Deriv yet.');
                return false;
            }

            setIsSelling(true);
            setErrorMessage(null);
            try {
                const response = await withTimeout<TSellReply>(
                    api.send({ price: 0, sell: contract_id }),
                    SELL_TIMEOUT_MS,
                    'The sale was not confirmed in time.'
                );
                if (readError(response)) throw response;
                if (!response.sell) throw new Error('The sale came back without a confirmation.');
                return true;
            } catch (thrown) {
                const message =
                    thrown instanceof TimeoutError
                        ? 'Deriv did not confirm the sale in time. It may still have gone through - check your open positions before selling again.'
                        : (readError(thrown) ?? 'The contract could not be sold.');
                if (is_mounted.current) setErrorMessage(message);
                globalObserver.emit('ui.log.error', message);
                return false;
            } finally {
                if (is_mounted.current) setIsSelling(false);
            }
        },
        [prepareConnection]
    );

    return { error_message, is_placing, is_selling, pending_count, placeTrade, placeTrades, sellContract };
};

export default useManualTrade;
