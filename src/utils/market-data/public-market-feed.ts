import { BehaviorSubject } from 'rxjs';
import { createDebugLogger } from '@/utils/debug-log';

/**
 * Live market data over Deriv's public Options WebSocket
 * (wss://api.derivws.com/trading/v1/options/ws/public - documented at
 * developers.deriv.com/docs/options/ws-public/, no auth/OTP required).
 *
 * Deriv's own docs don't publish a message schema for this endpoint, so the
 * message format below was confirmed live rather than assumed: connecting
 * and sending the documented classic-API messages (`ticks`/`subscribe`,
 * `ticks_history`, `active_symbols`) returns the exact same response shapes
 * the classic websockets/v3 API uses. This is a separate connection from
 * that classic API and from the OAuth-authenticated Options WS
 * (options-trading-api.ts) - it carries no account data and needs no token,
 * so it's safe to use for market-data widgets regardless of session type.
 */

export type TFeedConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export type TActiveSymbol = {
    underlying_symbol: string;
    underlying_symbol_name: string;
    market: string;
    submarket: string;
    subgroup: string;
    pip_size: number;
    exchange_is_open: 0 | 1;
    is_trading_suspended: 0 | 1;
};

export type TTick = {
    ask: number;
    bid: number;
    epoch: number;
    id: string;
    pip_size: number;
    quote: number;
    symbol: string;
};

/**
 * A priced contract, as Deriv returns it. Only the fields this app reads are
 * named; every one of them is optional because which ones come back depends
 * on the contract - an accumulator carries barriers and a tick ceiling, a
 * multiplier carries commission and a stop out, a vanilla carries its strike
 * choices.
 */
export type TProposalResponse = {
    error?: { code?: string; message?: string };
    proposal?: {
        ask_price?: number;
        barrier_choices?: string[];
        commission?: number;
        contract_details?: {
            barrier?: string;
            barrier_spot_distance?: string;
            high_barrier?: string;
            low_barrier?: string;
            maximum_payout?: number;
            maximum_ticks?: number;
            tick_size_barrier_percentage?: string;
            ticks_stayed_in?: number[];
        };
        display_number_of_contracts?: string;
        id?: string;
        limit_order?: { stop_out?: { display_order_amount?: string; value?: string } };
        longcode?: string;
        payout?: number;
        spot?: number;
        validation_params?: {
            max_payout?: string;
            max_ticks?: number;
            payout?: { max?: string };
            stake?: { max?: string; min?: string };
            take_profit?: { max?: string; min?: string };
        };
    };
};

/** One tradable contract on a symbol, from `contracts_for`. */
export type TContractForSymbol = {
    contract_category: string;
    contract_type: string;
    expiry_type: string;
    max_contract_duration: string;
    min_contract_duration: string;
};

export type TCandle = {
    open: number;
    high: number;
    low: number;
    close: number;
    epoch: number;
};

const PUBLIC_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
const PING_INTERVAL_MS = 15000;
const RECONNECT_DELAY_MS = 4000;
const REQUEST_TIMEOUT_MS = 10000;

export const feedConnectionState$ = new BehaviorSubject<TFeedConnectionState>('idle');
export const feedLatencyMs$ = new BehaviorSubject<number | null>(null);

// Progress is opt-in (localStorage mw_debug = '1'); failures always print.
const { log } = createDebugLogger('[MW-FEED]');

type TPending = { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void };

class PublicMarketFeed {
    private ws: WebSocket | null = null;
    private req_id = 0;
    private pending = new Map<number, TPending>();
    private tick_subscribers = new Map<string, Set<(tick: TTick) => void>>();
    private reconnect_timer: ReturnType<typeof setTimeout> | null = null;
    private ping_timer: ReturnType<typeof setInterval> | null = null;
    private should_reconnect = false;
    private ref_count = 0;

    connect() {
        this.should_reconnect = true;
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
        this.openSocket();
    }

