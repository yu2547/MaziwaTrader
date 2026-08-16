import { startTransition, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import { DBOT_TABS } from '@/constants/bot-contents';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { useStore } from '@/hooks/useStore';
import { getLastDigit, toDecimalPlaces } from '@/utils/market-data/last-digit';
import { TActiveSymbol } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';

/**
 * Ranks the available markets for a digits Over/Under entry, from real tick
 * history - the same feed Dcircles reads, through the same shared connection.
 *
 * The scan is the whole point of this panel, so it is a real measurement: for
 * every market it pulls `scan_depth` ticks, takes the last digit of each at
 * that market's own precision, and counts how often each side of the pair
 * would have won. Markets are then ordered by the weaker of their two sides,
 * because a pair is only as good as the half that fails first. No score here
 * is estimated or generated.
 */

type TMode = 'O1/U8' | 'O2/U7' | 'O3/U6';

const MODES: { id: TMode; over: number; under: number; label: string }[] = [
    { id: 'O1/U8', over: 1, under: 8, label: 'Over1 / Under8' },
    { id: 'O2/U7', over: 2, under: 7, label: 'Over2 / Under7' },
    { id: 'O3/U6', over: 3, under: 6, label: 'Over3 / Under6' },
];

const SCAN_BATCH = 5;
const MIN_DEPTH = 100;
const MAX_DEPTH = 5000;

/**
 * The markets the scan covers: the 1-second volatility indices and their
 * standard counterparts. Named the way Deriv names them in active_symbols, so
 * the symbol codes are read from the API rather than written here - whatever
 * `underlying_symbol` it returns for "Volatility 75 (1s) Index" is what gets
 * scanned.
 *
 * Scanning all 46 synthetics meant ranking Boom, Crash, Jump, Step and the
 * baskets against each other, which is not the comparison this panel is for.
 */
const SCAN_MARKETS = [
    'Volatility 100 (1s) Index',
    'Volatility 90 (1s) Index',
    'Volatility 75 (1s) Index',
    'Volatility 50 (1s) Index',
    'Volatility 25 (1s) Index',
    'Volatility 15 (1s) Index',
    'Volatility 10 (1s) Index',
    'Volatility 100 Index',
    'Volatility 75 Index',
    'Volatility 50 Index',
    'Volatility 25 Index',
    'Volatility 10 Index',
];

type TResult = {
    symbol: string;
    name: string;
    over_rate: number;
    under_rate: number;
    /** The weaker side - what the pair is actually worth. */
    score: number;
};

const EntryScanner = observer(({ onClose }: { onClose: () => void }) => {
    const { feed, isConnected } = usePublicMarketFeed();
    const { dashboard, quick_strategy } = useStore() ?? {};
    const { localize } = useTranslations();
    const navigate = useNavigate();

    const [mode, setMode] = useState<TMode>('O1/U8');
    const [scan_depth, setScanDepth] = useState(3000);
    const [symbols, setSymbols] = useState<TActiveSymbol[]>([]);
    const [is_scanning, setIsScanning] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [best, setBest] = useState<TResult | null>(null);
    const [status, setStatus] = useState('');

    const active_mode = MODES.find(item => item.id === mode) ?? MODES[0];

    useEffect(() => {
        if (!isConnected) return;
        feed.getActiveSymbols()
            .then(list => {
                const by_name = new Map(list.map(item => [item.underlying_symbol_name, item]));
                const wanted = SCAN_MARKETS.map(name => by_name.get(name)).filter(
                    (item): item is TActiveSymbol => !!item
                );
                // Falls back to every synthetic rather than to nothing, so a
                // renamed market costs coverage, not the whole scan.
                const synthetics = list.filter(item => item.market === 'synthetic_index');
                setSymbols(wanted.length ? wanted : synthetics);
            })
            .catch(() => {
                setStatus(localize('Could not load the market list.'));
            });
    }, [isConnected, feed, localize]);

    const scanMarkets = async () => {
        if (is_scanning || symbols.length === 0) return;
        setIsScanning(true);
        setBest(null);
        setProgress({ done: 0, total: symbols.length });
        setStatus(localize('Scanning {{count}} markets…', { count: symbols.length }));

        const results: TResult[] = [];
        let done = 0;

        for (let i = 0; i < symbols.length; i += SCAN_BATCH) {
            const batch = symbols.slice(i, i + SCAN_BATCH);
            // eslint-disable-next-line no-await-in-loop
            const settled = await Promise.all(
                batch.map(async item => {
                    try {
                        const { prices, pip_size } = await feed.getTickHistory(item.underlying_symbol, scan_depth);
                        if (!prices.length) return null;
                        const places = toDecimalPlaces(pip_size) ?? 2;
                        const digits = prices.map(price => getLastDigit(price, places));
                        const over = digits.filter(digit => digit > active_mode.over).length / digits.length;
                        const under = digits.filter(digit => digit < active_mode.under).length / digits.length;
                        return {
                            symbol: item.underlying_symbol,
                            name: item.underlying_symbol_name,
                            over_rate: over * 100,
                            under_rate: under * 100,
                            score: Math.min(over, under) * 100,
                        } satisfies TResult;
                    } catch {
                        return null;
                    }
                })
            );
            settled.forEach(result => {
                if (result) results.push(result);
            });
            done += batch.length;
            setProgress({ done, total: symbols.length });
        }

        results.sort((a, b) => b.score - a.score);
        const winner = results[0] ?? null;
        setBest(winner);
        setIsScanning(false);
        setStatus(
            winner
                ? localize('Scanned {{count}} markets over {{depth}} ticks each.', {
                      count: results.length,
                      depth: scan_depth,
                  })
                : localize('No market returned enough history to rank.')
        );
    };

    const loadScannerBot = () => {
        if (!best) return;
        startTransition(() => {
            navigate('/');
            dashboard?.setActiveTab(DBOT_TABS.BOT_BUILDER);
            quick_strategy?.setFormVisibility(true);
        });
        onClose();
    };

    return (
        <div className='mw-scanner' role='dialog' aria-modal='true' aria-label={localize('Entry Scanner')}>
            <div className='mw-scanner__backdrop' onClick={onClose} />
            <div className='mw-scanner__sheet'>
                <div className='mw-scanner__head'>
                    <h2>{localize('Entry Scanner')}</h2>
                    <button type='button' onClick={onClose} aria-label={localize('Close')}>
                        ✕
                    </button>
                </div>

                <div className='mw-scanner__body'>
                    <div className='mw-scanner__hero'>
                        <span className='mw-scanner__hero-pill'>✦ {localize('RECOVERY ENGINE')}</span>
                        <h3>{localize('Digits Scanner')}</h3>
                        <p>
                            {localize('Scans Over {{over}} and Under {{under}} across every market.', {
                                over: active_mode.over,
                                under: active_mode.under,
                            })}
                        </p>
                        <span className='mw-scanner__hero-orb'>AI</span>
                    </div>

                    <div className='mw-scanner__modes'>
                        {MODES.map(item => (
                            <button
                                key={item.id}
                                type='button'
                                className={`mw-scanner__mode ${mode === item.id ? 'mw-scanner__mode--active' : ''}`}
                                onClick={() => setMode(item.id)}
                                disabled={is_scanning}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>

                    <div className='mw-scanner__fields'>
                        <label className='mw-scanner__field'>
                            <span>{localize('SCAN DEPTH')}</span>
                            <input
                                type='number'
                                value={scan_depth}
                                min={MIN_DEPTH}
                                max={MAX_DEPTH}
                                step={100}
                                disabled={is_scanning}
                                onChange={event =>
                                    setScanDepth(
                                        Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, Number(event.target.value) || 0))
                                    )
                                }
                            />
                        </label>
                        <div className='mw-scanner__field mw-scanner__field--static'>
                            <span>{localize('MODE')}</span>
                            <strong>{active_mode.id}</strong>
                        </div>
                        <div className='mw-scanner__field mw-scanner__field--static'>
                            <span>{localize('MARKETS')}</span>
                            <strong>{symbols.length || '—'}</strong>
                        </div>
                    </div>

                    <div className='mw-scanner__fields mw-scanner__fields--two'>
                        <div className='mw-scanner__field mw-scanner__field--static'>
                            <span>{localize('SELECTED MARKET')}</span>
                            <strong>{best ? best.name : localize('Scan to find the best market')}</strong>
                        </div>
                        <div className='mw-scanner__field mw-scanner__field--static'>
                            <span>{localize('TRADE TYPE')}</span>
                            <strong>
                                {best
                                    ? localize('Over {{over}} / Under {{under}}', {
                                          over: active_mode.over,
                                          under: active_mode.under,
                                      })
                                    : localize('Waiting for scan')}
                            </strong>
                        </div>
                    </div>

                    <div className='mw-scanner__status'>
                        {is_scanning
                            ? `${status} (${progress.done}/${progress.total})`
                            : best
                              ? localize('{{name}} — Over {{over}} won {{o}}%, Under {{under}} won {{u}}%. {{note}}', {
                                    name: best.name,
                                    over: active_mode.over,
                                    under: active_mode.under,
                                    o: best.over_rate.toFixed(2),
                                    u: best.under_rate.toFixed(2),
                                    note: status,
                                })
                              : status || localize('Not scanned yet')}
                    </div>

                    <div className='mw-scanner__actions'>
                        <button
                            type='button'
                            className='mw-scanner__scan'
                            onClick={scanMarkets}
                            disabled={is_scanning || symbols.length === 0}
                        >
                            {is_scanning ? localize('Scanning…') : localize('Scan Markets')}
                        </button>
                        <button
                            type='button'
                            className='mw-scanner__load'
                            onClick={loadScannerBot}
                            disabled={!best}
                            // Opens the app's own trading configuration rather
                            // than writing a strategy nobody specified. The
                            // scan result above is what to enter into it.
                            title={localize('Opens the bot builder configuration')}
                        >
                            {localize('Load Scanner Bot')}
                        </button>
                    </div>

                    <p className='mw-scanner__note'>
                        {localize(
                            'Every percentage above is counted from real tick history on the market it names. Past behaviour is not a prediction - it is what already happened.'
                        )}
                    </p>
                </div>
            </div>
        </div>
    );
});

export default EntryScanner;
