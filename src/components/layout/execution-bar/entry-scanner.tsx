import { startTransition, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import { DBOT_TABS } from '@/constants/bot-contents';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { useStore } from '@/hooks/useStore';
import { getLastDigit, toDecimalPlaces } from '@/utils/market-data/last-digit';
import type { TActiveSymbol } from '@/utils/market-data/public-market-feed';
import { armScannerSession, resetScannerSession } from '@/utils/market-data/scanner-entry-session';
import { allowsSide, evaluateOverUnder, type TStrategyMatch } from '@/utils/market-data/over-under-strategy';
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

const MIN_DEPTH = 100;
const MAX_DEPTH = 5000;
const RECENT_WINDOW = 200;
// Share one socket without sending all 18 histories at once (rate-limit risk).
const SCAN_CONCURRENCY = 2;

// The video starts at Jump 10 (1/18), then moves through Volatility
// indices, ending at Volatility 90 (1s) (18/18). Preserve the exact
// 18-market scope supplied by the user, and include only currently
// available symbols returned by Deriv's active_symbols API.
const SCAN_MARKETS = [
    'JD10', 'JD25', 'JD50', 'JD75', 'JD100',
    '1HZ10V', 'R_10',
    '1HZ100V', 'R_100',
    '1HZ15V',
    '1HZ25V', 'R_25',
    '1HZ30V',
    '1HZ50V', 'R_50',
    '1HZ75V', 'R_75',
    '1HZ90V',
] as const;

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
    strategy?: TStrategyMatch;
    historyDigits: number[];
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
        // A synchronous guard blocks double-clicks before React can rerender.
        const scanInProgress = useRef(false);

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
        // Workers check this before each new request, and abandon UI updates
        // if the scanner has closed.
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
        const [liveSignal, setLiveSignal] = useState('');
        const [liveStatus, setLiveStatus] = useState('');
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
            max_stake: 10,
            use_martingale: true,
        });

        const active_mode = MODES.find(item => item.id === mode) ?? MODES[0];

        useEffect(() => {
            if (!isConnected) return;
            feed.getActiveSymbols()
                .then(list => {
                    const seen = new Set<string>();
                    const synthetics = list.filter(item => {
                        if (item.market !== 'synthetic_index' || !item.underlying_symbol) return false;
                        if (item.exchange_is_open === 0 || item.is_trading_suspended === 1) return false;
                        if (seen.has(item.underlying_symbol)) return false;
                        seen.add(item.underlying_symbol);
                        return true;
                    });
                    const bySymbol = new Map(synthetics.map(item => [item.underlying_symbol, item]));
                    const selected = SCAN_MARKETS
                        .map(symbol => bySymbol.get(symbol))
                        .filter((item): item is TActiveSymbol => Boolean(item));
                    const missing = SCAN_MARKETS.filter(symbol => !bySymbol.has(symbol));
                    if (!is_live.current) return;
                    setSymbols(current => {
                        // Keep the same array identity if the market list has not
                        // actually changed. No unnecessary observer rerenders.
                        if (current.length === selected.length &&
                            current.every((item, index) => item.underlying_symbol === selected[index].underlying_symbol)
                        ) return current;
                        return selected;
                    });
                    setIsError(selected.length === 0);
                    setStatus(
                        selected.length
                            ? localize('Ready to scan {{found}} of {{requested}} requested markets.{{missing}}', {
                                  found: selected.length,
                                  requested: SCAN_MARKETS.length,
                                  missing: missing.length ? ` Unavailable: ${missing.join(', ')}.` : '',
                              })
                            : localize('None of the 18 requested Volatility or Jump markets are currently available.')
                    );
                })
                .catch(error => {
                    if (!is_live.current) return;
                    console.warn('[MW-Scanner] Active symbols request failed:', error);
                    setIsError(true);
                    setStatus(
                        localize('Could not load markets: {{reason}}', {
                            reason: error instanceof Error ? error.message : 'Unknown market-data error',
                        })
                    );
                });
        // localize is intentionally excluded: its identity can change on a
        // render, while getActiveSymbols() reads a cached response and creates
        // a fresh array. Depending on it can cause a self-sustaining render loop.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [isConnected, feed]);

        const selectMode = (next: TMode) => {
            setMode(next);
            setBest(null);
            setProgress({ done: 0, total: 0, market: '' });
            setIsError(false);
            setLiveSignal('');
            setLiveStatus('');
            const picked = MODES.find(item => item.id === next);
            setStatus(localize('Ready to scan {{label}}.', { label: picked?.label ?? next }));
        };

        const scanMarkets = async () => {
            if (scanInProgress.current) return;
            // Pressing Scan with no market list used to return silently, which is
            // the one case where the button genuinely cannot work and so the one
            // case that most needs to say so.
            if (symbols.length === 0) {
                setIsError(true);
                setStatus(localize('No markets available to scan yet. Reopen the scanner once connected.'));
                return;
            }
            scanInProgress.current = true;
            setIsScanning(true);
            setIsError(false);
            setBest(null);
            setLiveSignal('');
            setLiveStatus('');

            const results: TResult[] = [];
            let usableHistories = 0;
            let shortHistories = 0;
            let historyErrors = 0;
            let nextIndex = 0;
            let completed = 0;
            const total = symbols.length;
            const selectedMode = active_mode;
            const selectedDepth = scan_depth;

            setProgress({ done: 0, total, market: localize('Starting with {{market}}', {
                market: symbols[0].underlying_symbol_name,
            }) });
            setStatus(localize('Scan started: 0/{{total}} markets for {{mode}}.', {
                total,
                mode: selectedMode.label,
            }));
            console.info('[MW-Scanner] Scan started', { mode: selectedMode.id, markets: total, depth: selectedDepth });

            try {
                // Allow the browser to paint the Scanning state BEFORE network
                // requests begin. Without this, a blocking task makes the
                // button look like it was never clicked.
                await new Promise<void>(resolve => window.setTimeout(resolve, 16));

                const scanWorker = async () => {
                    while (is_live.current) {
                        const index = nextIndex++;
                        if (index >= total) return;
                        const item = symbols[index];
                        try {
                            const { prices, pip_size } = await feed.getTickHistory(item.underlying_symbol, selectedDepth);
                            if (!is_live.current) return;
                            if (prices.length < MIN_DEPTH) {
                                shortHistories += 1;
                            } else {
                                usableHistories += 1;
                                const places = toDecimalPlaces(pip_size) ?? 2;
                                const digits = prices.map(price => getLastDigit(price, places)).reverse();
                                const qualified = evaluateOverUnder(digits).filter(
                                    match => match.eligible &&
                                        ((match.side === 'OVER' && match.prediction === selectedMode.over) ||
                                         (match.side === 'UNDER' && match.prediction === selectedMode.under))
                                );
                                for (const match of qualified) {
                                    const metrics = analyse(digits, selectedMode.over, selectedMode.under);
                                    const sideRate = match.side === 'OVER' ? metrics.win_rate : metrics.under_rate;
                                    const recentDigits = digits.slice(0, RECENT_WINDOW);
                                    const recentRate = recentDigits.length
                                        ? 100 * recentDigits.filter(d =>
                                            match.side === 'OVER' ? d > match.prediction : d < match.prediction
                                        ).length / recentDigits.length
                                        : 0;
                                    results.push({
                                        symbol: item.underlying_symbol,
                                        name: item.underlying_symbol_name,
                                        ...metrics,
                                        win_rate: sideRate,
                                        recent_rate: recentRate,
                                        score: scoreOf(sideRate, recentRate),
                                        strategy: match,
                                        historyDigits: digits,
                                    });
                                }
                            }
                        } catch (error) {
                            if (!is_live.current) return;
                            historyErrors += 1;
                            console.warn('[MW-Scanner] Tick history failed:', item.underlying_symbol, error);
                        } finally {
                            if (is_live.current) {
                                completed += 1;
                                setProgress({ done: completed, total, market: item.underlying_symbol_name });
                                setStatus(
                                    localize('Scanning {{mode}}: {{done}}/{{total}} markets checked. Latest: {{market}}.', {
                                        mode: selectedMode.label,
                                        done: completed,
                                        total,
                                        market: item.underlying_symbol_name,
                                    })
                                );
                                // Yield between requests so the modal remains
                                // responsive even on low-powered computers.
                                await new Promise<void>(resolve => window.setTimeout(resolve, 0));
                            }
                        }
                    }
                };

                await Promise.all(
                    Array.from({ length: Math.min(SCAN_CONCURRENCY, total) }, () => scanWorker())
                );
                if (!is_live.current) return;

                results.sort((a, b) => b.score - a.score);
                const winner = results[0] ?? null;
                setBest(winner);
                setIsError(usableHistories === 0);
                if (winner) {
                    setStatus(localize(
                        'Completed {{total}} markets for {{mode}}. {{matched}} qualified; selected {{market}} (historical only).',
                        { total, mode: selectedMode.label, matched: results.length, market: winner.name }
                    ));
                } else if (usableHistories > 0) {
                    setStatus(localize(
                        'Completed {{total}} markets for {{mode}}. No market met every required digit condition. Try another mode or scan again later.',
                        { total, mode: selectedMode.label }
                    ));
                } else {
                    setStatus(localize(
                        'No usable tick history for {{mode}}: {{failed}} requests failed, {{short}} returned fewer than {{minimum}} ticks.',
                        { mode: selectedMode.label, failed: historyErrors, short: shortHistories, minimum: MIN_DEPTH }
                    ));
                }
            } catch (error) {
                console.error('[MW-Scanner] Unexpected scanner error:', error);
                if (is_live.current) {
                    setIsError(true);
                    setStatus(localize('Scanner error: {{reason}}', {
                        reason: error instanceof Error ? error.message : String(error),
                    }));
                }
            } finally {
                scanInProgress.current = false;
                if (is_live.current) setIsScanning(false);
            }
        };

        // Historical scans select candidates, never place trades.
        // A fresh live Over signal needs the least digit among 1,2,3 followed
        // by 4–9 on the very next tick. The user provided no Under entry rule.
        useEffect(() => {
            if (!best?.strategy) return undefined;
            let history = [...best.historyDigits];
            let pendingTrigger = false;
            let previousTickId: string | null = null;
            const { side, prediction } = best.strategy;
            setLiveSignal('');
            setLiveStatus(
                side === 'OVER'
                    ? localize('Frequency filters passed. Watching live ticks for an Over entry.')
                    : localize('Under filters passed. No Under live entry timing rule was supplied.')
            );
            return feed.subscribeTicks(best.symbol, tick => {
                if (!is_live.current) return;
                // Several ticks may share an epoch second on faster markets;
                // using epoch as a deduplication key would miss real ticks.
                if (tick.id && previousTickId === tick.id) return;
                previousTickId = tick.id || null;
                const digit = getLastDigit(tick.quote, toDecimalPlaces(tick.pip_size) ?? 2);
                history = [digit, ...history].slice(0, scan_depth);
                const current = evaluateOverUnder(history).find(
                    match => match.side === side && match.prediction === prediction
                );
                if (!current?.eligible) {
                    pendingTrigger = false;
                    setLiveSignal('');
                    setLiveStatus(localize('Live frequency/trend filters no longer qualify. Rescan this market.'));
                    return;
                }
                if (side !== 'OVER') {
                    setLiveStatus(localize('Under filters still qualify. Entry timing is not defined.'));
                    return;
                }
                if (pendingTrigger && digit >= 4 && digit <= 9) {
                    setLiveSignal(localize('LIVE OVER {{prediction}} confirmation observed. Manual decision only.', { prediction }));
                    setLiveStatus(localize('Least trigger followed by 4–9 on this tick.'));
                    pendingTrigger = false;
                    return;
                }
                setLiveSignal('');
                pendingTrigger = current.leastTriggerDigits.includes(digit);
                setLiveStatus(
                    pendingTrigger
                        ? localize('Least-frequency trigger {{digit}} observed; checking next tick.', { digit })
                        : localize('Over filters qualify. Waiting for the least of digits 1, 2, 3.')
                );
            });
        // Keeping this subscription stable is important: an unstable localize
        // function would unsubscribe/re-subscribe after every tick-state update.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [best, feed, scan_depth]);

        /**
         * Launch the scanner-specific strategy. The launch is the explicit
         * user action to run the bot, but the engine will not buy until
         * the *live* Over entry sequence is confirmed on the chosen market.
         * Under setups stay informational because no Under entry timing rule
         * has been provided. The shared engine enforces max stake/stop loss.
         */
        const launchBot = async () => {
            if (!best?.strategy || !quick_strategy || run_panel?.is_running) return;
            if (best.strategy.side === 'UNDER') {
                setIsError(true);
                setStatus(localize(
                    'Under {{prediction}} qualified historically, but the Under entry-point trigger was not supplied. Automatic Under trades are blocked.',
                    { prediction: best.strategy.prediction }
                ));
                return;
            }
            if (!Number.isFinite(params.stake) || params.stake <= 0 ||
                !Number.isFinite(params.max_stake) || params.max_stake < params.stake ||
                !Number.isFinite(params.stop_loss) || params.stop_loss < params.stake ||
                !Number.isInteger(params.wins) || params.wins < 1) {
                setIsError(true);
                setStatus(localize('Enter valid stake, maximum stake, stop loss, and win limit before launching.'));
                return;
            }
            try {
                const availableContracts = await feed.getContractsFor(best.symbol);
                if (!allowsSide(availableContracts, best.strategy.side)) {
                    setIsError(true);
                    setStatus(localize('Digit {{side}} contracts are not offered on {{market}}.', {
                        side: best.strategy.side,
                        market: best.name,
                    }));
                    return;
                }

                // Arm before RUN: quick-strategy may start the engine as soon as
                // Blockly creates the trade definition block.
                armScannerSession({
                    market: best.name,
                    symbol: best.symbol,
                    side: best.strategy.side,
                    prediction: best.strategy.prediction,
                    digits: best.historyDigits,
                    stake: params.stake,
                    maxStake: params.max_stake,
                    stopLoss: params.stop_loss,
                    maxWins: params.wins,
                });

                startTransition(() => {
                    navigate('/');
                    dashboard?.setActiveTab(DBOT_TABS.BOT_BUILDER);
                });
                await quick_strategy.onSubmit({
                    scanner_strategy: true,
                    symbol: best.symbol,
                    tradetype: 'overunder',
                    type: best.strategy.side === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER',
                    last_digit_prediction: best.strategy.prediction,
                    stake: params.stake,
                    size: params.use_martingale ? params.martingale : 1,
                    max_stake: params.max_stake,
                    boolean_max_stake: true,
                    loss: params.stop_loss,
                    // Live session enforces the win limit; the XML requires
                    // a profit parameter but does not encode Number of Wins.
                    profit: 1000000,
                    duration: 1,
                    durationtype: 't',
                    unit: 't',
                    action: 'RUN',
                });
                setShowParams(false);
                onClose();
            } catch (error) {
                resetScannerSession();
                setIsError(true);
                setStatus(localize('Could not launch scanner-only bot: {{reason}}', {
                    reason: error instanceof Error ? error.message : String(error),
                }));
                console.error('[MW-Scanner] Scanner bot launch failed:', error);
            }
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
                            {/* Three rings held at fixed radii around the
                                lettered core, and three blips on them. The
                                rings used to be one ripple expanding out of the
                                centre and fading to nothing; on the reference
                                they are simply there, all of them, all the
                                time, and the only thing that moves is the sweep
                                behind them and the blips twinkling. */}
                            <span className={`mw-scanner__radar ${is_scanning ? 'mw-scanner__radar--on' : ''}`}>
                                <span className='mw-scanner__radar-ring' />
                                <span className='mw-scanner__radar-ring mw-scanner__radar-ring--mid' />
                                <span className='mw-scanner__radar-ring mw-scanner__radar-ring--inner' />
                                <span className='mw-scanner__radar-core'>AI</span>
                                <span className='mw-scanner__radar-blip' />
                                <span className='mw-scanner__radar-blip mw-scanner__radar-blip--two' />
                                <span className='mw-scanner__radar-blip mw-scanner__radar-blip--three' />
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
                                    {/* The full name. These read "O1 / U8" for
                                        a while, from the id, under a comment
                                        saying that was the form the reference
                                        used; the reference screenshot since
                                        supplied spells all three out, so the
                                        tab and the prose that says "Ready to
                                        scan ..." now read from the one `label`
                                        rather than from two different forms.
                                        Wrapped so it can sit above the fill:
                                        the selected tab's gradient is an
                                        absolutely positioned layer, and an
                                        absolutely positioned pseudo-element
                                        paints over a bare text node. */}
                                    <span>{localize(item.label)}</span>
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
                                    {best?.strategy
                                        ? `${best.strategy.side} ${best.strategy.prediction} (historical filters)`
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
                                        <span>{localize('HISTORICAL DIGIT RATE')}</span>
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
                                {best.strategy && (
                                    <>
                                        <div className='mw-scanner__digit-distribution' aria-label={localize('Last-digit percentages')}>
                                            {best.strategy.percentages.map((share, digit) => (
                                                <div className='mw-scanner__digit' key={digit}>
                                                    <span className='mw-scanner__digit-name'>{digit}</span>
                                                    <span className='mw-scanner__digit-track'>
                                                        <span
                                                            className={`mw-scanner__digit-fill mw-scanner__digit-fill--${best.strategy?.barColors[digit] ?? 'neutral'}`}
                                                            style={{ width: `${Math.min(100, share * 5)}%` }}
                                                        />
                                                    </span>
                                                    <strong>{share.toFixed(1)}%</strong>
                                                </div>
                                            ))}
                                        </div>
                                        <div className='mw-scanner__rule-detail'>
                                            {localize('Conditions: digits {{low}} below 10% and decreasing; at least two digits {{strong}} at 11% or higher. Red/yellow mark low digits; blue/green mark strong digits.', {
                                                low: best.strategy.lowDigits.join(', '),
                                                strong: best.strategy.strongDigits.join(', '),
                                            })}
                                        </div>
                                    </>
                                )}
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
                                {best.strategy && (
                                    <div className='mw-scanner__best'>
                                        {localize('Historical filters: {{side}} {{prediction}}. {{reason}}', {
                                            side: best.strategy.side,
                                            prediction: best.strategy.prediction,
                                            reason: best.strategy.reason,
                                        })}
                                    </div>
                                )}
                                <div className='mw-scanner__best'>
                                    {liveSignal || liveStatus || localize('Monitoring live market conditions…')}
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
                                {is_scanning
                                    ? localize('Scanning {{done}}/{{total}}…', { done: progress.done, total: progress.total })
                                    : localize('Scan Markets')}
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
                                <label>
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

                                <label>
                                    <span>{localize('MAXIMUM STAKE')}</span>
                                    <input
                                        type='number'
                                        value={params.max_stake}
                                        min={params.stake}
                                        step={0.1}
                                        onChange={e => setParams(p => ({ ...p, max_stake: Number(e.target.value) || 0 }))}
                                    />
                                </label>

                                {/* In the grid rather than under it: the
                                    screenshot puts the switch in the cell beside
                                    Stop loss, which is what keeps the dialog
                                    three rows deep rather than four. */}
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
                            </div>

                            <p className='mw-scanner__note'>
                                {localize(
                                    'Launch opens the AI Scanner-only bot and starts its monitoring engine. Purchases require a fresh qualifying live Over entry signal; they do not occur immediately merely because a historical scan qualified. Number of wins and digits to check have no field in that strategy, so they are not applied; send me the scanner bot XML and I will wire them.'
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