    disconnect() {
        this.should_reconnect = false;
        if (this.reconnect_timer) clearTimeout(this.reconnect_timer);
        this.stopPing();
        this.ws?.close(1000, 'client disconnect');
        this.ws = null;
        feedConnectionState$.next('idle');
    }

    /**
     * Reference-counted connect - every standalone route that renders a
     * usePublicMarketFeed() consumer (dashboard widgets, Bulk Trader, etc.)
     * calls this independently, so the connection has to survive as long as
     * ANY of them is mounted rather than being owned by a single page.
     */
    acquire() {
        this.ref_count += 1;
        this.connect();
    }

    release() {
        this.ref_count = Math.max(0, this.ref_count - 1);
        if (this.ref_count === 0) this.disconnect();
    }

    private openSocket() {
        log('connecting');
        feedConnectionState$.next('connecting');
        const ws = new WebSocket(PUBLIC_WS_URL);
        this.ws = ws;

        ws.onopen = () => {
            log('open');
            feedConnectionState$.next('open');
            this.startPing();
            this.tick_subscribers.forEach((_subs, symbol) => this.sendTicksSubscribe(symbol));
        };

        ws.onmessage = event => {
            let data: Record<string, unknown>;
            try {
                data = JSON.parse(event.data);
            } catch {
                return;
            }

            if (data.msg_type === 'tick' && (data.tick as TTick)?.symbol) {
                const tick = data.tick as TTick;
                this.tick_subscribers.get(tick.symbol)?.forEach(cb => cb(tick));
                return;
            }

            const echo_req = data.echo_req as { req_id?: number } | undefined;
            const req_id = echo_req?.req_id;
            if (req_id && this.pending.has(req_id)) {
                const { resolve, reject } = this.pending.get(req_id)!;
                this.pending.delete(req_id);
                const error = data.error as { message?: string } | undefined;
                if (error) reject(new Error(error.message || 'Request failed'));
                else resolve(data);
            }
        };

        ws.onerror = () => {
            log('error');
            feedConnectionState$.next('error');
        };

        ws.onclose = event => {
            log('closed', { code: event.code, reason: event.reason });
            feedConnectionState$.next('closed');
            this.stopPing();
            this.ws = null;
            if (this.should_reconnect) {
                this.reconnect_timer = setTimeout(() => this.openSocket(), RECONNECT_DELAY_MS);
            }
        };
    }

