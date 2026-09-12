import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TActiveSymbol } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';
import { CategoryIcon, ChevronIcon, SearchIcon, StarIcon, SymbolIcon } from './market-icon';

/**
 * The market chip and its list.
 *
 * Two shapes, as Deriv has them. On a desktop a dropdown with the categories
 * down the left and a starred, grouped list on the right. On a phone the whole
 * screen, with each market opening onto its own groups - and Derived opening
 * first onto Baskets and Synthetics, because that is a level Deriv's data
 * actually has (`subgroup`) and its phone list shows.
 *
 * The public feed answers active_symbols in codes only - no display names come
 * back with it (confirmed live: the response carries market, submarket,
 * subgroup, underlying_symbol and underlying_symbol_name, and nothing else) -
 * so the wording below is ours, written the way Deriv writes it. Anything not
 * listed is title-cased from its code, which means a market added later still
 * appears, spelled sensibly, without a code change.
 */

const MARKET_NAMES: Record<string, string> = {
    basket_index: 'Baskets',
    commodities: 'Commodities',
    cryptocurrency: 'Cryptocurrencies',
    forex: 'Forex',
    indices: 'Stock Indices',
    synthetic_index: 'Derived',
};

const SUBGROUP_NAMES: Record<string, string> = {
    baskets: 'Baskets',
    synthetics: 'Synthetics',
};

const SUBMARKET_NAMES: Record<string, string> = {
    americas_OTC: 'Americas',
    asia_oceania_OTC: 'Asia/Oceania',
    commodity_basket: 'Commodity Basket',
    crash_index: 'Crash/Boom',
    energy: 'Energy',
    europe_OTC: 'Europe',
    forex_basket: 'Forex Basket',
    jump_index: 'Jump Indices',
    major_pairs: 'Major Pairs',
    metals: 'Metals',
    minor_pairs: 'Minor Pairs',
    non_stable_coin: 'Cryptocurrencies',
    random_daily: 'Daily Reset Indices',
    random_index: 'Continuous Indices',
    range_index: 'Range Index',
    step_index: 'Step Indices',
};

const FAVOURITES_KEY = 'mw_dtrader_favourites';
const FAVOURITES = '__favourites';

// The width below which the list takes the whole screen. Matches the layout
// breakpoint in dtrader.scss, where the page itself goes to one column.
const NARROW = '(max-width: 1099px)';

const titleCase = (code: string) =>
    code
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

export const marketName = (code: string) => MARKET_NAMES[code] ?? titleCase(code);
const subgroupName = (code: string) => SUBGROUP_NAMES[code] ?? titleCase(code);
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

