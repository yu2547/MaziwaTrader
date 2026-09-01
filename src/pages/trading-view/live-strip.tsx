import { useEffect, useMemo, useRef, useState } from 'react';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { toDecimalPlaces } from '@/utils/market-data/last-digit';
import { TActiveSymbol } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';

/**
 * Volatility indices only - the markets this app actually trades.
 */
const VOLATILITY_SYMBOL = /^(R_\d+|1HZ\d+V)$/;

type TQuote = {
    decimals: number;
    /** Direction of the last tick, which is what colours the price. */
    move: 'up' | 'down' | 'flat';
    name: string;
    quote: number;
    symbol: string;
};

/**
 * "Volatility 100 (1s) Index" is too long to fit a dozen of them across a
 * strip, and the words it loses carry nothing: every market here is a
 * volatility index.
 */
const shortName = (name: string) => name.replace(/^Volatility\s+/, 'Vol ').replace(/\s+Index$/, '');

/**
 * A live spot price for every volatility market, across the top of the chart.
 *
 * The chart below is an iframe on charts.deriv.com, so nothing here can read
 * what symbol it is showing or what timeframe it is on - and on a 24h
 * timeframe a candle takes a day to change, which is why a live chart can look
 * like a still one. This strip is the part that visibly moves.
 *
 * It reads the feed the rest of the app already holds open (Signals, Pro AI
 * and the Manual trader are on the same one) - no second socket, and no price
 * that was not measured.
 */
const LiveStrip = () => {
    const { feed, isConnected } = usePublicMarketFeed();
    const { localize } = useTranslations();

    const [symbols, setSymbols] = useState<TActiveSymbol[]>([]);
    const [quotes, setQuotes] = useState<Record<string, TQuote>>({});

    // The tick handlers are registered once and have to compare against the
    // price as it is now, not the one that existed when they were registered.
    const quotes_ref = useRef<Record<string, TQuote>>({});

    useEffect(() => {
        if (!isConnected) return;
        feed.getActiveSymbols()
            .then(list => setSymbols(list.filter(item => VOLATILITY_SYMBOL.test(item.underlying_symbol))))
            .catch(() => {
                // Non-fatal: the strip stays on its connecting line.
            });
    }, [isConnected, feed]);

    useEffect(() => {
        if (!isConnected || !symbols.length) return undefined;

        let cancelled = false;
        const unsubscribes = symbols.map(item => {
            const symbol = item.underlying_symbol;
            const name = shortName(item.underlying_symbol_name);

            return feed.subscribeTicks(symbol, tick => {
                if (cancelled) return;
                const decimals = toDecimalPlaces(tick.pip_size) ?? 2;
                const previous = quotes_ref.current[symbol];
                // The first tick has nothing to compare against, so it is flat
                // rather than being called a rise it was never measured to be.
                const move: TQuote['move'] = !previous
                    ? 'flat'
                    : tick.quote > previous.quote
                      ? 'up'
                      : tick.quote < previous.quote
                        ? 'down'
                        : previous.move;

                quotes_ref.current = {
                    ...quotes_ref.current,
                    [symbol]: { decimals, move, name, quote: tick.quote, symbol },
                };
                setQuotes(quotes_ref.current);
            });
        });

        return () => {
            cancelled = true;
            unsubscribes.forEach(stop => stop());
        };
    }, [isConnected, feed, symbols]);

    // Sorted by name so a market keeps its place in the strip. Sorting by price
    // or by move would make the whole row jump on every tick.
    const list = useMemo(() => Object.values(quotes).sort((a, b) => a.name.localeCompare(b.name)), [quotes]);

    return (
        <div className='mw-tv-strip'>
            {list.length === 0 ? (
                <span className='mw-tv-strip__waiting'>{localize('Connecting to the market feed...')}</span>
            ) : (
                list.map(item => (
                    <span key={item.symbol} className={`mw-tv-strip__item mw-tv-strip__item--${item.move}`}>
                        <b>{item.name}</b>
                        <i>{item.quote.toFixed(item.decimals)}</i>
                    </span>
                ))
            )}
        </div>
    );
};

export default LiveStrip;
