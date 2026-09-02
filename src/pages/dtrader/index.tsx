import { lazy, Suspense, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { useStore } from '@/hooks/useStore';
import { toDecimalPlaces } from '@/utils/market-data/last-digit';
import { TActiveSymbol } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';
import useManualTrade from '../bulk-trader/use-manual-trade';
import './dtrader.scss';

// The app's own chart, lazy for the same reason the Charts tab loads it lazily.
const ChartWrapper = lazy(() => import('../chart/chart-wrapper'));

const DEFAULT_SYMBOL = 'R_100';

/** Volatility indices only, the same set every other page here offers. */
const VOLATILITY_SYMBOL = /^(R_\d+|1HZ\d+V)$/;

const MIN_TICKS = 1;
const MAX_TICKS = 10;
const MIN_MINUTES = 1;
const MAX_MINUTES = 60;

type TTradeType = {
    /** A digit the trader picks, and what to call it. */
    barrier_label?: string;
    /** Minutes as well as ticks, the way Deriv offers this contract. */
    has_minutes?: boolean;
    id: string;
    label: string;
    left: string;
    left_label: string;
    right: string;
    right_label: string;
};

/**
 * Every trade type here is one this app can actually buy - the same contract
 * names the Manual and Bulk Trader pages send, through the same code.
 *
 * Deriv's own DTrader also lists Accumulators, Multipliers, Turbos, Vanillas
 * and Touch/No Touch. Those are different contract families with their own
 * parameter sets, and nothing in this build assembles them, so they are not
 * offered rather than shown as tabs that cannot buy anything.
 */
const TRADE_TYPES: TTradeType[] = [
    {
        has_minutes: true,
        id: 'rise_fall',
        label: 'Rise/Fall',
        left: 'CALL',
        left_label: 'Rise',
        right: 'PUT',
        right_label: 'Fall',
    },
    { id: 'even_odd', label: 'Even/Odd', left: 'DIGITEVEN', left_label: 'Even', right: 'DIGITODD', right_label: 'Odd' },
    {
        barrier_label: 'Digit',
        id: 'over_under',
        label: 'Over/Under',
        left: 'DIGITOVER',
        left_label: 'Over',
        right: 'DIGITUNDER',
        right_label: 'Under',
    },
    {
        barrier_label: 'Digit',
        id: 'matches_differs',
        label: 'Matches/Differs',
        left: 'DIGITMATCH',
        left_label: 'Matches',
        right: 'DIGITDIFF',
        right_label: 'Differs',
    },
];

const DTrader = observer(() => {
    const { feed, isConnected } = usePublicMarketFeed();
    const { chart_store, client, oauth_session } = useStore() ?? {};
    const { localize } = useTranslations();
    const trade = useManualTrade();

    const [symbols, setSymbols] = useState<TActiveSymbol[]>([]);
    const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
    const [type_id, setTypeId] = useState('rise_fall');
    const [side, setSide] = useState<'left' | 'right'>('left');
    const [duration, setDuration] = useState(1);
    const [unit, setUnit] = useState<'t' | 'm'>('t');
    const [stake, setStake] = useState(10);
    const [prediction, setPrediction] = useState(5);
    const [allow_equals, setAllowEquals] = useState(false);

    const [price, setPrice] = useState<number | null>(null);
    const [previous_price, setPreviousPrice] = useState<number | null>(null);
    const [decimals, setDecimals] = useState(2);

    const [payout, setPayout] = useState<number | null>(null);
    const [bought, setBought] = useState<string | null>(null);

    const type = TRADE_TYPES.find(item => item.id === type_id) ?? TRADE_TYPES[0];
    const is_logged_in = Boolean(oauth_session?.is_authenticated || client?.is_logged_in);
    const currency = oauth_session?.currency || (is_logged_in && (client?.currency as string)) || 'USD';

    const contract_type = type.id === 'rise_fall' && allow_equals ? (side === 'left' ? 'CALLE' : 'PUTE') : type[side];
    const barrier = type.barrier_label ? prediction : undefined;
    const duration_unit = type.has_minutes ? unit : 't';

    useEffect(() => {
        if (!isConnected) return;
        feed.getActiveSymbols()
            .then(list => setSymbols(list.filter(item => VOLATILITY_SYMBOL.test(item.underlying_symbol))))
            .catch(() => {
                // Non-fatal: the selector keeps the default market.
            });
    }, [isConnected, feed]);

    // The spot beside the market name, off the feed the app already holds open.
    useEffect(() => {
        if (!isConnected) return undefined;
        setPrice(null);
        setPreviousPrice(null);
        return feed.subscribeTicks(symbol, tick => {
            setDecimals(toDecimalPlaces(tick.pip_size) ?? 2);
            setPrice(current => {
                setPreviousPrice(current);
                return tick.quote;
            });
        });
    }, [isConnected, feed, symbol]);

    // The chart follows the market picked here rather than keeping its own.
    useEffect(() => {
        chart_store?.onSymbolChange?.(symbol);
    }, [chart_store, symbol]);

    /**
     * The payout Deriv quotes for exactly these parameters.
     *
     * Asked for fresh whenever they change, and cleared the moment they do, so
     * the figure on the button is never a payout for a trade the trader is no
     * longer looking at. Nothing is estimated here - if the request cannot be
     * made or is refused, it shows nothing rather than a number of our own.
     */
    useEffect(() => {
        setPayout(null);
        if (!is_logged_in || !api_base.api || !api_base.is_authorized) return undefined;

        let cancelled = false;
        const request: Record<string, unknown> = {
            proposal: 1,
            amount: stake,
            basis: 'stake',
            contract_type,
            currency,
            duration,
            duration_unit,
            ...(api_base.is_otp_transport ? { underlying_symbol: symbol } : { symbol }),
        };
        if (barrier !== undefined) request.barrier = barrier;

        api_base.api
            .send(request)
            .then((response: Record<string, unknown>) => {
                if (cancelled) return;
                const proposal = response?.proposal as { payout?: number } | undefined;
                setPayout(proposal?.payout ?? null);
            })
            .catch(() => {
                if (!cancelled) setPayout(null);
            });

        return () => {
            cancelled = true;
        };
    }, [barrier, contract_type, currency, duration, duration_unit, is_logged_in, stake, symbol]);

    const buy = async () => {
        setBought(null);
        const opened = await trade.placeTrades({ barrier, contract_type, duration, duration_unit, stake, symbol }, 1);
        if (opened) setBought(localize('Contract bought. It is in your Transactions panel.'));
    };

    const change = price !== null && previous_price !== null ? price - previous_price : null;
    const max_duration = duration_unit === 'm' ? MAX_MINUTES : MAX_TICKS;
    const min_duration = duration_unit === 'm' ? MIN_MINUTES : MIN_TICKS;

    return (
        <div className='mw-dt'>
            {/* Only the contract families this app can buy. */}
            <nav className='mw-dt__types' aria-label={localize('Trade types')}>
                {TRADE_TYPES.map(item => (
                    <button
                        key={item.id}
                        type='button'
                        className={`mw-dt__type${item.id === type_id ? ' mw-dt__type--on' : ''}`}
                        aria-pressed={item.id === type_id}
                        onClick={() => {
                            setTypeId(item.id);
                            setSide('left');
                            if (!item.has_minutes) setUnit('t');
                        }}
                    >
                        {localize(item.label)}
                    </button>
                ))}
            </nav>

            <div className='mw-dt__body'>
                <section className='mw-dt__chart-side'>
                    <div className='mw-dt__market'>
                        <select
                            value={symbol}
                            aria-label={localize('Market')}
                            onChange={event => setSymbol(event.target.value)}
                        >
                            {symbols.length === 0 && <option value={symbol}>{symbol}</option>}
                            {symbols.map(item => (
                                <option key={item.underlying_symbol} value={item.underlying_symbol}>
                                    {item.underlying_symbol_name}
                                </option>
                            ))}
                        </select>
                        <span
                            className={`mw-dt__spot${change === null ? '' : change < 0 ? ' mw-dt__spot--down' : ' mw-dt__spot--up'}`}
                        >
                            {price === null ? '--' : price.toFixed(decimals)}
                        </span>
                    </div>

                    <div className='mw-dt__chart'>
                        <p className='mw-dt__chart-waiting'>{localize('Starting the chart...')}</p>
                        <Suspense fallback={null}>
                            <ChartWrapper show_digits_stats={false} />
                        </Suspense>
                    </div>
                </section>

                <aside className='mw-dt__ticket'>
                    <h2>{localize(type.label)}</h2>

                    <div className='mw-dt__sides'>
                        <button
                            type='button'
                            className={`mw-dt__side${side === 'left' ? ' mw-dt__side--on' : ''}`}
                            onClick={() => setSide('left')}
                        >
                            {localize(type.left_label)}
                        </button>
                        <button
                            type='button'
                            className={`mw-dt__side${side === 'right' ? ' mw-dt__side--on' : ''}`}
                            onClick={() => setSide('right')}
                        >
                            {localize(type.right_label)}
                        </button>
                    </div>

                    <label className='mw-dt__field'>
                        <span>{localize('Duration')}</span>
                        <input
                            type='number'
                            min={min_duration}
                            max={max_duration}
                            value={duration}
                            onChange={event =>
                                setDuration(
                                    Math.min(
                                        max_duration,
                                        Math.max(min_duration, Number(event.target.value) || min_duration)
                                    )
                                )
                            }
                        />
                        {type.has_minutes ? (
                            <select
                                value={unit}
                                aria-label={localize('Duration unit')}
                                onChange={event => {
                                    const next = event.target.value as 't' | 'm';
                                    setUnit(next);
                                    setDuration(next === 'm' ? MIN_MINUTES : MIN_TICKS);
                                }}
                            >
                                <option value='t'>{localize('ticks')}</option>
                                <option value='m'>{localize('minutes')}</option>
                            </select>
                        ) : (
                            <i>{localize('ticks')}</i>
                        )}
                    </label>

                    <label className='mw-dt__field'>
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

                    {type.barrier_label && (
                        <label className='mw-dt__field'>
                            <span>{localize(type.barrier_label)}</span>
                            <select value={prediction} onChange={event => setPrediction(Number(event.target.value))}>
                                {Array.from({ length: 10 }, (_, digit) => (
                                    <option key={digit} value={digit}>
                                        {digit}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}

                    {type.id === 'rise_fall' && (
                        <label className='mw-dt__toggle'>
                            <span>{localize('Allow equals')}</span>
                            <input
                                type='checkbox'
                                checked={allow_equals}
                                onChange={event => setAllowEquals(event.target.checked)}
                            />
                        </label>
                    )}

                    {bought && <p className='mw-dt__ok'>{bought}</p>}
                    {trade.error_message && <p className='mw-dt__error'>{trade.error_message}</p>}

                    <button
                        type='button'
                        className='mw-dt__buy'
                        onClick={buy}
                        disabled={!is_logged_in || trade.is_placing}
                    >
                        <b>{trade.is_placing ? localize('Buying...') : localize('Buy')}</b>
                        {/* Deriv's own number for these exact parameters, or
                            nothing. It is never worked out here. */}
                        <i>
                            {payout === null
                                ? localize('Payout quoted at purchase')
                                : localize('Payout {{payout}} {{currency}}', {
                                      currency,
                                      payout: payout.toFixed(2),
                                  })}
                        </i>
                    </button>

                    {!is_logged_in && (
                        <p className='mw-dt__note'>{localize('Log in to a Deriv account to buy from here.')}</p>
                    )}
                </aside>
            </div>
        </div>
    );
});

export default DTrader;
