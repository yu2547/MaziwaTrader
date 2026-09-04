import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { scan_sound } from '@/components/layout/execution-bar/scan-sound';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import useUtcClock from '@/hooks/useUtcClock';
import { getDigitDistribution, getLastDigit, toDecimalPlaces } from '@/utils/market-data/last-digit';
import { TActiveSymbol, TTick } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';
import { evaluateWindow, MIN_ENTROPY, MIN_SAMPLE, MIN_SEPARATION_Z, TSide, TStrategy } from './signal-quality';

/**
 * Volatility indices only - R_10..R_100 and their 1s variants. The synthetic
 * list also carries Boom, Crash, Jump, Step and Range Break, and those are not
 * what this scanner is for: several of them quote to a precision that makes the
 * last digit barely move, which the entropy guard then has to throw out one by
 * one.
 */
const VOLATILITY_SYMBOL = /^(R_\d+|1HZ\d+V)$/;

/** Nothing is selected until the trader picks a market, so nothing is analysed. */
const NO_SYMBOL = '';
const SAMPLE_SIZE = 1000;
const HISTORY_LIMIT = 20;

/** The alert asset the app already ships, in assets/media. */
const ALERT_SOUND = 'assets/media/announcement.mp3';
const SOUND_KEY = 'mw_signals_sound';
const COUNTDOWN_FROM = 5;

/** Gap between sweeps while the dashboard waits for a market to qualify. */
const RESCAN_SECONDS = 5;

/** Sweep summaries kept on screen; older ones fall off so the log stays readable. */
const LOG_LIMIT = 24;

type TStatus = 'error' | 'waiting' | 'scanning' | 'no_signal' | 'good_market';

type TLine = { text: string; tone: 'ok' | 'warn' | 'head' | 'dim' };

/** One market's reading during an all-market scan. */
type TScanEntry = {
    digits: number[];
    evaluation: ReturnType<typeof evaluateWindow>;
    name: string;
    symbol: string;
};

/** What the scan settled on, once a market cleared every condition. */
type TScanResult = {
    digits: number[];
    name: string;
    pct: number;
    sample: number;
    side: string;
    symbol: string;
    z: number;
};

type TRecord = {
    edge: number;
    id: string;
    market: string;
    signal: string;
    time: string;
};

const STRATEGIES: { id: TStrategy; label: string }[] = [
    { id: 'matches_differs', label: 'Matches & Differs' },
    { id: 'even_odd', label: 'Even & Odd' },
    { id: 'over_under', label: 'Over & Under' },
];

const STATUS_LABEL: Record<TStatus, string> = {
    error: 'SCANNER ERROR',
    good_market: 'GOOD MARKET',
    no_signal: 'NO SIGNAL',
    scanning: 'SCANNING',
    waiting: 'WAITING',
};

/** Same UTC formatting the footer clock uses, so a signal time reads like the app's own clock. */
const gmt = (date: Date) => date.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' });

/**
 * Background chatter. Scenery - aria-hidden, behind a scrim, and nothing in it
 * is a reading of anything. Every claim on this page is in the panel, from the
 * live window.
 */
const RAIN_LINES = [
    '[INFO] Connecting to server... [OK]',
    '[SUCCESS] Data stream established...',
    '[INFO] Authenticating API key... [OK]',
    '[SECURITY] Encryption enabled...',
    '[INFO] Fetching market data... [OK]',
    '[INFO] Analysing Volatility Index...',
    '[INFO] Compiling results...',
    '[INFO] Predicting next digit...',
    '[INFO] Data transmission complete...',
    '[WARNING] High market volatility detected...',
    '[WARNING] Unstable connection detected...',
    '[ERROR] Connection timeout. Retrying...',
];

