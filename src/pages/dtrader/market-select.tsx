import { useEffect, useMemo, useRef, useState } from 'react';
import { TActiveSymbol } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';

/**
 * The market chip and its dropdown: categories down the left, a search box and
 * a starred, grouped list on the right - the same shape Deriv's own selector
 * has.
 *
 * Every name here comes from active_symbols. Deriv's brief list carries codes
 * rather than display names for the groupings (market `synthetic_index`,
 * submarket `crash_index`), so the map below only supplies the wording for the
 * ones Deriv words specially; anything not in it is title-cased from the code
 * itself, which means a market added later still appears, spelled sensibly,
 * without a code change.
 */

const MARKET_NAMES: Record<string, string> = {
    basket_index: 'Baskets',
    commodities: 'Commodities',
    cryptocurrency: 'Cryptocurrencies',
    forex: 'Forex',
    indices: 'Stock indices',
    synthetic_index: 'Derived',
};

const SUBMARKET_NAMES: Record<string, string> = {
    crash_index: 'Crash/Boom',
    energy: 'Energy',
    forex_basket: 'Forex basket',
    major_pairs: 'Major pairs',
    metals: 'Metals',
    minor_pairs: 'Minor pairs',
    non_stable_coin: 'Cryptocurrencies',
    random_daily: 'Daily reset indices',
    random_index: 'Continuous indices',
    step_index: 'Step indices',
};

const FAVOURITES_KEY = 'mw_dtrader_favourites';

const titleCase = (code: string) =>
    code
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

export const marketName = (code: string) => MARKET_NAMES[code] ?? titleCase(code);
const submarketName = (code: string) => SUBMARKET_NAMES[code] ?? titleCase(code);

