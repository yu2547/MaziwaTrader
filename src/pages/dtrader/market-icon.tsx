import { ComponentType, useEffect, useState } from 'react';

/**
 * Deriv's own market artwork, drawn beside each symbol and each category in the
 * markets list - the same icons its DTrader uses, from the icon package this
 * app already carries, rather than glyphs of our own.
 *
 * Loaded as two chunks (Markets, Legacy) the first time a list asks for one and
 * then kept for the life of the page: there are nearly 300 market icons, and
 * importing each as its own lazy component would be ninety requests to draw one
 * list. Until the chunk lands, and for a symbol Deriv has no artwork for, the
 * row keeps the space and draws nothing - the name is what identifies it.
 */

type TIconProps = { className?: string; iconSize?: string };
type TIconModule = Record<string, ComponentType<TIconProps>>;

const cache = new Map<string, TIconModule>();

const loaders: Record<string, () => Promise<unknown>> = {
    legacy: () => import('@deriv/quill-icons/Legacy'),
    markets: () => import('@deriv/quill-icons/Markets'),
};

const useIconModule = (key: 'legacy' | 'markets') => {
    const [module_, setModule] = useState<TIconModule | null>(() => cache.get(key) ?? null);

    useEffect(() => {
        if (cache.has(key)) {
            setModule(cache.get(key) ?? null);
            return undefined;
        }
        let alive = true;
        loaders[key]().then(loaded => {
            cache.set(key, loaded as TIconModule);
            if (alive) setModule(loaded as TIconModule);
        });
        return () => {
            alive = false;
        };
    }, [key]);

    return module_;
};

const pascal = (code: string) => code.charAt(0).toUpperCase() + code.slice(1).toLowerCase();

/**
 * The icon's export name for a symbol.
 *
 * Forex and crypto are named after the pair itself, so those are derived;
 * everything else Deriv names its own way - Gold/USD is Goldusd, not Xauusd -
 * so those are listed. A name that does not exist simply draws nothing.
 */
const ICON_NAMES: Record<string, string> = {
    '1HZ100V': 'MarketDerivedVolatility1001sIcon',
    '1HZ10V': 'MarketDerivedVolatility101sIcon',
    '1HZ15V': 'MarketDerivedVolatility151sIcon',
    '1HZ25V': 'MarketDerivedVolatility251sIcon',
    '1HZ30V': 'MarketDerivedVolatility301sIcon',
    '1HZ50V': 'MarketDerivedVolatility501sIcon',
    '1HZ75V': 'MarketDerivedVolatility751sIcon',
    '1HZ90V': 'MarketDerivedVolatility901sIcon',
    BOOM1000: 'MarketDerivedBoom1000Icon',
    BOOM150N: 'MarketDerivedBoom150Icon',
    BOOM300N: 'MarketDerivedBoom300Icon',
    BOOM50: 'MarketDerivedBoom50Icon',
    BOOM500: 'MarketDerivedBoom500Icon',
    BOOM600: 'MarketDerivedBoom600Icon',
    BOOM900: 'MarketDerivedBoom900Icon',
    CRASH1000: 'MarketDerivedCrash1000Icon',
    CRASH150N: 'MarketDerivedCrash150Icon',
    CRASH300N: 'MarketDerivedCrash300Icon',
    CRASH50: 'MarketDerivedCrash50Icon',
    CRASH500: 'MarketDerivedCrash500Icon',
    CRASH600: 'MarketDerivedCrash600Icon',
    CRASH900: 'MarketDerivedCrash900Icon',
    JD10: 'MarketDerivedJump10Icon',
    JD100: 'MarketDerivedJump100Icon',
    JD25: 'MarketDerivedJump25Icon',
    JD50: 'MarketDerivedJump50Icon',
    JD75: 'MarketDerivedJump75Icon',
    OTC_AEX: 'MarketIndicesNetherlands25Icon',
    OTC_AS51: 'MarketIndicesAustralia200Icon',
    OTC_DJI: 'MarketIndicesWallStreet30Icon',
    OTC_FCHI: 'MarketIndicesFrance40Icon',
    OTC_FTSE: 'MarketIndicesUk100Icon',
    OTC_GDAXI: 'MarketIndicesGerman40Icon',
    OTC_HSI: 'MarketIndicesHongKong50Icon',
    OTC_N225: 'MarketIndicesJapan225Icon',
    OTC_NDX: 'MarketIndicesUsTech100Icon',
    OTC_SPC: 'MarketIndicesUs500Icon',
    OTC_SSMI: 'MarketIndicesSwiss20Icon',
    OTC_SX5E: 'MarketIndicesEuro50Icon',
    R_10: 'MarketDerivedVolatility10Icon',
    R_100: 'MarketDerivedVolatility100Icon',
    R_25: 'MarketDerivedVolatility25Icon',
    R_50: 'MarketDerivedVolatility50Icon',
    R_75: 'MarketDerivedVolatility75Icon',
    RB100: 'MarketDerivedRangeBreak100Icon',
    RB200: 'MarketDerivedRangeBreak200Icon',
    RDBEAR: 'MarketDerivedBearIcon',
    RDBULL: 'MarketDerivedBullIcon',
    WLDAUD: 'MarketDerivedAudBasketIcon',
    WLDEUR: 'MarketDerivedEurBasketIcon',
    WLDGBP: 'MarketDerivedGbpBasketIcon',
    WLDUSD: 'MarketDerivedUsdBasketIcon',
    WLDXAU: 'MarketDerivedGoldBasketIcon',
    frxXAGUSD: 'MarketCommoditySilverusdIcon',
    frxXAUUSD: 'MarketCommodityGoldusdIcon',
    frxXPDUSD: 'MarketCommodityPalladiumusdIcon',
    frxXPTUSD: 'MarketCommodityPlatinumusdIcon',
    stpRNG: 'MarketDerivedStepIndices100Icon',
    stpRNG2: 'MarketDerivedStepIndices200Icon',
    stpRNG3: 'MarketDerivedStepIndices300Icon',
    stpRNG4: 'MarketDerivedStepIndices400Icon',
    stpRNG5: 'MarketDerivedStepIndices500Icon',
};

