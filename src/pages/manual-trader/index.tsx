import { useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { redirectToLogin } from '@/components/shared';
import { V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { useStore } from '@/hooks/useStore';
import { getStoredAccessToken } from '@/utils/auth/deriv-oauth';
import { getLastDigit, toDecimalPlaces } from '@/utils/market-data/last-digit';
import { TActiveSymbol } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';
import useManualTrade from '../bulk-trader/use-manual-trade';
import './manual-trader.scss';

const DEFAULT_SYMBOL = 'R_100';
const MAX_TICK_HISTORY = 1000;
const DEFAULT_SAMPLE = 100;
const MIN_SAMPLE = 10;

// Deriv prices tick contracts over 1 to 10 ticks; asking for more comes back
// as a rejected proposal, so the stepper stops where the API does.
const MIN_TICKS = 1;
const MAX_TICKS = 10;

/**
 * Percentage points of lead at which the edge pill lights up. A display
 * threshold and nothing more - it makes a wide gap easy to spot, and says
 * nothing about whether the next tick will follow it.
 */
const STRONG_EDGE = 10;

/**
 * Volatility indices only. The synthetic list also carries Boom, Crash, Jump,
 * Step and Range Break; several of those quote to a precision that leaves the
 * last digit barely moving, which makes a digit reading meaningless on them.
 */
const VOLATILITY_SYMBOL = /^(R_\d+|1HZ\d+V)$/;

type TOutcome = { count: number; label: string; pct: number };

/**
 * Every trade type Deriv offers on these markets, each a pair of opposing
 * contracts - the same map Bulk Trader trades from, so the contract names
 * cannot drift between the two pages. `barrier` marks the ones that need a
 * prediction digit.
 */
const TRADE_TYPES = {
    'Rise/Fall': { barrier: false, left: 'CALL', left_label: 'Rise', right: 'PUT', right_label: 'Fall' },
    'Even/Odd': { barrier: false, left: 'DIGITEVEN', left_label: 'Even', right: 'DIGITODD', right_label: 'Odd' },
    'Over/Under': { barrier: true, left: 'DIGITOVER', left_label: 'Over', right: 'DIGITUNDER', right_label: 'Under' },
    'Matches/Differs': {
        barrier: true,
        left: 'DIGITMATCH',
        left_label: 'Matches',
        right: 'DIGITDIFF',
        right_label: 'Differs',
    },
} as const;

type TTradeType = keyof typeof TRADE_TYPES;

const ManualTrader = observer(() => {
    const { feed, isConnected } = usePublicMarketFeed();
    const { client, oauth_session } = useStore() ?? {};
    const { localize } = useTranslations();
    const trade = useManualTrade();

    const [symbols, setSymbols] = useState<TActiveSymbol[]>([]);
    const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
    const [trade_type, setTradeType] = useState<TTradeType>('Rise/Fall');
    const [sample_size, setSampleSize] = useState(DEFAULT_SAMPLE);
    const [prices, setPrices] = useState<number[]>([]);
    const [decimals, setDecimals] = useState(2);

    const [side, setSide] = useState<'left' | 'right'>('left');
    const [duration, setDuration] = useState(1);
    const [stake, setStake] = useState(1);
    const [prediction, setPrediction] = useState(5);
    const [allow_equals, setAllowEquals] = useState(false);
    // What the last click actually did. The contract itself is recorded in the
    // app's Transactions and Journal panel like any other; this is only so the
    // button the trader just pressed answers for itself.
    const [placed, setPlaced] = useState<string | null>(null);

    const is_logged_in = Boolean(oauth_session?.is_authenticated || client?.is_logged_in);
    /**
     * Whether there is a session to trade on at all - the stores, plus the
     * persisted token behind them.
     *
     * The stores are filled by the app's bootstrap on load, and a press can
     * land in the moment before that finishes; the token is the same session,
     * so reading both means the button is never dead while its own account is
     * still arriving.
     */
    const has_session = is_logged_in || Boolean(getStoredAccessToken() || V2GetActiveToken());
    const currency = oauth_session?.currency || (is_logged_in && (client?.currency as string)) || 'USD';
    const config = TRADE_TYPES[trade_type];

    useEffect(() => {
        if (!isConnected) return;
        feed.getActiveSymbols()
            .then(list => setSymbols(list.filter(item => VOLATILITY_SYMBOL.test(item.underlying_symbol))))
            .catch(() => {
                // Non-fatal: the selector keeps the default market.
            });
    }, [isConnected, feed]);

    // Seeded from history then kept current from the live stream, on the feed
    // the rest of the app already holds open. No second socket.
    const request_id = useRef(0);
    useEffect(() => {
        if (!isConnected) return undefined;
        const id = ++request_id.current;
        setPrices([]);

        feed.getTickHistory(symbol, MAX_TICK_HISTORY)
            .then(({ pip_size, prices: history }) => {
                if (id !== request_id.current) return;
                setDecimals(toDecimalPlaces(pip_size) ?? 2);
                setPrices(history);
            })
            .catch(() => {
                // Non-fatal: the live stream still fills the window.
            });

        const unsubscribe = feed.subscribeTicks(symbol, tick => {
            if (id !== request_id.current) return;
            setDecimals(toDecimalPlaces(tick.pip_size) ?? 2);
            setPrices(prev => [...prev, tick.quote].slice(-MAX_TICK_HISTORY));
        });

        return () => unsubscribe();
    }, [isConnected, feed, symbol]);

    // Rise/Fall reads the gap between consecutive ticks, so a sample of 100
    // comparisons needs 101 prices. Without the extra one the header said 100
    // and the rings summed to 99.
    const window_prices = useMemo(
        () => prices.slice(trade_type === 'Rise/Fall' ? -(sample_size + 1) : -sample_size),
        [prices, sample_size, trade_type]
    );

    /**
     * The outcomes this trade type actually has, counted over the window.
     * Rise/Fall compares each tick with the one before it, so it reads one
     * fewer than the sample; the digit types read every tick in it.
     */
    const outcomes = useMemo<TOutcome[]>(() => {
        if (window_prices.length < 2) return [];

        if (trade_type === 'Rise/Fall') {
            let rise = 0;
            let fall = 0;
            let flat = 0;
            for (let i = 1; i < window_prices.length; i++) {
                if (window_prices[i] > window_prices[i - 1]) rise += 1;
                else if (window_prices[i] < window_prices[i - 1]) fall += 1;
                else flat += 1;
            }
            const total = rise + fall + flat || 1;
            return [
                { count: rise, label: localize('Rise'), pct: (rise / total) * 100 },
                { count: fall, label: localize('Fall'), pct: (fall / total) * 100 },
                { count: flat, label: localize('Flat'), pct: (flat / total) * 100 },
            ];
        }

        const digits = window_prices.map(price => getLastDigit(price, decimals));
        const total = digits.length || 1;

        if (trade_type === 'Even/Odd') {
            const even = digits.filter(digit => digit % 2 === 0).length;
            return [
                { count: even, label: localize('Even'), pct: (even / total) * 100 },
                { count: total - even, label: localize('Odd'), pct: ((total - even) / total) * 100 },
            ];
        }
        if (trade_type === 'Over/Under') {
            const over = digits.filter(digit => digit > prediction).length;
            const under = digits.filter(digit => digit < prediction).length;
            const equal = total - over - under;
            return [
                { count: over, label: localize('Over {{d}}', { d: prediction }), pct: (over / total) * 100 },
                { count: under, label: localize('Under {{d}}', { d: prediction }), pct: (under / total) * 100 },
                { count: equal, label: localize('Equals {{d}}', { d: prediction }), pct: (equal / total) * 100 },
            ];
        }
        const matches = digits.filter(digit => digit === prediction).length;
        return [
            { count: matches, label: localize('Matches {{d}}', { d: prediction }), pct: (matches / total) * 100 },
            {
                count: total - matches,
                label: localize('Differs {{d}}', { d: prediction }),
                pct: ((total - matches) / total) * 100,
            },
        ];
    }, [window_prices, trade_type, prediction, decimals, localize]);

    // The strongest outcome, and how far ahead of the next it is. "Edge" is
    // that gap in percentage points and nothing more - it is a description of
    // the window just read, not a forecast of the next tick.
    const ranked = useMemo(() => [...outcomes].sort((a, b) => b.pct - a.pct), [outcomes]);
    const leader = ranked[0] ?? null;
    const edge = ranked.length > 1 ? ranked[0].pct - ranked[1].pct : 0;

    const latest = window_prices[window_prices.length - 1] ?? null;
    const sample_label = trade_type === 'Rise/Fall' ? Math.max(0, window_prices.length - 1) : window_prices.length;

    /**
     * Buys one contract on the side that is selected. Nothing on this page
     * fires it - it runs on this click and no other.
     *
     * Goes through placeTrades() rather than placeTrade() for a batch of one:
     * that is the path that brings the trading connection up first and owns
     * the placing flag, so the button disables itself while the buy is in
     * flight instead of accepting a second click on top of the first.
     */
    const run = async () => {
        // No account, no contract - so the press does the one thing that leads
        // to a trade rather than nothing at all: it starts the same Deriv
        // sign-in the header's Log in button starts, and the trade is a second
        // press away. A disabled button explained none of this.
        if (!has_session) {
            setPlaced(null);
            redirectToLogin(false);
            return;
        }

        // Allow equals is Deriv's rise-or-equal pair: a tick landing exactly on
        // the entry spot wins instead of losing. Only Rise/Fall has them.
        const equals_type = side === 'left' ? 'CALLE' : 'PUTE';
        const contract_type = trade_type === 'Rise/Fall' && allow_equals ? equals_type : config[side];
        setPlaced(null);
        const opened = await trade.placeTrades(
            {
                barrier: config.barrier ? prediction : undefined,
                contract_type,
                duration,
                stake,
                symbol,
            },
            1
        );
        // A refusal already reports itself through trade.error_message, so
        // silence here means the reason is on screen already.
        if (opened) setPlaced(localize('Contract bought. It is in your Transactions panel.'));
    };

    return (
        <div className='mw-manual'>
            <div className='mw-manual__bar'>
                <label className='mw-manual__card'>
                    <span>{localize('Market')}</span>
                    <select value={symbol} onChange={event => setSymbol(event.target.value)}>
                        {symbols.length === 0 && <option value={symbol}>{symbol}</option>}
                        {symbols.map(item => (
                            <option key={item.underlying_symbol} value={item.underlying_symbol}>
                                {item.underlying_symbol_name}
                            </option>
                        ))}
                    </select>
                </label>

                <label className='mw-manual__card'>
                    <span>{localize('Trade type')}</span>
                    <select value={trade_type} onChange={event => setTradeType(event.target.value as TTradeType)}>
                        {(Object.keys(TRADE_TYPES) as TTradeType[]).map(name => (
                            <option key={name} value={name}>
                                {name}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            <div className='mw-manual__body'>
                <section className='mw-manual__analysis'>
                    <header className='mw-manual__analysis-head'>
                        <div>
                            <span>{localize('Market analysis')}</span>
                            <b>{localize('{{count}} ticks', { count: sample_label })}</b>
                        </div>
                        <label className='mw-manual__sample'>
                            <span>{localize('Sample')}</span>
                            <input
                                type='number'
                                min={MIN_SAMPLE}
                                max={MAX_TICK_HISTORY}
                                value={sample_size}
                                onChange={event =>
                                    setSampleSize(
                                        Math.min(
                                            MAX_TICK_HISTORY,
                                            Math.max(MIN_SAMPLE, Number(event.target.value) || MIN_SAMPLE)
                                        )
                                    )
                                }
                            />
                        </label>
                    </header>

                    <div className='mw-manual__reading'>
                        <div className={`mw-manual__signal${edge >= STRONG_EDGE ? ' mw-manual__signal--strong' : ''}`}>
                            <span>{localize('Current signal')}</span>
                            <strong>{leader ? leader.label : '--'}</strong>
                            <em>{localize('{{edge}}% edge', { edge: edge.toFixed(1) })}</em>
                        </div>

                        <div className='mw-manual__rings'>
                            {outcomes.map(outcome => (
                                <div
                                    key={outcome.label}
                                    className={`mw-manual__ring${outcome === leader ? ' mw-manual__ring--lead' : ''}`}
                                >
                                    <b>{outcome.pct.toFixed(0)}%</b>
                                    <span>{outcome.label}</span>
                                    <i>{localize('{{count}} ticks', { count: outcome.count })}</i>
                                </div>
                            ))}
                            {!outcomes.length && (
                                <p className='mw-manual__empty'>{localize('Waiting for tick data...')}</p>
                            )}
                        </div>

                        <p className='mw-manual__latest'>
                            {localize('Latest tick')} <b>{latest === null ? '--' : latest.toFixed(decimals)}</b>
                        </p>
                    </div>
                </section>

                <aside className='mw-manual__panel'>
                    <header className='mw-manual__panel-head'>
                        <h2>{trade_type}</h2>
                        {!has_session && <span>{localize('Account required')}</span>}
                    </header>

                    <div className='mw-manual__sides'>
                        <button
                            type='button'
                            className={`mw-manual__side${side === 'left' ? ' mw-manual__side--on' : ''}`}
                            onClick={() => setSide('left')}
                        >
                            {config.left_label}
                        </button>
                        <button
                            type='button'
                            className={`mw-manual__side${side === 'right' ? ' mw-manual__side--on' : ''}`}
                            onClick={() => setSide('right')}
                        >
                            {config.right_label}
                        </button>
                    </div>

                    {/* A div rather than a label: the minus and plus are real
                        buttons, and a label would forward their clicks to the
                        input as well. */}
                    <div className='mw-manual__field'>
                        <span>{localize('Duration')}</span>
                        <div className='mw-manual__stepper'>
                            <button
                                type='button'
                                onClick={() => setDuration(current => Math.max(MIN_TICKS, current - 1))}
                                disabled={duration <= MIN_TICKS}
                                aria-label={localize('One tick fewer')}
                            >
                                &minus;
                            </button>
                            <input
                                type='number'
                                min={MIN_TICKS}
                                max={MAX_TICKS}
                                value={duration}
                                aria-label={localize('Duration in ticks')}
                                onChange={event =>
                                    setDuration(
                                        Math.max(
                                            MIN_TICKS,
                                            Math.min(MAX_TICKS, Number(event.target.value) || MIN_TICKS)
                                        )
                                    )
                                }
                            />
                            <button
                                type='button'
                                onClick={() => setDuration(current => Math.min(MAX_TICKS, current + 1))}
                                disabled={duration >= MAX_TICKS}
                                aria-label={localize('One tick more')}
                            >
                                +
                            </button>
                        </div>
                        <i>{localize('ticks')}</i>
                    </div>

                    <label className='mw-manual__field'>
                        <span>{localize('Stake')}</span>
                        <input
                            type='number'
                            min={0.35}
                            step={0.01}
                            value={stake}
                            onChange={event => setStake(Math.max(0.35, Number(event.target.value) || 0.35))}
                        />
                        <i>{currency}</i>
                    </label>

                    {config.barrier && (
                        <label className='mw-manual__field'>
                            <span>{localize('Prediction')}</span>
                            <select value={prediction} onChange={event => setPrediction(Number(event.target.value))}>
                                {Array.from({ length: 10 }, (_, digit) => (
                                    <option key={digit} value={digit}>
                                        {digit}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}

                    {trade_type === 'Rise/Fall' && (
                        <label className='mw-manual__toggle'>
                            <span>{localize('Allow equals')}</span>
                            <input
                                type='checkbox'
                                checked={allow_equals}
                                onChange={event => setAllowEquals(event.target.checked)}
                            />
                        </label>
                    )}

                    <div className='mw-manual__payout'>
                        <div>
                            <span>{localize('Potential payout')}</span>
                            <b>--</b>
                        </div>
                        <div>
                            <span>{localize('Potential return')}</span>
                            <b>--</b>
                        </div>
                    </div>

                    {/* Payout comes back on a proposal, and this page does not
                        ask for one - so it says so rather than showing a number
                        it has not been told. */}
                    <p className='mw-manual__note'>
                        {localize('Payout is quoted by Deriv when the contract is bought.')}
                    </p>

                    {trade.error_message && <p className='mw-manual__error'>{trade.error_message}</p>}
                    {placed && !trade.error_message && <p className='mw-manual__ok'>{placed}</p>}
                    {trade.pending_count > 0 && (
                        <p className='mw-manual__note'>
                            {localize('{{count}} contract still running.', { count: trade.pending_count })}
                        </p>
                    )}

                    <button type='button' className='mw-manual__run' onClick={run} disabled={trade.is_placing}>
                        {trade.is_placing ? localize('Buying...') : has_session ? localize('Run') : localize('Log in')}
                    </button>

                    {!has_session && (
                        <p className='mw-manual__note'>
                            {localize('Log in to a Deriv account to place a trade from here.')}
                        </p>
                    )}
                </aside>
            </div>
        </div>
    );
});

export default ManualTrader;