/** Which shape to draw, kept live so a rotated phone gets the right one. */
const useIsNarrow = () => {
    const [is_narrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(NARROW).matches);

    useEffect(() => {
        const query = window.matchMedia(NARROW);
        const onChange = (event: MediaQueryListEvent) => setIsNarrow(event.matches);
        setIsNarrow(query.matches);
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }, []);

    return is_narrow;
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
    const is_narrow = useIsNarrow();
    const [is_open, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [market, setMarket] = useState<string>('');
    const [open_groups, setOpenGroups] = useState<string[]>([FAVOURITES]);
    const [favourites, setFavourites] = useState<string[]>(readFavourites);
    const root = useRef<HTMLDivElement>(null);

    const active = symbols.find(item => item.underlying_symbol === symbol);

    // Closing on an outside click rather than on blur: the list holds a search
    // box and star buttons, and blur would close it the moment either took
    // focus. The phone sheet covers the screen and closes on its own scrim, so
    // this is only for the dropdown.
    useEffect(() => {
        if (!is_open) return undefined;
        const onPointerDown = (event: MouseEvent) => {
            if (is_narrow) return;
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
    }, [is_narrow, is_open]);

    const markets = useMemo(() => {
        const seen = new Map<string, number>();
        symbols.forEach(item => seen.set(item.market, (seen.get(item.market) ?? 0) + 1));
        return [...seen.keys()].sort((a, b) => marketName(a).localeCompare(marketName(b)));
    }, [symbols]);

    useEffect(() => {
        if (!market && active) setMarket(active.market);
    }, [active, market]);

    // The market being traded is already open on a phone, along with the
    // sub-group it belongs to, so the list opens showing where you are rather
    // than a column of closed headings.
    useEffect(() => {
        if (!active) return;
        setOpenGroups(current => {
            const wanted = [active.market, `${active.market}/${active.subgroup}`];
            const missing = wanted.filter(key => !current.includes(key));
            return missing.length ? [...current, ...missing] : current;
        });
    }, [active]);

    const query = search.trim().toLowerCase();

    /** The submarket groups of a set of symbols, in name order. */
    const groupsOf = (items: TActiveSymbol[]) => {
        const groups = new Map<string, TActiveSymbol[]>();
        items.forEach(item => {
            const key = submarketName(item.submarket);
            groups.set(key, [...(groups.get(key) ?? []), item]);
        });
        return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    };

    /** The sub-groups of one market - Derived has them, the rest do not. */
    const subgroupsOf = (items: TActiveSymbol[]) => {
        const seen = new Map<string, TActiveSymbol[]>();
        items.forEach(item => seen.set(item.subgroup, [...(seen.get(item.subgroup) ?? []), item]));
        const real = [...seen.entries()].filter(([code]) => code && code !== 'none');
        return real.sort((a, b) => subgroupName(a[0]).localeCompare(subgroupName(b[0])));
    };

    const shown = useMemo(() => {
        const matches = symbols.filter(item => {
            if (query) return item.underlying_symbol_name.toLowerCase().includes(query);
            if (market === FAVOURITES) return favourites.includes(item.underlying_symbol);
            return item.market === market;
        });
        return groupsOf(matches);
    }, [favourites, market, query, symbols]);

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

    const toggleGroup = (code: string) =>
        setOpenGroups(current => (current.includes(code) ? current.filter(item => item !== code) : [...current, code]));

    const pick = (underlying_symbol: string) => {
        onChange(underlying_symbol);
        setIsOpen(false);
        setSearch('');
    };

    const row = (item: TActiveSymbol) => (
        <div
            key={item.underlying_symbol}
            className={`mw-dt__markets-row${item.underlying_symbol === symbol ? ' mw-dt__markets-row--on' : ''}`}
        >
            <button type='button' className='mw-dt__markets-pick' onClick={() => pick(item.underlying_symbol)}>
                <SymbolIcon symbol={item.underlying_symbol} />
                <span className='mw-dt__markets-name'>{item.underlying_symbol_name}</span>
                {item.exchange_is_open === 0 && <span className='mw-dt__markets-closed'>{localize('Closed')}</span>}
            </button>
            <button
                type='button'
                className='mw-dt__markets-star'
                aria-label={localize('Favourite')}
                aria-pressed={favourites.includes(item.underlying_symbol)}
                onClick={() => toggleFavourite(item.underlying_symbol)}
            >
                <StarIcon is_on={favourites.includes(item.underlying_symbol)} />
            </button>
        </div>
    );

    const searchBox = (
        <div className='mw-dt__markets-searchbox'>
            <SearchIcon />
            <input
                type='search'
                className='mw-dt__markets-search'
                placeholder={localize('Search...')}
                value={search}
                onChange={event => setSearch(event.target.value)}
            />
        </div>
    );

    /** One heading that opens and closes, with Deriv's artwork for it. */
    const heading = (code: string, label: string, icon_code: string, is_sub = false) => (
        <button
            type='button'
            className={`mw-dt__markets-group${is_sub ? ' mw-dt__markets-group--sub' : ''}`}
            aria-expanded={open_groups.includes(code)}
            onClick={() => toggleGroup(code)}
        >
            {!is_sub && <CategoryIcon code={icon_code} />}
            <span className='mw-dt__markets-group-label'>{label}</span>
            <ChevronIcon is_open={open_groups.includes(code)} />
        </button>
    );

    const chip = (
        <button
            type='button'
            className={`mw-dt__market-chip${is_open ? ' mw-dt__market-chip--open' : ''}`}
            aria-expanded={is_open}
            onClick={() => setIsOpen(open => !open)}
        >
            <span className='mw-dt__market-badge' aria-hidden='true'>
                <SymbolIcon symbol={symbol} />
            </span>
            <span className='mw-dt__market-text'>
                <b>{active?.underlying_symbol_name ?? symbol}</b>
                {/* Price, then the move since the tick before it and what that
                    is as a percentage - the way Deriv writes it. */}
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
    );

    // The phone list: the whole screen, every market a heading that opens onto
    // its own groups. A search covers every market at once, so while there is
    // something typed the headings give way to the matches.
    const sheet = (
        <div className='mw-dt__sheet'>
            <button
                type='button'
                className='mw-dt__sheet-scrim'
                aria-label={localize('Close')}
                onClick={() => setIsOpen(false)}
                tabIndex={-1}
            />
            <div className='mw-dt__markets-sheet' role='dialog' aria-modal='true' aria-label={localize('Markets')}>
                <header className='mw-dt__markets-head'>
                    <h2>{localize('Markets')}</h2>
                    <button
                        type='button'
                        className='mw-dt__markets-close'
                        aria-label={localize('Close')}
                        onClick={() => setIsOpen(false)}
                    >
                        ✕
                    </button>
                </header>

                <div className='mw-dt__markets-list'>
                    {searchBox}

                    <div className='mw-dt__markets-scroll'>
                        {query ? (
                            <>
                                {shown.length === 0 && (
                                    <p className='mw-dt__markets-empty'>{localize('No markets.')}</p>
                                )}
                                {shown.map(([group, items]) => (
                                    <section key={group}>
                                        <h4>{group}</h4>
                                        {items.map(row)}
                                    </section>
                                ))}
                            </>
                        ) : (
                            <>
                                <section>
                                    {heading(FAVOURITES, localize('Favorites'), FAVOURITES)}
                                    {open_groups.includes(FAVOURITES) &&
                                        (favourites.length ? (
                                            symbols.filter(item => favourites.includes(item.underlying_symbol)).map(row)
                                        ) : (
                                            <p className='mw-dt__markets-empty'>
                                                {localize('There are no favorites yet.')}
                                            </p>
                                        ))}
                                </section>

                                {markets.map(code => {
                                    const items = symbols.filter(item => item.market === code);
                                    const subgroups = subgroupsOf(items);
                                    const is_market_open = open_groups.includes(code);
                                    return (
                                        <section key={code}>
                                            {heading(code, marketName(code), code)}
                                            {is_market_open &&
                                                (subgroups.length ? (
                                                    // Derived: Baskets and Synthetics before the
                                                    // groups themselves, as Deriv's own list has it.
                                                    subgroups.map(([subgroup, subgroup_items]) => {
                                                        const key = `${code}/${subgroup}`;
                                                        return (
                                                            <div key={key} className='mw-dt__markets-subgroup'>
                                                                {heading(key, subgroupName(subgroup), subgroup, true)}
                                                                {open_groups.includes(key) &&
                                                                    groupsOf(subgroup_items).map(([group, rows]) => (
                                                                        <div key={group}>
                                                                            <h4>{group}</h4>
                                                                            {rows.map(row)}
                                                                        </div>
                                                                    ))}
                                                            </div>
                                                        );
                                                    })
                                                ) : (
                                                    <>
                                                        {groupsOf(items).map(([group, rows]) => (
                                                            <div key={group}>
                                                                <h4>{group}</h4>
                                                                {rows.map(row)}
                                                            </div>
                                                        ))}
                                                    </>
                                                ))}
                                        </section>
                                    );
                                })}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );

    // The desktop list: categories down the left, the market's own groups on
    // the right.
    const dropdown = (
        <div className='mw-dt__markets' role='dialog' aria-label={localize('Markets')}>
            <div className='mw-dt__markets-side'>
                <h3>{localize('Markets')}</h3>
                <button
                    type='button'
                    className={`mw-dt__markets-cat${market === FAVOURITES ? ' mw-dt__markets-cat--on' : ''}`}
                    onClick={() => setMarket(FAVOURITES)}
                >
                    <CategoryIcon code={FAVOURITES} />
                    {localize('Favorites')}
                </button>
                {markets.map(code => (
                    <button
                        key={code}
                        type='button'
                        className={`mw-dt__markets-cat${market === code ? ' mw-dt__markets-cat--on' : ''}`}
                        onClick={() => setMarket(code)}
                    >
                        <CategoryIcon code={code} />
                        {marketName(code)}
                    </button>
                ))}
            </div>

            <div className='mw-dt__markets-list'>
                {searchBox}
                <div className='mw-dt__markets-scroll'>
                    {shown.length === 0 && <p className='mw-dt__markets-empty'>{localize('No markets.')}</p>}
                    {shown.map(([group, items]) => (
                        <section key={group}>
                            <h4>{group}</h4>
                            {items.map(row)}
                        </section>
                    ))}
                </div>
            </div>
        </div>
    );

    return (
        <div className='mw-dt__market' ref={root}>
            {chip}
            {is_open && (is_narrow ? createPortal(sheet, document.body) : dropdown)}
        </div>
    );
};

export default MarketSelect;
