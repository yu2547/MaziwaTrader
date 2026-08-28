import { startTransition, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import { DBOT_TABS } from '@/constants/bot-contents';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { useStore } from '@/hooks/useStore';
import { getLastDigit, toDecimalPlaces } from '@/utils/market-data/last-digit';
import { TActiveSymbol } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';

/**
 * Ranks markets for a digits Over/Under entry from real tick history - the
 * same feed the analysis views read, over the same shared connection - and
 * hands the winner to the app's own strategy loader.
 *
 * Every number on this panel is counted, never estimated. The composite score
 * is the one derived figure and its formula is stated in scoreOf() below
 * rather than left to look like a black box.
 */

type TMode = 'O1/U8' | 'O2/U7' | 'O3/U6';

const MODES: {
    id: TMode;
    over: number;
    under: number;
    label: string;
    badge: string;
    title: string;
    blurb: string;
}[] = [
    {
        id: 'O1/U8',
        over: 1,
        under: 8,
        label: 'Over1 / Under8',
        badge: 'RECOVERY ENGINE',
        title: 'Digits Scanner',
        blurb: 'Scans Over 1 and Under 8 with recovery confirmation.',
    },
    {
        id: 'O2/U7',
        over: 2,
        under: 7,
        label: 'Over2 / Under7',
        badge: 'PATTERN HUNTER',
        title: 'Even/Odd Precision',
        blurb: 'Scans Over 2 and Under 7 using the same recovery flow.',
    },
    {
        id: 'O3/U6',
        over: 3,
        under: 6,
        label: 'Over3 / Under6',
        badge: 'TREND PULSE',
        title: 'Rise/Fall Filter',
        blurb: 'Scans Over 3 and Under 6 using the same recovery flow.',
    },
];

/**
 * The markets the scan covers: the 1-second volatility indices and their
 * standard counterparts. Named the way Deriv names them in active_symbols, so
 * the symbol codes are read from the API rather than written here.
 */
const SCAN_MARKETS = [
    'Volatility 100 (1s) Index',
    'Volatility 90 (1s) Index',
    'Volatility 75 (1s) Index',
    'Volatility 50 (1s) Index',
    'Volatility 30 (1s) Index',
    'Volatility 25 (1s) Index',
    'Volatility 15 (1s) Index',
    'Volatility 10 (1s) Index',
    'Volatility 100 Index',
    'Volatility 75 Index',
    'Volatility 50 Index',
    'Volatility 25 Index',
    'Volatility 10 Index',
];

const MIN_DEPTH = 100;
const MAX_DEPTH = 5000;
const RECENT_WINDOW = 200;

type TResult = {
    symbol: string;
    name: string;
    win_rate: number;
    recent_rate: number;
    under_rate: number;
    samples: number;
    score: number;
    hottest: number;
    coldest: number;
    missing: number[];
    low_streak: number;
    high_streak: number;
    character: string;
};

/**
 * The composite. Weighted 60/40 toward the full sample over the most recent
 * {RECENT_WINDOW} ticks, then held back by the gap between them - a market
 * whose recent behaviour has drifted from its own history scores lower than
 * one that has been steady, at the same headline rate.
 */
const scoreOf = (win_rate: number, recent_rate: number) => {
    const blended = win_rate * 0.6 + recent_rate * 0.4;
    const drift = Math.abs(win_rate - recent_rate);
    return Math.max(0, blended - drift / 2);
};

const analyse = (digits: number[], over: number, under: number) => {
    const total = digits.length || 1;
    const counts = new Array(10).fill(0);
    digits.forEach(digit => {
        counts[digit] += 1;
    });

    const wins = digits.filter(digit => digit > over).length;
    const recent_slice = digits.slice(0, RECENT_WINDOW);
    const recent_wins = recent_slice.filter(digit => digit > over).length;
    const unders = digits.filter(digit => digit < under).length;

    let hottest = 0;
    let coldest = 0;
    counts.forEach((count, digit) => {
        if (count > counts[hottest]) hottest = digit;
        if (count < counts[coldest]) coldest = digit;
    });
    const missing = counts.map((count, digit) => ({ count, digit })).filter(entry => entry.count === 0);

    // The longest run on each side of the threshold - how long the market has
    // gone without the entry, and how long it has stayed with it.
    let low_streak = 0;
    let high_streak = 0;
    let run_low = 0;
    let run_high = 0;
    digits.forEach(digit => {
        if (digit > over) {
            run_high += 1;
            run_low = 0;
        } else {
            run_low += 1;
            run_high = 0;
        }
        low_streak = Math.max(low_streak, run_low);
        high_streak = Math.max(high_streak, run_high);
    });

    const win_rate = (wins / total) * 100;
    const recent_rate = (recent_slice.length ? recent_wins / recent_slice.length : 0) * 100;

    return {
        win_rate,
        recent_rate,
        under_rate: (unders / total) * 100,
        samples: digits.length,
        score: scoreOf(win_rate, recent_rate),
        hottest,
        coldest,
        missing: missing.map(entry => entry.digit),
        low_streak,
        high_streak,
        // A plain description of what the numbers say, not a verdict.
        character:
            recent_rate > win_rate + 2 ? 'Momentum Burst' : recent_rate < win_rate - 2 ? 'Cooling Off' : 'Steady',
    };
};

const EntryScanner = observer(
    ({ onClose, onScanningChange }: { onClose: () => void; onScanningChange?: (scanning: boolean) => void }) => {
        const { feed, isConnected } = usePublicMarketFeed();
        const { dashboard, quick_strategy, run_panel } = useStore() ?? {};
        const { localize } = useTranslations();
        const navigate = useNavigate();

        const [mode, setMode] = useState<TMode>('O1/U8');
        const [scan_depth, setScanDepth] = useState(1000);
        const [symbols, setSymbols] = useState<TActiveSymbol[]>([]);
        const [is_scanning, setIsScanning] = useState(false);

        // Mirrors the scan state out to the floating button so it can show it is
        // working. Reported rather than duplicated - this stays the only place the
        // flag is set, so the two cannot disagree. The cleanup clears it, otherwise
        // closing the scanner mid-scan would leave the orb spinning for good.
        useEffect(() => {
            onScanningChange?.(is_scanning);
        }, [is_scanning, onScanningChange]);

        useEffect(() => () => onScanningChange?.(false), [onScanningChange]);

        // A scan is a sequential await-loop over every market, so closing the
        // scanner part-way through left it running to completion against a
        // component that no longer exists: it kept requesting tick history for
        // the remaining markets, and kept calling setProgress/setStatus/setBest
        // on the way. usePublicMarketFeed releases its handle on unmount too,
        // so those requests were being made against a feed this panel had
        // already let go of.
        // The loop checks this between markets and stops at the next boundary.
        const is_live = useRef(true);
        useEffect(() => {
            is_live.current = true;
            return () => {
                is_live.current = false;
            };
        }, []);

        // The panel already declares role="dialog" aria-modal="true", which
        // promises modal behaviour it did not implement: Escape did nothing,
        // and focus stayed behind on the orb, so a keyboard or screen-reader
        // user landed in a dialog they could neither reach nor dismiss.
        useEffect(() => {
            const onKeyDown = (event: KeyboardEvent) => {
                if (event.key === 'Escape') onClose();
            };
            document.addEventListener('keydown', onKeyDown);
            return () => document.removeEventListener('keydown', onKeyDown);
        }, [onClose]);

        // Move focus in on open and put it back where it was on close, so
        // dismissing the scanner returns the caret to the orb that opened it
        // rather than to the top of the document.
        const sheet_ref = useRef<HTMLDivElement>(null);
        useEffect(() => {
            const previously_focused = document.activeElement as HTMLElement | null;
            sheet_ref.current?.focus();
            return () => previously_focused?.focus?.();
        }, []);
        const [progress, setProgress] = useState({ done: 0, total: 0, market: '' });
        const [best, setBest] = useState<TResult | null>(null);
        const [status, setStatus] = useState('');
        // Kept apart from `status` so a failure reads as one. Every message used to
        // land in the same neutral line, so "Could not load the market list" looked
        // exactly like "Ready to scan" and a scanner that could not run at all was
        // indistinguishable from one waiting to be told to.
        const [is_error, setIsError] = useState(false);
        const [show_params, setShowParams] = useState(false);
        const [params, setParams] = useState({
            stake: 0.5,
            martingale: 2,
            wins: 5,
            digits_to_check: 1,
            stop_loss: 50,
            use_martingale: true,
        });

        const active_mode = MODES.find(item => item.id === mode) ?? MODES[0];

        useEffect(() => {
            if (!isConnected) return;
            feed.getActiveSymbols()
                .then(list => {
                    const by_name = new Map(list.map(item => [item.underlying_symbol_name, item]));
                    const wanted = SCAN_MARKETS.map(name => by_name.get(name)).filter(
                        (item): item is TActiveSymbol => !!item
                    );
                    const synthetics = list.filter(item => item.market === 'synthetic_index');
                    // Same reason as the scan loop: this request outlives a
                    // scanner closed before the market list came back.
                    if (!is_live.current) return;
                    setSymbols(wanted.length ? wanted : synthetics);
                    setIsError(false);
                })
                .catch(() => {
                    if (!is_live.current) return;
                    setIsError(true);
                    setStatus(localize('Could not load the market list. Check your connection and try again.'));
                });
        }, [isConnected, feed, localize]);

        const selectMode = (next: TMode) => {
            setMode(next);
            setBest(null);
            const picked = MODES.find(item => item.id === next);
            setStatus(localize('Ready to scan {{label}}.', { label: picked?.label ?? next }));
        };

        const scanMarkets = async () => {
            if (is_scanning) return;
            // Pressing Scan with no market list used to return silently, which is
            // the one case where the button genuinely cannot work and so the one
            // case that most needs to say so.
            if (symbols.length === 0) {
                setIsError(true);
                setStatus(localize('No markets available to scan yet. Reopen the scanner once connected.'));
                return;
            }
            setIsScanning(true);
            setIsError(false);
            setBest(null);

            const results: TResult[] = [];
            for (let i = 0; i < symbols.length; i += 1) {
                // Abandoned scanner: stop requesting, stop reporting.
                if (!is_live.current) return;
                const item = symbols[i];
                setProgress({ done: i + 1, total: symbols.length, market: item.underlying_symbol_name });
                setStatus(
                    localize('Scanning {{market}} ({{done}}/{{total}})…', {
                        market: item.underlying_symbol_name,
                        done: i + 1,
                        total: symbols.length,
                    })
                );
                try {
                    // eslint-disable-next-line no-await-in-loop
                    const { prices, pip_size } = await feed.getTickHistory(item.underlying_symbol, scan_depth);
                    if (!prices.length) continue;
                    const places = toDecimalPlaces(pip_size) ?? 2;
                    const digits = prices.map(price => getLastDigit(price, places)).reverse();
                    results.push({
                        symbol: item.underlying_symbol,
                        name: item.underlying_symbol_name,
                        ...analyse(digits, active_mode.over, active_mode.under),
                    });
                } catch {
                    // A market that will not return history is skipped, not faked.
                }
            }

            // The last market's request can still land after the panel closes.
            if (!is_live.current) return;

            results.sort((a, b) => b.score - a.score);
            const winner = results[0] ?? null;
            setBest(winner);
            setIsScanning(false);
            // Nothing ranked means every market refused history - a failed scan,
            // not a scan with a quiet result.
            setIsError(!winner);
            setStatus(
                winner
                    ? localize('Scanned {{count}} markets over {{depth}} ticks each.', {
                          count: results.length,
                          depth: scan_depth,
                      })
                    : localize('No market returned enough history to rank. Try again in a moment.')
            );
        };

        /**
         * Hands the scan result to Quick Strategy - the app's own strategy
         * builder. It loads the bundled Martingale XML and injects these
         * values, so the bot that trades is the one this app already ships and
         * tests, not a strategy written here from a screenshot.
         *
         * `action: 'EDIT'` rather than 'RUN' is the whole point: quick-strategy
         * -store.ts:201 treats 'RUN' as "load the strategy AND press Run",
         * calling run_panel.onRunButtonClick() as soon as the trade_definition
         * block appears. Loading a scanner result therefore started trading
         * real money on its own, with no further confirmation - a scan result
         * is a suggestion, and committing funds has to stay a separate,
         * deliberate act by the user.
         *
         * 'EDIT' is the app's own existing value for "load it into the
         * workspace and stop there" (useQsSubmitHandler.tsx:36), so this
         * reuses the established path rather than inventing a mode. The bot
         * still loads, still lands in the Bot Builder, and the existing Run
         * control is what starts it.
         */
        const launchBot = () => {
            if (!best || !quick_strategy) return;
            startTransition(() => {
                navigate('/');
                dashboard?.setActiveTab(DBOT_TABS.BOT_BUILDER);
            });
            quick_strategy.setSelectedStrategy('MARTINGALE');
            quick_strategy.onSubmit({
                symbol: best.symbol,
                tradetype: 'overunder',
                type: 'DIGITOVER',
                prediction: active_mode.over,
                stake: params.stake,
                // Martingale off means every stake is the first stake.
                size: params.use_martingale ? params.martingale : 1,
                loss: params.stop_loss,
                profit: 0,
                duration: 1,
                unit: 't',
                action: 'EDIT',
            });
            setShowParams(false);
            onClose();
        };

        const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

        return (
            <div className='mw-scanner' role='dialog' aria-modal='true' aria-label={localize('Entry Scanner')}>
                <div className='mw-scanner__backdrop' onClick={onClose} />
                <div className='mw-scanner__sheet' ref={sheet_ref} tabIndex={-1}>
                    <div className='mw-scanner__head'>
                        <h2>{localize('Entry Scanner')}</h2>
                        <button type='button' onClick={onClose} aria-label={localize('Close')}>
                            ✕
                        </button>
                    </div>

                    <div className='mw-scanner__body'>
                        <div className='mw-scanner__hero'>
                            <span className='mw-scanner__hero-pill'>✦ {localize(active_mode.badge)}</span>
                            <h3>{localize(active_mode.title)}</h3>
                            <p>{localize(active_mode.blurb)}</p>
                            <span className={`mw-scanner__radar ${is_scanning ? 'mw-scanner__radar--on' : ''}`}>
                                <span className='mw-scanner__radar-ring' />
                                <span className='mw-scanner__radar-ring mw-scanner__radar-ring--mid' />
                                <span className='mw-scanner__radar-core'>AI</span>
                                <span className='mw-scanner__radar-blip' />
                                <span className='mw-scanner__radar-blip mw-scanner__radar-blip--two' />
                            </span>
                        </div>

                        <div className='mw-scanner__modes'>
                            {MODES.map(item => (
                                <button
                                    key={item.id}
                                    type='button'
                                    className={`mw-scanner__mode ${mode === item.id ? 'mw-scanner__mode--active' : ''}`}
                                    onClick={() => selectMode(item.id)}
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
                                <span>{localize('TICKS')}</span>
                                <strong>{scan_depth}</strong>
                            </div>
                        </div>

                        <div className='mw-scanner__fields mw-scanner__fields--two'>
                            <div className='mw-scanner__field mw-scanner__field--static'>
                                <span>{localize('SELECTED MARKET')}</span>
                                <strong>
                                    {best ? `${best.name} (${best.symbol})` : localize('Scan to find the best market')}
                                </strong>
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

                        {best && (
                            <>
                                <div className='mw-scanner__metrics'>
                                    <div>
                                        <span>{localize('AI SCORE')}</span>
                                        <strong>{best.score.toFixed(2)}%</strong>
                                    </div>
                                    <div>
                                        <span>{localize('WIN RATE')}</span>
                                        <strong>{best.win_rate.toFixed(1)}%</strong>
                                    </div>
                                    <div>
                                        <span>{localize('RECENT')}</span>
                                        <strong>{best.recent_rate.toFixed(1)}%</strong>
                                    </div>
                                    <div>
                                        <span>{localize('SAMPLES')}</span>
                                        <strong>{best.samples}</strong>
                                    </div>
                                </div>
                                <div className='mw-scanner__heat'>
                                    {localize(
                                        'Heatmap: hottest digit {{hot}} | coldest digit {{cold}} | missing {{missing}} | low streak {{low}} | high streak {{high}}',
                                        {
                                            hot: best.hottest,
                                            cold: best.coldest,
                                            missing: best.missing.length ? best.missing.join(', ') : localize('none'),
                                            low: best.low_streak,
                                            high: best.high_streak,
                                        }
                                    )}
                                </div>
                                <div className='mw-scanner__best'>
                                    {localize('Best market: {{name}} | {{character}} | AI {{score}}%', {
                                        name: best.name,
                                        character: best.character,
                                        score: best.score.toFixed(2),
                                    })}
                                </div>
                            </>
                        )}

                        {is_scanning && (
                            <div className='mw-scanner__progress'>
                                <div className='mw-scanner__progress-head'>
                                    <span>{progress.market}</span>
                                    <span>
                                        {progress.done}/{progress.total}
                                    </span>
                                </div>
                                <div className='mw-scanner__progress-track'>
                                    <div className='mw-scanner__progress-fill' style={{ width: `${percent}%` }} />
                                </div>
                            </div>
                        )}

                        <div
                            className={`mw-scanner__status ${is_error ? 'mw-scanner__status--error' : ''}`}
                            role={is_error ? 'alert' : 'status'}
                        >
                            {status || localize('Not scanned yet')}
                        </div>

                        <div className='mw-scanner__actions'>
                            <button
                                type='button'
                                className='mw-scanner__scan'
                                onClick={scanMarkets}
                                disabled={is_scanning || symbols.length === 0}
                            >
                                {is_scanning ? localize('Scanning Markets…') : localize('Scan Markets')}
                            </button>
                            <button
                                type='button'
                                className={`mw-scanner__load ${best ? 'mw-scanner__load--ready' : ''}`}
                                onClick={() => setShowParams(true)}
                                disabled={!best}
                            >
                                {localize('Load Scanner Bot')}
                            </button>
                        </div>

                        <p className='mw-scanner__note'>
                            {localize(
                                'Every figure above is counted from real tick history on the market it names. AI score blends the full sample with the last {{recent}} ticks and is reduced when the two disagree. Past behaviour is not a prediction.',
                                { recent: RECENT_WINDOW }
                            )}
                        </p>
                    </div>
                </div>

                {show_params && (
                    <div className='mw-scanner__params' role='dialog' aria-label={localize('Scanner Parameters')}>
                        <div className='mw-scanner__params-sheet'>
                            <div className='mw-scanner__params-head'>{localize('Scanner Parameters')}</div>
                            <div className='mw-scanner__params-grid'>
                                <label>
                                    <span>{localize('STAKE')}</span>
                                    <input
                                        type='number'
                                        value={params.stake}
                                        min={0.35}
                                        step={0.1}
                                        onChange={e => setParams(p => ({ ...p, stake: Number(e.target.value) || 0 }))}
                                    />
                                </label>
                                <label>
                                    <span>{localize('MARTINGALE')}</span>
                                    <input
                                        type='number'
                                        value={params.martingale}
                                        min={1}
                                        step={0.1}
                                        onChange={e =>
                                            setParams(p => ({ ...p, martingale: Number(e.target.value) || 1 }))
                                        }
                                    />
                                </label>
                                <label>
                                    <span>{localize('NUMBER OF WINS')}</span>
                                    <input
                                        type='number'
                                        value={params.wins}
                                        min={1}
                                        onChange={e => setParams(p => ({ ...p, wins: Number(e.target.value) || 1 }))}
                                    />
                                </label>
                                <label>
                                    <span>{localize('NO. OF DIGITS TO CHECK')}</span>
                                    <input
                                        type='number'
                                        value={params.digits_to_check}
                                        min={1}
                                        onChange={e =>
                                            setParams(p => ({ ...p, digits_to_check: Number(e.target.value) || 1 }))
                                        }
                                    />
                                </label>
                                <label className='mw-scanner__params-wide'>
                                    <span>{localize('STOP LOSS')}</span>
                                    <input
                                        type='number'
                                        value={params.stop_loss}
                                        min={0}
                                        onChange={e =>
                                            setParams(p => ({ ...p, stop_loss: Number(e.target.value) || 0 }))
                                        }
                                    />
                                </label>
                            </div>

                            <button
                                type='button'
                                className='mw-scanner__params-toggle'
                                onClick={() => setParams(p => ({ ...p, use_martingale: !p.use_martingale }))}
                                role='switch'
                                aria-checked={params.use_martingale}
                            >
                                <span>{localize('Use Martingale')}</span>
                                <span
                                    className={`mw-scanner__params-switch ${params.use_martingale ? 'mw-scanner__params-switch--on' : ''}`}
                                />
                            </button>

                            <p className='mw-scanner__note'>
                                {localize(
                                    'Launch loads the bundled Martingale strategy with these values into the Bot Builder - the same builder the Bot Builder uses. It does not start trading: press Run when you are ready. Number of wins and digits to check have no field in that strategy, so they are not applied; send me the scanner bot XML and I will wire them.'
                                )}
                            </p>

                            <div className='mw-scanner__params-actions'>
                                <button type='button' onClick={() => setShowParams(false)}>
                                    {localize('Cancel')}
                                </button>
                                <button
                                    type='button'
                                    className='mw-scanner__params-launch'
                                    onClick={launchBot}
                                    disabled={run_panel?.is_running}
                                >
                                    {localize('Launch Bot')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }
);

export default EntryScanner;