const RainColumn = ({ duration, seed }: { duration: number; seed: number }) => {
    const lines = useMemo(() => {
        const offset = seed % RAIN_LINES.length;
        const rotated = [...RAIN_LINES.slice(offset), ...RAIN_LINES.slice(0, offset)];
        const filled = Array.from({ length: 24 }, (_, index) => rotated[(index * 5 + seed) % rotated.length]);
        // Two copies, so the second lands where the first began and -50% loops seamlessly.
        return [...filled, ...filled];
    }, [seed]);

    return (
        <div className='mw-signals__rain-col' style={{ animationDuration: `${duration}s` }}>
            {lines.map((line, index) => (
                <span key={`${seed}-${index}`}>{line}</span>
            ))}
        </div>
    );
};

const Signals = observer(() => {
    const { feed, isConnected } = usePublicMarketFeed();
    const { localize } = useTranslations();
    const now = useUtcClock();

    const [symbols, setSymbols] = useState<TActiveSymbol[]>([]);
    const [symbol, setSymbol] = useState(NO_SYMBOL);
    const [strategy, setStrategy] = useState<TStrategy>('matches_differs');
    // The window and the market it was read from, in one piece of state. Held
    // apart they can disagree for a render: changing market updates `symbol`
    // immediately, but the digits are only cleared when the effect runs, so
    // there is a frame where the new market's name sits on the old market's
    // window - long enough to record a signal against the wrong market, which
    // is how Boom 50 and Boom 600 came to log the same reading in the same
    // second. Bound together they cannot drift.
    const [sample, setSample] = useState<{ digits: number[]; symbol: string }>({ digits: [], symbol: '' });
    // Memoised so the mismatch branch does not hand back a fresh [] on every
    // render and re-run every calculation below it on every tick.
    const digits = useMemo(() => (sample.symbol === symbol ? sample.digits : []), [sample, symbol]);
    const [last_tick, setLastTick] = useState<TTick | null>(null);
    // Held apart from last_tick because history arrives first: the sample is
    // already 1000 deep before a single live tick has landed, and reading the
    // quote off last_tick alone left the panel showing "--" next to a full
    // window and a current digit.
    const [quote, setQuote] = useState<number | null>(null);
    const [decimals, setDecimals] = useState(2);
    const [history_error, setHistoryError] = useState(false);
    const [retry_token, setRetryToken] = useState(0);

    const [history, setHistory] = useState<TRecord[]>([]);
    const [detected_at, setDetectedAt] = useState<string | null>(null);

    const [sound_on, setSoundOn] = useState(() => {
        try {
            return localStorage.getItem(SOUND_KEY) !== 'off';
        } catch {
            // Private mode or blocked storage: alerts default to on.
            return true;
        }
    });
    const [sound_blocked, setSoundBlocked] = useState(false);

    useEffect(() => {
        if (!isConnected) return;
        feed.getActiveSymbols()
            .then(list => {
                setSymbols(list.filter(item => VOLATILITY_SYMBOL.test(item.underlying_symbol)));
            })
            .catch(() => {
                // Non-fatal: the selector stays on the default market.
            });
    }, [isConnected, feed]);

    // Seed from history, then stay current from the live stream - the same
    // shape the digit circles use, on the same feed. No second socket.
    const request_id = useRef(0);
    useEffect(() => {
        if (!isConnected || !symbol) return undefined;
        const id = ++request_id.current;
        setSample({ digits: [], symbol });
        setLastTick(null);
        setQuote(null);
        setHistoryError(false);

        feed.getTickHistory(symbol, SAMPLE_SIZE)
            .then(({ pip_size, prices }) => {
                if (id !== request_id.current) return;
                const places = toDecimalPlaces(pip_size) ?? 2;
                setDecimals(places);
                // History is oldest-first, so the newest price is the last one.
                setQuote(prices[prices.length - 1] ?? null);
                setSample({ digits: prices.map(price => getLastDigit(price, places)).reverse(), symbol });
            })
            .catch(() => {
                if (id !== request_id.current) return;
                setHistoryError(true);
            });

        const unsubscribe = feed.subscribeTicks(symbol, tick => {
            if (id !== request_id.current) return;
            const places = toDecimalPlaces(tick.pip_size) ?? 2;
            setDecimals(places);
            setLastTick(tick);
            setQuote(tick.quote);
            setHistoryError(false);
            setSample(prev => ({
                digits: [getLastDigit(tick.quote, places), ...(prev.symbol === symbol ? prev.digits : [])].slice(
                    0,
                    SAMPLE_SIZE
                ),
                symbol,
            }));
        });

        return () => unsubscribe();
    }, [isConnected, feed, symbol, retry_token]);

    const symbol_name = symbols.find(item => item.underlying_symbol === symbol)?.underlying_symbol_name ?? symbol;
    const strategy_label = localize(STRATEGIES.find(item => item.id === strategy)?.label ?? '');
    const current_digit = digits[0] ?? null;

    // One pass over the window per change of window, not per render.
    // One implementation of the sides, used by the live panel and by the
    // all-market scan, so the two can never disagree about what a market says.
    const makeSides = useCallback(
        (window_digits: number[], for_strategy: TStrategy): TSide[] => {
            if (!window_digits.length) return [];
            const total = window_digits.length;
            const distribution = getDigitDistribution(window_digits);
            const ranked = distribution.map((pct, digit) => ({ digit, pct })).sort((a, b) => b.pct - a.pct);
            const even = (window_digits.filter(digit => digit % 2 === 0).length / total) * 100;
            const under = (window_digits.filter(digit => digit < 5).length / total) * 100;
            const over = (window_digits.filter(digit => digit > 5).length / total) * 100;

            if (for_strategy === 'even_odd') {
                return [
                    { baseline: 50, label: localize('EVEN'), pct: even },
                    { baseline: 50, label: localize('ODD'), pct: 100 - even },
                ];
            }
            if (for_strategy === 'over_under') {
                // Under 5 is five digits, over 5 is four - so they do not share
                // a baseline and cannot be compared on raw percentage.
                return [
                    { baseline: 50, label: localize('UNDER 5'), pct: under },
                    { baseline: 40, label: localize('OVER 5'), pct: over },
                ];
            }
            const top = ranked[0];
            const bottom = ranked[ranked.length - 1];
            return [
                { baseline: 10, label: localize('MATCHES {{digit}}', { digit: top.digit }), pct: top.pct },
                {
                    baseline: 90,
                    label: localize('DIFFERS from {{digit}}', { digit: bottom.digit }),
                    pct: 100 - bottom.pct,
                },
            ];
        },
        [localize]
    );

    const sides = useMemo(() => makeSides(digits, strategy), [makeSides, digits, strategy]);

    // The verdict comes from one pure function so it can be exercised without a
    // feed, a socket or a DOM - see signal-quality.ts and its spec. Sides are
    // ranked by evidence rather than by raw point gap, because a point is not
    // the same size of surprise on a 10% baseline as on a 50% one.
    const has_feed = isConnected && !history_error;
    const evaluation = useMemo(
        () => evaluateWindow({ digits, has_feed, sides, strategy }),
        [digits, has_feed, sides, strategy]
    );
    const { entropy, leader, required_z, scored, separation_z } = evaluation;

    const conditions = useMemo(
        () => [
            { label: localize('Live tick feed connected'), pass: has_feed },
            {
                label: localize('Sample of at least {{count}} ticks', { count: MIN_SAMPLE }),
                pass: digits.length >= MIN_SAMPLE,
            },
            {
                label: localize('Digit spread at least {{floor}} of 1.00 (now {{value}})', {
                    floor: MIN_ENTROPY.toFixed(2),
                    value: entropy.toFixed(3),
                }),
                pass: entropy >= MIN_ENTROPY,
            },
            {
                label: localize('Leading side at least {{required}} SE from its baseline', {
                    required: required_z.toFixed(2),
                }),
                pass: !!leader && leader.z >= required_z,
            },
            {
                label: localize('Clear of the other reading by {{gap}} SE', {
                    gap: MIN_SEPARATION_Z.toFixed(2),
                }),
                pass: separation_z >= MIN_SEPARATION_Z,
            },
        ],
        [has_feed, digits.length, entropy, leader, required_z, separation_z, localize]
    );

    const status = useMemo<TStatus>(() => {
        if (!has_feed) return 'error';
        if (!digits.length) return 'waiting';
        if (digits.length < MIN_SAMPLE) return 'scanning';
        return evaluation.qualifies ? 'good_market' : 'no_signal';
    }, [has_feed, digits.length, evaluation.qualifies]);

    // Identity, not a timer, is what stops a signal alerting twice: the same
    // market, strategy and side is the same signal however many ticks it
    // survives. It clears when the market changes, so a new market starts fresh.
    const signal_id = status === 'good_market' && leader ? `${symbol}|${strategy}|${leader.label}` : null;
    const alerted_id = useRef<string | null>(null);

    useEffect(() => {
        alerted_id.current = null;
        setDetectedAt(null);
    }, [symbol, strategy]);

    const audio = useRef<HTMLAudioElement | null>(null);
    if (!audio.current && typeof Audio !== 'undefined') {
        audio.current = new Audio(`${window.__webpack_public_path__ ?? '/'}${ALERT_SOUND}`);
        audio.current.preload = 'auto';
    }

    const playAlert = useCallback(() => {
        if (!sound_on || !audio.current) return;
        audio.current.currentTime = 0;
        audio.current
            .play()
            .then(() => setSoundBlocked(false))
            // Autoplay is not allowed until this page has been interacted with.
            // That is the browser working as intended, so it becomes a state the
            // panel offers to fix rather than an error in the console.
            .catch(() => setSoundBlocked(true));
    }, [sound_on]);

    useEffect(() => {
        if (!signal_id || !leader) return;
        if (alerted_id.current === signal_id) return;
        alerted_id.current = signal_id;

        const stamp = gmt(last_tick ? new Date(last_tick.epoch * 1000) : new Date());
        setDetectedAt(stamp);
        setHistory(prev =>
            [
                {
                    edge: leader.edge,
                    id: `${signal_id}|${stamp}`,
                    market: symbol_name,
                    signal: leader.label,
                    time: stamp,
                },
                ...prev,
            ].slice(0, HISTORY_LIMIT)
        );
        playAlert();
    }, [signal_id, leader, last_tick, symbol_name, playAlert]);

    const toggleSound = () => {
        const next = !sound_on;
        setSoundOn(next);
        try {
            localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
        } catch {
            // Storage blocked: the setting still applies for this session.
        }
        if (next) setSoundBlocked(false);
    };

    // A user gesture is exactly what the autoplay policy is waiting for, so the
    // unblock is the same play() call, made from a click.
    const enableSound = () => {
        if (!audio.current) return;
        audio.current.currentTime = 0;
        audio.current
            .play()
            .then(() => setSoundBlocked(false))
            .catch(() => setSoundBlocked(true));
    };

    // ---------------------------------------------------------------------
    // The Analysis Dashboard: press Analyse and every market is read once,
    // scored by the same rules the live panel uses, and ranked. Nothing here
    // invents a reading - a market that fails to answer is reported as failing
    // to answer, which is why the log has an error tone at all.
    // ---------------------------------------------------------------------
    const [scan_phase, setScanPhase] = useState<'idle' | 'scanning' | 'done'>('idle');
    const [scan_log, setScanLog] = useState<TLine[]>([]);
    const [scan_result, setScanResult] = useState<TScanResult | null>(null);
    const [countdown, setCountdown] = useState<number | null>(null);
    const scan_token = useRef(0);
    const log_ref = useRef<TLine[]>([]);

    const setLog = (lines: TLine[]) => {
        log_ref.current = lines;
        setScanLog(lines);
    };
    const addLine = (line: TLine) => setLog([...log_ref.current, line]);

    const closeScan = () => {
        scan_token.current += 1;
        setScanPhase('idle');
        setLog([]);
        setScanResult(null);
        setCountdown(null);
    };

    const runScan = async () => {
        // Opened here, in the press's own call stack: Safari only honours an
        // AudioContext resumed inside the gesture, and the effect that starts
        // the loop runs after that stack has unwound.
        scan_sound.prime();
        const token = ++scan_token.current;
        setScanPhase('scanning');
        setScanResult(null);
        setCountdown(null);
        setLog([
            {
                text: localize('Analysis Dashboard - {{strategy}}', { strategy: strategy_label }),
                tone: 'head',
            },
        ]);
        playAlert();

        let sweep = 0;

        // Sweeps until something genuinely qualifies. The bar is untouched -
        // this waits for a real signal to occur rather than lowering what counts
        // as one, which is the difference between a monitor and a scanner that
        // tells you what you want to hear. It stops when the trader closes the
        // dashboard or starts another scan; scan_token is what ends the loop.
        for (;;) {
            if (token !== scan_token.current) return;
            sweep += 1;

            const list = symbols;
            if (!list.length) {
                addLine({
                    text: localize('No market list available. Check the connection and try again.'),
                    tone: 'warn',
                });
                setScanPhase('done');
                return;
            }

            // Where this sweep's per-market lines begin. They are collapsed to a
            // single summary once the sweep ends, so an hour of sweeping does
            // not leave a log nobody can read.
            const sweep_start = log_ref.current.length;
            addLine({
                text: localize('Sweep {{sweep}} - reading {{count}} markets...', { count: list.length, sweep }),
                tone: 'ok',
            });

            const scored: TScanEntry[] = [];
            const BATCH = 4;
            for (let i = 0; i < list.length; i += BATCH) {
                if (token !== scan_token.current) return;
                const batch = list.slice(i, i + BATCH);
                // eslint-disable-next-line no-await-in-loop
                const settled = await Promise.all(
                    batch.map(async item => {
                        try {
                            const { pip_size, prices } = await feed.getTickHistory(item.underlying_symbol, SAMPLE_SIZE);
                            const places = toDecimalPlaces(pip_size) ?? 2;
                            const window_digits = prices.map(price => getLastDigit(price, places)).reverse();
                            return {
                                digits: window_digits,
                                evaluation: evaluateWindow({
                                    digits: window_digits,
                                    has_feed: true,
                                    sides: makeSides(window_digits, strategy),
                                    strategy,
                                }),
                                item,
                                ok: true as const,
                            };
                        } catch {
                            return { item, ok: false as const };
                        }
                    })
                );
                if (token !== scan_token.current) return;

                settled.forEach(entry => {
                    if (!entry.ok) {
                        addLine({
                            text: localize('Error: no data from {{market}}...', {
                                market: entry.item.underlying_symbol_name,
                            }),
                            tone: 'warn',
                        });
                        return;
                    }
                    const lead = entry.evaluation.leader;
                    scored.push({
                        digits: entry.digits,
                        evaluation: entry.evaluation,
                        name: entry.item.underlying_symbol_name,
                        symbol: entry.item.underlying_symbol,
                    });
                    addLine({
                        text: localize('{{market}}: {{side}} {{z}} SE', {
                            market: entry.item.underlying_symbol_name,
                            side: lead ? lead.label : localize('no reading'),
                            z: lead ? lead.z.toFixed(2) : '--',
                        }),
                        tone: 'dim',
                    });
                });
                // eslint-disable-next-line no-await-in-loop
                await new Promise(resolve => setTimeout(resolve, 120));
            }

            if (token !== scan_token.current) return;

            const eligible = scored.filter(entry => entry.evaluation.qualifies);
            const best = [...eligible].sort((a, b) => (b.evaluation.leader?.z ?? 0) - (a.evaluation.leader?.z ?? 0))[0];

            if (best?.evaluation.leader) {
                const lead = best.evaluation.leader;
                setLog([
                    ...log_ref.current.slice(0, sweep_start),
                    {
                        text: localize('Sweep {{sweep}} - {{count}} markets, {{eligible}} qualified.', {
                            count: scored.length,
                            eligible: eligible.length,
                            sweep,
                        }),
                        tone: 'ok',
                    },
                    { text: localize('Analysis complete.'), tone: 'head' },
                ]);
                setScanResult({
                    digits: best.digits.slice(0, 8),
                    name: best.name,
                    pct: lead.pct,
                    sample: best.digits.length,
                    side: lead.label,
                    symbol: best.symbol,
                    z: lead.z,
                });
                playAlert();
                setScanPhase('done');
                setCountdown(COUNTDOWN_FROM);
                return;
            }

            // Nothing qualified. Collapse the sweep to one line, say how close
            // the nearest came, and go round again.
            const closest = [...scored].sort(
                (a, b) => (b.evaluation.leader?.z ?? 0) - (a.evaluation.leader?.z ?? 0)
            )[0];
            const summary: TLine[] = [
                {
                    text: localize('Sweep {{sweep}} - {{count}} markets, 0 qualified.', {
                        count: scored.length,
                        sweep,
                    }),
                    tone: 'ok',
                },
            ];
            if (closest?.evaluation.leader) {
                summary.push({
                    text: localize('Closest: {{market}} at {{z}} SE against {{required}} SE required.', {
                        market: closest.name,
                        required: closest.evaluation.required_z.toFixed(2),
                        z: closest.evaluation.leader.z.toFixed(2),
                    }),
                    tone: 'dim',
                });
            }
            summary.push({
                text: localize('Rescanning in {{seconds}}s...', { seconds: RESCAN_SECONDS }),
                tone: 'dim',
            });
            // Only the last few sweeps are worth keeping on screen.
            const kept = [...log_ref.current.slice(0, sweep_start), ...summary];
            setLog(kept.length > LOG_LIMIT ? [kept[0], ...kept.slice(kept.length - LOG_LIMIT + 1)] : kept);

            // eslint-disable-next-line no-await-in-loop
            await new Promise(resolve => setTimeout(resolve, RESCAN_SECONDS * 1000));
        }
    };

    useEffect(() => {
        if (countdown === null || countdown < 0) return undefined;
        const timer = setTimeout(() => setCountdown(value => (value === null ? null : value - 1)), 1000);
        return () => clearTimeout(timer);
    }, [countdown]);

    /**
     * The scanning sound belongs to this scanner and to no other: it follows
     * scan_phase, the same flag the dashboard's own sweeping state uses, so it
     * lasts exactly as long as a sweep does and stops the moment one settles -
     * on a market found, on nothing found, on an error, on the dashboard being
     * closed, and on this view being left.
     */
    useEffect(() => {
        if (scan_phase === 'scanning') scan_sound.start();
        else scan_sound.stop();
        return () => scan_sound.stop();
    }, [scan_phase]);

    return (
        <div className='mw-signals'>
            {/* Six columns rather than three: the reference fills the whole
                field with chatter, and three left visible gutters between them. */}
            <div className='mw-signals__rain' aria-hidden='true'>
                <RainColumn duration={11} seed={1} />
                <RainColumn duration={14} seed={7} />
                <RainColumn duration={12} seed={4} />
                <RainColumn duration={16} seed={9} />
                <RainColumn duration={13} seed={2} />
                <RainColumn duration={15} seed={5} />
            </div>

            <div className='mw-signals__panel'>
                <h2 className='mw-signals__title'>{localize('Signal Analyzer')}</h2>

                <div className='mw-signals__controls'>
                    <label className='mw-signals__field'>
                        <span>{localize('Select Strategy')}</span>
                        <select value={strategy} onChange={event => setStrategy(event.target.value as TStrategy)}>
                            {STRATEGIES.map(item => (
                                <option key={item.id} value={item.id}>
                                    {localize(item.label)}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className='mw-signals__field'>
                        <span>{localize('Select Market')}</span>
                        <select value={symbol} onChange={event => setSymbol(event.target.value)}>
                            <option value={NO_SYMBOL}>{localize('-- Select Market --')}</option>
                            {symbols.map(item => (
                                <option key={item.underlying_symbol} value={item.underlying_symbol}>
                                    {item.underlying_symbol_name}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>

                {/* The reference's headline readout: the two live numbers, big,
                    green and centred, above everything the scanner concludes. */}
                <div className='mw-signals__readout'>
                    <p>
                        {localize('Latest Tick:')} <b>{quote === null ? '--' : quote.toFixed(decimals)}</b>
                    </p>
                    <p>
                        {localize('Last Digit:')} <b>{current_digit ?? '--'}</b>
                    </p>
                </div>

                {/* Opens the Analysis Dashboard, which reads every market once
                    and ranks them. The live panel below keeps running
                    throughout - this is a sweep across markets, not a start
                    button for the scanner. */}
                <button
                    type='button'
                    className='mw-signals__analyse'
                    onClick={runScan}
                    disabled={scan_phase === 'scanning'}
                >
                    {scan_phase === 'scanning' ? localize('Analysing...') : localize('Analyse')}
                </button>

                {/* Nothing below appears until a market is chosen. With no
                    selection there is no window, so a status would be a verdict
                    on nothing - and NO SIGNAL sitting under an empty readout
                    reads as a finding rather than as "you have not picked a
                    market yet". */}
                {!!symbol && (
                    <div
                        className={`mw-signals__status mw-signals__status--${status}`}
                        role='status'
                        aria-live='polite'
                    >
                        <span className='mw-signals__status-label'>{localize(STATUS_LABEL[status])}</span>
                        {(status === 'scanning' || status === 'no_signal') && (
                            <span className='mw-signals__dots' aria-hidden='true'>
                                <i />
                                <i />
                                <i />
                            </span>
                        )}
                        {status === 'good_market' && detected_at && (
                            <span className='mw-signals__status-time'>
                                {localize('Detected {{time}} GMT', { time: detected_at })}
                            </span>
                        )}
                    </div>
                )}

                {status === 'error' && (
                    <div className='mw-signals__error'>
                        <p>
                            {localize(
                                'The tick feed is not delivering data for this market, so nothing is being analysed.'
                            )}
                        </p>
                        <button type='button' onClick={() => setRetryToken(value => value + 1)}>
                            {localize('Retry')}
                        </button>
                    </div>
                )}

                {/* The tick and the digit moved up into the headline readout, so
                    this row carries only what the scanner works out from them. */}
                {!!symbol && (
                    <div className='mw-signals__grid'>
                        <div className='mw-signals__cell'>
                            {/* Deliberately not "confidence": this is how many
                            standard errors the window sits from uniform, which
                            is a description of the sample, not a probability of
                            anything happening next. The points figure it is
                            derived from stays visible on the rows below. */}
                            <span>{localize('Signal deviation')}</span>
                            <b>
                                {leader && status !== 'error' ? localize('{{z}} SE', { z: leader.z.toFixed(2) }) : '--'}
                            </b>
                        </div>
                        <div className='mw-signals__cell'>
                            <span>{localize('Sample')}</span>
                            <b>
                                {digits.length}/{SAMPLE_SIZE}
                            </b>
                        </div>
                    </div>
                )}

                {/* Nothing from the last good window survives on screen while the
                    feed is down: a reading that is no longer being updated is not
                    a reading, and leaving it up next to SCANNER ERROR would be
                    presenting stale numbers as current. */}
                {!!scored.length && status !== 'error' && (
                    <ul className='mw-signals__sides'>
                        {scored.map(side => (
                            <li key={side.label} className={side === leader ? 'mw-signals__sides--lead' : undefined}>
                                <span>{side.label}</span>
                                <b>{side.pct.toFixed(1)}%</b>
                                <i>
                                    {side.edge >= 0 ? '+' : ''}
                                    {side.edge.toFixed(2)}{' '}
                                    {localize('pts vs {{baseline}}% baseline · {{z}} SE', {
                                        baseline: side.baseline,
                                        z: side.z.toFixed(2),
                                    })}
                                </i>
                            </li>
                        ))}
                    </ul>
                )}

                {!!symbol && (
                    <div className='mw-signals__conditions'>
                        <h3>{localize('Conditions')}</h3>
                        <ul>
                            {conditions.map(condition => (
                                <li
                                    key={condition.label}
                                    className={condition.pass ? 'mw-signals__cond--pass' : 'mw-signals__cond--fail'}
                                >
                                    <span aria-hidden='true'>{condition.pass ? '✓' : '×'}</span>
                                    {condition.label}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                <div className='mw-signals__foot'>
                    <span>{localize('Last scan {{time}} GMT', { time: gmt(now) })}</span>
                    <button
                        type='button'
                        className={`mw-signals__sound${sound_on ? ' mw-signals__sound--on' : ''}`}
                        onClick={toggleSound}
                        aria-pressed={sound_on}
                    >
                        {localize('Sound alerts: {{state}}', { state: sound_on ? localize('ON') : localize('OFF') })}
                    </button>
                </div>

                {sound_on && sound_blocked && (
                    <button type='button' className='mw-signals__unblock' onClick={enableSound}>
                        {localize('Tap to enable alert sound')}
                    </button>
                )}

                {!!history.length && (
                    <div className='mw-signals__history'>
                        <h3>{localize('Recent signals')}</h3>
                        <ul>
                            {history.map(record => (
                                <li key={record.id}>
                                    <span>{record.market}</span>
                                    <b>{record.signal}</b>
                                    <i>
                                        {record.edge >= 0 ? '+' : ''}
                                        {record.edge.toFixed(2)}
                                    </i>
                                    <time>{record.time}</time>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {scan_phase !== 'idle' && (
                <div
                    className='mw-signals__dash'
                    role='dialog'
                    aria-modal='true'
                    aria-label={localize('Analysis Dashboard')}
                >
                    <div className='mw-signals__dash-bar'>
                        <span className='mw-signals__dot' />
                        <span className='mw-signals__dot' />
                        <span className='mw-signals__dot' />
                        <button
                            type='button'
                            className='mw-signals__dash-close'
                            onClick={closeScan}
                            aria-label={localize('Close the analysis dashboard')}
                        >
                            X
                        </button>
                    </div>

                    <div className='mw-signals__dash-body' aria-live='polite'>
                        {scan_log.map((line, index) => (
                            <p key={index} className={`mw-signals__dash-line mw-signals__dash-line--${line.tone}`}>
                                {line.text}
                            </p>
                        ))}

                        {scan_phase === 'scanning' && (
                            <p className='mw-signals__dash-line'>
                                {localize('Scanning')}
                                <span className='mw-signals__dots' aria-hidden='true'>
                                    <i />
                                    <i />
                                    <i />
                                </span>
                            </p>
                        )}

                        {scan_result && (
                            <>
                                <p className='mw-signals__dash-line mw-signals__dash-line--head'>
                                    {localize('Best market: {{market}}', { market: scan_result.name })}
                                </p>
                                <p className='mw-signals__dash-line'>
                                    {localize('{{side}} at {{pct}}% of the last {{sample}} ticks', {
                                        pct: scan_result.pct.toFixed(1),
                                        sample: scan_result.sample,
                                        side: scan_result.side,
                                    })}
                                </p>
                                <p className='mw-signals__dash-line mw-signals__dash-line--dim'>
                                    {localize('Signal deviation {{z}} SE above baseline', {
                                        z: scan_result.z.toFixed(2),
                                    })}
                                </p>
                                <p className='mw-signals__dash-line mw-signals__dash-line--dim'>
                                    {localize('Recent digits: {{digits}}', { digits: scan_result.digits.join(', ') })}
                                </p>
                                {/* The setup is the contract this reading points at,
                                    which is a fact about the reading. No entry rule is
                                    invented here and nothing is promised about the
                                    next tick. */}
                                <p className='mw-signals__dash-line'>
                                    {localize('Setup: {{side}} on {{symbol}}', {
                                        side: scan_result.side,
                                        symbol: scan_result.symbol,
                                    })}
                                </p>
                                {countdown !== null && countdown >= 0 && (
                                    <p className='mw-signals__dash-line'>
                                        {localize('Ready in {{count}} seconds...', { count: countdown })}
                                    </p>
                                )}
                                {countdown !== null && countdown < 0 && (
                                    <p className='mw-signals__dash-line mw-signals__dash-line--head'>
                                        {localize(
                                            'Signal ready. Load this setup in the Bot Builder to trade it - nothing is placed from here.'
                                        )}
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
});

export default Signals;