    private send(request: Record<string, unknown>): Promise<Record<string, unknown>> {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('Market data feed is not connected.'));
                return;
            }
            const req_id = ++this.req_id;
            this.pending.set(req_id, { resolve, reject });
            this.ws.send(JSON.stringify({ ...request, req_id }));
            setTimeout(() => {
                if (this.pending.has(req_id)) {
                    this.pending.delete(req_id);
                    reject(new Error('Request timed out.'));
                }
            }, REQUEST_TIMEOUT_MS);
        });
    }

    private startPing() {
        this.stopPing();
        const probe = async () => {
            const start = performance.now();
            try {
                await this.send({ ping: 1 });
                feedLatencyMs$.next(Math.round(performance.now() - start));
            } catch {
                // Connection state already reflects the problem; latency just stays stale.
            }
        };
        probe();
        this.ping_timer = setInterval(probe, PING_INTERVAL_MS);
    }

    private stopPing() {
        if (this.ping_timer) clearInterval(this.ping_timer);
        this.ping_timer = null;
        feedLatencyMs$.next(null);
    }

    async getActiveSymbols(): Promise<TActiveSymbol[]> {
        const response = await this.send({ active_symbols: 'brief' });
        return (response.active_symbols as TActiveSymbol[]) ?? [];
    }

    /**
     * Prices one contract, exactly as it would be bought.
     *
     * This endpoint answers `proposal` without a session (confirmed live:
     * stake 10 on CALL R_100 came back payout 19.54, spot 613.02), which is
     * what lets a trade panel show Deriv's own payout, barriers and stake
     * limits before anyone logs in. Nothing here buys anything - a purchase
     * goes out on the authorised socket api_base owns.
     *
     * Deriv's rejections are returned rather than thrown, because they are
     * the useful answer: an unavailable barrier comes back as "Barriers
     * available are -2.43, -4.28, ..." and belongs on screen.
     */
    async getProposal(request: Record<string, unknown>): Promise<TProposalResponse> {
        try {
            const response = await this.send({ proposal: 1, ...request });
            return { proposal: response.proposal as TProposalResponse['proposal'] };
        } catch (thrown) {
            // send() rejects on a refusal, and a refusal is the answer here -
            // Deriv turns down a turbo priced at a payout per point it does not
            // offer by naming the ones it does, and that list is what the
            // control is built from. Throwing it away left the trader with an
            // empty selector and no explanation.
            return { error: { message: thrown instanceof Error ? thrown.message : 'The price request failed.' } };
        }
    }

    /** What a symbol can actually be traded as, with each one's duration bounds. */
    async getContractsFor(symbol: string): Promise<TContractForSymbol[]> {
        const response = await this.send({ contracts_for: symbol });
        const contracts_for = (response.contracts_for ?? {}) as { available?: TContractForSymbol[] };
        return Array.isArray(contracts_for.available) ? contracts_for.available : [];
    }

    async getCandles(symbol: string, granularity: number, count = 200): Promise<TCandle[]> {
        const response = await this.send({
            ticks_history: symbol,
            adjust_start_time: 1,
            count,
            end: 'latest',
            style: 'candles',
            granularity,
        });
        return (response.candles as TCandle[]) ?? [];
    }

    /**
     * The last `count` quotes for a symbol, newest last, with the decimal
     * precision they should be read at.
     *
     * Digit analysis is meaningless until the sample is full, and a live
     * subscription alone takes `count` seconds to fill one - sixteen minutes
     * for the default thousand. This seeds it in one request. Verified live
     * against this endpoint: `style: 'ticks'` returns
     * {history: {prices, times}, pip_size}.
     */
    async getTickHistory(
        symbol: string,
        count = 1000
    ): Promise<{ prices: number[]; pip_size: number; times: number[] }> {
        const response = await this.send({
            ticks_history: symbol,
            adjust_start_time: 1,
            count,
            end: 'latest',
            style: 'ticks',
        });
        const history = response.history as { prices?: number[]; times?: number[] } | undefined;
        return {
            pip_size: (response.pip_size as number) ?? 2,
            prices: history?.prices ?? [],
            // Carried alongside the prices so a chart can put a time under
            // them; callers that only count digits ignore it.
            times: history?.times ?? [],
        };
    }

    private sendTicksSubscribe(symbol: string) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    }

    /** Subscribes to live ticks for a symbol; returns an unsubscribe function. */
    subscribeTicks(symbol: string, callback: (tick: TTick) => void): () => void {
        let subs = this.tick_subscribers.get(symbol);
        const is_new_symbol = !subs;
        if (!subs) {
            subs = new Set();
            this.tick_subscribers.set(symbol, subs);
        }
        subs.add(callback);
        if (is_new_symbol) this.sendTicksSubscribe(symbol);

        return () => {
            subs?.delete(callback);
            if (subs && subs.size === 0) {
                this.tick_subscribers.delete(symbol);
                // The public feed has no per-symbol forget in what we've verified,
                // so drop every server-side tick subscription and re-issue the
                // ones still wanted - simple and correct for a small, dashboard-
                // widget-scale set of subscriptions rather than high-churn use.
                if (this.ws?.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ forget_all: 'ticks' }));
                    this.tick_subscribers.forEach((_s, sym) => this.sendTicksSubscribe(sym));
                }
            }
        };
    }
}

export const public_market_feed = new PublicMarketFeed();