const readFavourites = (): string[] => {
    try {
        const raw = localStorage.getItem(FAVOURITES_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        // A browser that refuses storage just has no favourites.
        return [];
    }
};

type TMarketSelectProps = {
    change: number | null;
    decimals: number;
    onChange: (symbol: string) => void;
    price: number | null;
    symbol: string;
    symbols: TActiveSymbol[];
};

const MarketSelect = ({ change, decimals, onChange, price, symbol, symbols }: TMarketSelectProps) => {
    const { localize } = useTranslations();
    const [is_open, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [market, setMarket] = useState<string>('');
    const [favourites, setFavourites] = useState<string[]>(readFavourites);
    const root = useRef<HTMLDivElement>(null);

    const active = symbols.find(item => item.underlying_symbol === symbol);

    // Closing on an outside click rather than on blur: the dropdown holds a
    // search box and star buttons, and blur would close it the moment either
    // took focus.
    useEffect(() => {
        if (!is_open) return undefined;
        const onPointerDown = (event: MouseEvent) => {
            if (!root.current?.contains(event.target as Node)) setIsOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [is_open]);

    const markets = useMemo(() => {
        const seen = new Map<string, number>();
        symbols.forEach(item => seen.set(item.market, (seen.get(item.market) ?? 0) + 1));
        return [...seen.keys()].sort((a, b) => marketName(a).localeCompare(marketName(b)));
    }, [symbols]);

    useEffect(() => {
        if (!market && active) setMarket(active.market);
    }, [active, market]);

    const shown = useMemo(() => {
        const query = search.trim().toLowerCase();
        const matches = symbols.filter(item => {
            if (query) return item.underlying_symbol_name.toLowerCase().includes(query);
            if (market === '__favourites') return favourites.includes(item.underlying_symbol);
            return item.market === market;
        });

        const groups = new Map<string, TActiveSymbol[]>();
        matches.forEach(item => {
            const key = submarketName(item.submarket);
            groups.set(key, [...(groups.get(key) ?? []), item]);
        });
        return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }, [favourites, market, search, symbols]);

    const toggleFavourite = (underlying_symbol: string) => {
        setFavourites(current => {
            const next = current.includes(underlying_symbol)
                ? current.filter(item => item !== underlying_symbol)
                : [...current, underlying_symbol];
            try {
                localStorage.setItem(FAVOURITES_KEY, JSON.stringify(next));
            } catch {
                // Not being able to remember them is not a reason to refuse the click.
            }
            return next;
        });
    };

    return (
        <div className='mw-dt__market' ref={root}>
            <button
                type='button'
                className={`mw-dt__market-chip${is_open ? ' mw-dt__market-chip--open' : ''}`}
                aria-expanded={is_open}
                onClick={() => setIsOpen(open => !open)}
            >
                <span className='mw-dt__market-badge' aria-hidden='true'>
                    {active?.underlying_symbol_name?.match(/\d+/)?.[0] ?? '~'}
                </span>
                <span className='mw-dt__market-text'>
                    <b>{active?.underlying_symbol_name ?? symbol}</b>
                    {/* Price, then the move since the tick before it and what
                        that is as a percentage - the way Deriv writes it. */}
                    <i>
                        {price === null ? '--' : price.toFixed(decimals)}
                        {change !== null && price !== null && (
                            <em className={change >= 0 ? 'mw-dt__up' : 'mw-dt__down'}>
                                {` ${change >= 0 ? '+' : '-'}${Math.abs(change).toFixed(decimals)}`}
                                {` (${Math.abs((change / (price - change || price)) * 100).toFixed(2)}%)`}
                                {change >= 0 ? ' ▲' : ' ▼'}
                            </em>
                        )}
                    </i>
                </span>
                <span className='mw-dt__market-caret' aria-hidden='true'>
                    {is_open ? '▲' : '▼'}
                </span>
            </button>

            {is_open && (
                <div className='mw-dt__markets' role='dialog' aria-label={localize('Markets')}>
                    <div className='mw-dt__markets-side'>
                        <h3>{localize('Markets')}</h3>
                        <button
                            type='button'
                            className={`mw-dt__markets-cat${market === '__favourites' ? ' mw-dt__markets-cat--on' : ''}`}
                            onClick={() => setMarket('__favourites')}
                        >
                            ☆ {localize('Favourites')}
                        </button>
                        {markets.map(code => (
                            <button
                                key={code}
                                type='button'
                                className={`mw-dt__markets-cat${market === code ? ' mw-dt__markets-cat--on' : ''}`}
                                onClick={() => setMarket(code)}
                            >
                                {marketName(code)}
                            </button>
                        ))}
                    </div>

                    <div className='mw-dt__markets-list'>
                        <input
                            type='search'
                            className='mw-dt__markets-search'
                            placeholder={localize('Search...')}
                            value={search}
                            onChange={event => setSearch(event.target.value)}
                        />
                        <div className='mw-dt__markets-scroll'>
                            {shown.length === 0 && <p className='mw-dt__markets-empty'>{localize('No markets.')}</p>}
                            {shown.map(([group, items]) => (
                                <section key={group}>
                                    <h4>{group}</h4>
                                    {items.map(item => (
                                        <div
                                            key={item.underlying_symbol}
                                            className={`mw-dt__markets-row${
                                                item.underlying_symbol === symbol ? ' mw-dt__markets-row--on' : ''
                                            }`}
                                        >
                                            <button
                                                type='button'
                                                className='mw-dt__markets-pick'
                                                onClick={() => {
                                                    onChange(item.underlying_symbol);
                                                    setIsOpen(false);
                                                    setSearch('');
                                                }}
                                            >
                                                {item.underlying_symbol_name}
                                                {item.exchange_is_open === 0 && (
                                                    <span className='mw-dt__markets-closed'>{localize('Closed')}</span>
                                                )}
                                            </button>
                                            <button
                                                type='button'
                                                className='mw-dt__markets-star'
                                                aria-label={localize('Favourite')}
                                                aria-pressed={favourites.includes(item.underlying_symbol)}
                                                onClick={() => toggleFavourite(item.underlying_symbol)}
                                            >
                                                {favourites.includes(item.underlying_symbol) ? '★' : '☆'}
                                            </button>
                                        </div>
                                    ))}
                                </section>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MarketSelect;
