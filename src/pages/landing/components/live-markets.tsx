import { useEffect, useState } from 'react';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { useTranslations } from '@deriv-com/translations';
import './live-markets.scss';

// The panel in the approved sketch, with real numbers in it. It shows live
// prices from Deriv's public market feed - the same connection the app
// already opens at start-up (public-market-feed.ts), not a second socket,
// and no login needed.
//
// Deliberately NOT the sketch's buy/sell rows with stakes and profit: those
// would be trades nobody made. Nothing in the product can report executed
// trades to a signed-out visitor, so this reports what genuinely exists -
// each market's latest price, which way it just moved, and when that tick
// arrived.
const SYMBOLS = ['1HZ100V', 'CRASH500', 'BOOM1000'];

type TRow = {
    quote: number;
    previous: number | null;
    pip_size: number;
    epoch: number;
};

const LiveMarkets = () => {
    const { localize } = useTranslations();
    const { feed, isConnected } = usePublicMarketFeed();
    const [names, setNames] = useState<Record<string, string>>({});
    const [rows, setRows] = useState<Record<string, TRow>>({});
    const [now_seconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));

    // Each market's real name, as the API reports it, rather than a label
    // written here that could drift from what Deriv calls it.
    useEffect(() => {
        if (!isConnected) return;
        feed.getActiveSymbols()
            .then(list => {
                const found: Record<string, string> = {};
                list.forEach(symbol => {
                    if (SYMBOLS.includes(symbol.underlying_symbol)) {
                        found[symbol.underlying_symbol] = symbol.underlying_symbol_name;
                    }
                });
                setNames(found);
            })
            .catch(() => {
                // Non-fatal: the rows fall back to the market's code.
            });
    }, [isConnected, feed]);

    useEffect(() => {
        if (!isConnected) return undefined;
        const unsubscribes = SYMBOLS.map(symbol =>
            feed.subscribeTicks(symbol, tick => {
                setRows(previous_rows => ({
                    ...previous_rows,
                    [symbol]: {
                        quote: tick.quote,
                        previous: previous_rows[symbol]?.quote ?? null,
                        pip_size: tick.pip_size,
                        epoch: tick.epoch,
                    },
                }));
            })
        );
        return () => unsubscribes.forEach(unsubscribe => unsubscribe());
    }, [isConnected, feed]);

    // One timer for the whole panel, once a second, so "8s ago" stays true.
    useEffect(() => {
        const id = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000);
        return () => clearInterval(id);
    }, []);

    const renderAge = (epoch: number) => {
        const seconds = Math.max(0, now_seconds - epoch);
        if (seconds < 1) return localize('now');
        return localize('{{seconds}}s ago', { seconds: String(seconds) });
    };

    return (
        <section className='mw-live mw-landing__shell'>
            <div className='mw-live__panel'>
                <header className='mw-live__header'>
                    <span className={`mw-live__dot ${isConnected ? 'mw-live__dot--on' : ''}`} aria-hidden='true' />
                    <h2 className='mw-live__title'>{localize('Live Markets')}</h2>
                    <span className='mw-live__state'>
                        {isConnected ? localize('Live prices from Deriv') : localize('Connecting…')}
                    </span>
                </header>

                <ul className='mw-live__rows'>
                    {SYMBOLS.map(symbol => {
                        const row = rows[symbol];
                        const change = row && row.previous !== null ? row.quote - row.previous : null;
                        const direction = change === null || change === 0 ? 'flat' : change > 0 ? 'up' : 'down';

                        return (
                            <li className='mw-live__row' key={symbol}>
                                <span className='mw-live__market'>{names[symbol] ?? symbol}</span>

                                <span className={`mw-live__chip mw-live__chip--${direction}`}>
                                    {direction === 'up' && localize('UP')}
                                    {direction === 'down' && localize('DOWN')}
                                    {direction === 'flat' && '—'}
                                </span>

                                <span className='mw-live__price'>{row ? row.quote.toFixed(row.pip_size) : '—'}</span>

                                <span className={`mw-live__change mw-live__change--${direction}`}>
                                    {change === null || !row
                                        ? ''
                                        : `${change > 0 ? '+' : ''}${change.toFixed(row.pip_size)}`}
                                </span>

                                <span className='mw-live__age'>{row ? renderAge(row.epoch) : ''}</span>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </section>
    );
};

export default LiveMarkets;