const iconNameFor = (symbol: string) => {
    if (ICON_NAMES[symbol]) return ICON_NAMES[symbol];
    if (symbol.startsWith('frx')) return `MarketForex${pascal(symbol.slice(3))}Icon`;
    if (symbol.startsWith('cry')) return `MarketCryptocurrency${pascal(symbol.slice(3))}Icon`;
    return '';
};

/** The market and sub-group headings, which carry Deriv's category artwork. */
const CATEGORY_ICON_NAMES: Record<string, string> = {
    __favourites: 'LegacyFavoriteOffIcon',
    baskets: 'LegacyBasketIndicesIcon',
    commodities: 'LegacyCommoditiesIcon',
    cryptocurrency: 'LegacyCryptocurrenciesIcon',
    forex: 'LegacyForexIcon',
    indices: 'LegacyStockIndicesIcon',
    synthetic_index: 'LegacyDerivedIcon',
    synthetics: 'LegacySyntheticIndicesIcon',
};

export const SymbolIcon = ({ symbol }: { symbol: string }) => {
    const icons = useIconModule('markets');
    const Icon = icons?.[iconNameFor(symbol)];
    if (!Icon) return <span className='mw-dt__markets-icon' aria-hidden='true' />;
    return <Icon className='mw-dt__markets-icon' iconSize='sm' />;
};

export const CategoryIcon = ({ code }: { code: string }) => {
    const icons = useIconModule('legacy');
    const Icon = icons?.[CATEGORY_ICON_NAMES[code] ?? ''];
    if (!Icon) return <span className='mw-dt__markets-icon' aria-hidden='true' />;
    return <Icon className='mw-dt__markets-icon' iconSize='sm' />;
};

/** The star on each row, filled once the symbol is a favourite. */
export const StarIcon = ({ is_on }: { is_on: boolean }) => {
    const icons = useIconModule('legacy');
    const Icon = icons?.[is_on ? 'LegacyFavoriteOnIcon' : 'LegacyFavoriteOffIcon'];
    if (!Icon) return <span className='mw-dt__markets-star-icon' aria-hidden='true' />;
    return <Icon className='mw-dt__markets-star-icon' iconSize='sm' />;
};

/** The magnifying glass inside the search box. */
export const SearchIcon = () => {
    const icons = useIconModule('legacy');
    const Icon = icons?.LegacySearch2pxIcon;
    if (!Icon) return null;
    return <Icon className='mw-dt__markets-search-icon' iconSize='sm' />;
};

/** The chevron at the end of a heading that opens and closes. */
export const ChevronIcon = ({ is_open }: { is_open: boolean }) => (
    <span className={`mw-dt__markets-chevron${is_open ? ' mw-dt__markets-chevron--up' : ''}`} aria-hidden='true' />
);
