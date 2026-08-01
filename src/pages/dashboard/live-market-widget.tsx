import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { TActiveSymbol, TCandle, TTick } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';
import './live-market-widget.scss';

const DEFAULT_SYMBOL = 'R_100';
const CANDLE_GRANULARITY = 60;
const CANDLE_COUNT = 60;

/**
 * Genuinely live price widget backed by Deriv's public Options WebSocket
 * (usePublicMarketFeed / public-market-feed.ts) - independent of the classic
 * socket and of session type, since it needs no auth. This is a dashboard
 * widget, not a replacement for the SmartCharts-based Charts tab, which
 * stays gated behind the classic connection as established previously.
 */
const LiveMarketWidget = observer(() => {
    const { feed, isConnected } = usePublicMarketFeed();
    const { localize } = useTranslations();
    const [symbols, setSymbols] = useState<TActiveSymbol[]>([]);
    const [selected_symbol, setSelectedSymbol] = useState(DEFAULT_SYMBOL);
    const [candles, setCandles] = useState<TCandle[]>([]);
    const [last_tick, setLastTick] = useState<TTick | null>(null);
    const [recent_ticks, setRecentTicks] = useState<TTick[]>([]);
    const [is_loading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!isConnected) return;
        feed.getActiveSymbols()
            .then(list => {
                // Synthetic indices trade around the clock, so the selector
                // always has something meaningful open rather than a market
                // that happens to be closed right now.
                const synthetics = list.filter(item => item.market === 'synthetic_index');
                setSymbols(synthetics.length ? synthetics : list);
            })
            .catch(() => {
                // Non-fatal: the selector just stays limited to the default symbol.
            });
    }, [isConnected, feed]);

    useEffect(() => {
        if (!isConnected) return undefined;
        let cancelled = false;
        setIsLoading(true);
        setLastTick(null);
        setRecentTicks([]);

        feed.getCandles(selected_symbol, CANDLE_GRANULARITY, CANDLE_COUNT)
            .then(data => {
                if (!cancelled) {
                    setCandles(data);
                    setIsLoading(false);
                }
            })
            .catch(() => {
                if (!cancelled) setIsLoading(false);
            });

        const unsubscribe = feed.subscribeTicks(selected_symbol, tick => {
            setLastTick(tick);
            // Capped to the last 6 real ticks - this is an activity log of
            // actual feed events, not a trade/order history (no such data
            // source exists for an OAuth-only session).
            setRecentTicks(prev => [tick, ...prev].slice(0, 6));
        });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [isConnected, feed, selected_symbol]);

    const selected_symbol_info = symbols.find(item => item.underlying_symbol === selected_symbol);
    const pip_size = selected_symbol_info?.pip_size ?? last_tick?.pip_size ?? 2;

    const prices = useMemo(() => {
        const from_candles = candles.map(candle => candle.close);
        return last_tick ? [...from_candles, last_tick.quote] : from_candles;
    }, [candles, last_tick]);

    const first_price = prices[0];
    const current_price = last_tick?.quote ?? prices[prices.length - 1];
    const change = first_price != null && current_price != null ? current_price - first_price : null;
    const change_pct = change != null && first_price ? (change / first_price) * 100 : null;
    const is_up = (change ?? 0) >= 0;

    const sparkline_path = useMemo(() => {
        if (prices.length < 2) return '';
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const range = max - min || 1;
        const width = 100;
        const height = 100;
        const step = width / (prices.length - 1);
        return prices
            .map((price, index) => {
                const x = index * step;
                const y = height - ((price - min) / range) * height;
                return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
            })
            .join(' ');
    }, [prices]);

    return (
        <div className='mw-live-market'>
            <div className='mw-live-market__header'>
                <select
                    className='mw-live-market__symbol-select'
                    value={selected_symbol}
                    onChange={event => setSelectedSymbol(event.target.value)}
                    disabled={!symbols.length}
                    aria-label={localize('Select market')}
                >
                    {symbols.length === 0 && <option value={selected_symbol}>{selected_symbol}</option>}
                    {symbols.map(item => (
                        <option key={item.underlying_symbol} value={item.underlying_symbol}>
                            {item.underlying_symbol_name}
                        </option>
                    ))}
                </select>
                <span
                    className={`mw-live-market__status-pill ${isConnected ? 'mw-live-market__status-pill--live' : ''}`}
                >
                    <span className='mw-live-market__status-dot' />
                    {isConnected ? localize('Live') : localize('Connecting…')}
                </span>
            </div>

            <div className='mw-live-market__price-row'>
                <span className='mw-live-market__price'>
                    {current_price != null ? current_price.toFixed(pip_size) : '—'}
                </span>
                {change != null && (
                    <span
                        className={`mw-live-market__change ${is_up ? 'mw-live-market__change--up' : 'mw-live-market__change--down'}`}
                    >
                        {is_up ? '▲' : '▼'} {Math.abs(change).toFixed(pip_size)}
                        {change_pct != null && ` (${change_pct.toFixed(2)}%)`}
                    </span>
                )}
            </div>

            <div className='mw-live-market__chart'>
                {is_loading ? (
                    <span className='mw-live-market__chart-message'>{localize('Loading chart…')}</span>
                ) : sparkline_path ? (
                    <svg viewBox='0 0 100 100' preserveAspectRatio='none' className='mw-live-market__sparkline'>
                        <path
                            d={sparkline_path}
                            className={
                                is_up ? 'mw-live-market__sparkline-path--up' : 'mw-live-market__sparkline-path--down'
                            }
                        />
                    </svg>
                ) : (
                    <span className='mw-live-market__chart-message'>{localize('No data yet')}</span>
                )}
            </div>

            {last_tick && (
                <div className='mw-live-market__quote-row'>
                    <span>
                        {localize('Bid')} <strong>{last_tick.bid.toFixed(pip_size)}</strong>
                    </span>
                    <span>
                        {localize('Ask')} <strong>{last_tick.ask.toFixed(pip_size)}</strong>
                    </span>
                </div>
            )}

            <div className='mw-live-market__activity'>
                <span className='mw-live-market__activity-title'>{localize('Recent activity')}</span>
                {recent_ticks.length === 0 ? (
                    <span className='mw-live-market__chart-message'>{localize('Waiting for ticks…')}</span>
                ) : (
                    <ul className='mw-live-market__activity-list'>
                        {recent_ticks.map((tick, index) => {
                            const previous = recent_ticks[index + 1];
                            const tick_is_up = previous ? tick.quote >= previous.quote : true;
                            return (
                                <li key={`${tick.id}-${tick.epoch}`} className='mw-live-market__activity-row'>
                                    <span className='mw-live-market__activity-time'>
                                        {new Date(tick.epoch * 1000).toLocaleTimeString(undefined, {
                                            hour12: false,
                                        })}
                                    </span>
                                    <span
                                        className={`mw-live-market__activity-quote ${tick_is_up ? 'mw-live-market__activity-quote--up' : 'mw-live-market__activity-quote--down'}`}
                                    >
                                        {tick_is_up ? '▲' : '▼'} {tick.quote.toFixed(pip_size)}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
});

export default LiveMarketWidget;
