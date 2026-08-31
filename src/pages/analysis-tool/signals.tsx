import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import useUtcClock from '@/hooks/useUtcClock';
import { getDigitDistribution, getLastDigit, toDecimalPlaces } from '@/utils/market-data/last-digit';
import { TActiveSymbol, TTick } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';

const DEFAULT_SYMBOL = 'R_10';
const SAMPLE_SIZE = 1000;
const MIN_SAMPLE = 200;
const HISTORY_LIMIT = 20;

/**
 * The two numbers that decide a good market, in percentage points.
 *
 * The analysis this file already did - a digit distribution over the live
 * window - never said whether what it found was worth acting on. These are that
 * missing half, and they are thresholds rather than probabilities: MIN_EDGE is
 * how far a side has to sit above the rate it would run at if digits were
 * uniform, and MIN_SEPARATION is how far clear of the other side it has to be.
 * Both are shown in the Conditions list so the bar is visible rather than
 * buried here.
 */
const MIN_EDGE = 2.5;
const MIN_SEPARATION = 1.5;

/** How many of the ten digits must actually appear before a window counts as a digit market. */
const MIN_DIGIT_SPREAD = 8;

/** The alert asset the app already ships, in assets/media. */
const ALERT_SOUND = 'assets/media/announcement.mp3';
const SOUND_KEY = 'mw_signals_sound';

type TStrategy = 'matches_differs' | 'even_odd' | 'over_under';
type TStatus = 'error' | 'waiting' | 'scanning' | 'no_signal' | 'good_market';

type TSide = {
    /** What the side would run at with uniform digits - 50% for EVEN, 10% for a single digit. */
    baseline: number;
    label: string;
    pct: number;
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
    const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
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
                const synthetics = list.filter(item => item.market === 'synthetic_index');
                setSymbols(synthetics.length ? synthetics : list);
            })
            .catch(() => {
                // Non-fatal: the selector stays on the default market.
            });
    }, [isConnected, feed]);

    // Seed from history, then stay current from the live stream - the same
    // shape the digit circles use, on the same feed. No second socket.
    const request_id = useRef(0);
    useEffect(() => {
        if (!isConnected) return undefined;
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
    const current_digit = digits[0] ?? null;

    // One pass over the window per change of window, not per render.
    const sides = useMemo<TSide[]>(() => {
        if (!digits.length) return [];
        const total = digits.length;
        const distribution = getDigitDistribution(digits);
        const ranked = distribution.map((pct, digit) => ({ digit, pct })).sort((a, b) => b.pct - a.pct);
        const even = (digits.filter(digit => digit % 2 === 0).length / total) * 100;
        const under = (digits.filter(digit => digit < 5).length / total) * 100;
        const over = (digits.filter(digit => digit > 5).length / total) * 100;

        if (strategy === 'even_odd') {
            return [
                { baseline: 50, label: localize('EVEN'), pct: even },
                { baseline: 50, label: localize('ODD'), pct: 100 - even },
            ];
        }
        if (strategy === 'over_under') {
            // Under 5 is five digits, over 5 is four - so they do not share a
            // baseline and cannot be compared on raw percentage.
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
    }, [digits, strategy, localize]);

    // Edge over baseline is what makes the sides comparable: a 12% matches rate
    // and a 91% differs rate are the same distribution read two ways, and only
    // the distance from what uniform digits would give says which is the
    // stronger reading.
    const scored = useMemo(
        () => sides.map(side => ({ ...side, edge: side.pct - side.baseline })).sort((a, b) => b.edge - a.edge),
        [sides]
    );
    const leader = scored[0] ?? null;
    const runner_up = scored[1] ?? null;

    const distinct_digits = useMemo(() => new Set(digits).size, [digits]);

    const conditions = useMemo(() => {
        const separation = leader && runner_up ? leader.edge - runner_up.edge : 0;
        return [
            { label: localize('Live tick feed connected'), pass: isConnected && !history_error },
            {
                label: localize('Sample of at least {{count}} ticks', { count: MIN_SAMPLE }),
                pass: digits.length >= MIN_SAMPLE,
            },
            // Range Break 100 quotes to one decimal and always ends in 0, which
            // reads as MATCHES 0 at 100% and a 90 point edge - arithmetically
            // true and worthless, because the digit never varies. A market whose
            // last digit barely moves is not a weak signal, it is not a digit
            // market at all.
            {
                label: localize('Last digit varies across at least {{count}} values', { count: MIN_DIGIT_SPREAD }),
                pass: distinct_digits >= MIN_DIGIT_SPREAD,
            },
            {
                label: localize('Leading side at least {{edge}} points above its baseline', { edge: MIN_EDGE }),
                pass: !!leader && leader.edge >= MIN_EDGE,
            },
            {
                label: localize('Clear of the other side by {{gap}} points', { gap: MIN_SEPARATION }),
                pass: separation >= MIN_SEPARATION,
            },
        ];
    }, [isConnected, history_error, digits.length, distinct_digits, leader, runner_up, localize]);

    const status = useMemo<TStatus>(() => {
        if (!isConnected || history_error) return 'error';
        if (!digits.length) return 'waiting';
        if (digits.length < MIN_SAMPLE) return 'scanning';
        return conditions.every(condition => condition.pass) ? 'good_market' : 'no_signal';
    }, [isConnected, history_error, digits.length, conditions]);

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

    return (
        <div className='mw-signals'>
            <div className='mw-signals__rain' aria-hidden='true'>
                <RainColumn duration={26} seed={1} />
                <RainColumn duration={34} seed={7} />
                <RainColumn duration={30} seed={4} />
            </div>

            <div className='mw-signals__panel'>
                <h2 className='mw-signals__title'>{localize('Signals')}</h2>

                <div className='mw-signals__controls'>
                    <label className='mw-signals__field'>
                        <span>{localize('Market')}</span>
                        <select value={symbol} onChange={event => setSymbol(event.target.value)}>
                            {symbols.length === 0 && <option value={symbol}>{symbol}</option>}
                            {symbols.map(item => (
                                <option key={item.underlying_symbol} value={item.underlying_symbol}>
                                    {item.underlying_symbol_name}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className='mw-signals__field'>
                        <span>{localize('Signal type')}</span>
                        <select value={strategy} onChange={event => setStrategy(event.target.value as TStrategy)}>
                            {STRATEGIES.map(item => (
                                <option key={item.id} value={item.id}>
                                    {localize(item.label)}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>

                <div className={`mw-signals__status mw-signals__status--${status}`} role='status' aria-live='polite'>
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

                <div className='mw-signals__grid'>
                    <div className='mw-signals__cell'>
                        <span>{localize('Latest tick')}</span>
                        <b>{quote === null ? '--' : quote.toFixed(decimals)}</b>
                    </div>
                    <div className='mw-signals__cell'>
                        <span>{localize('Current digit')}</span>
                        <b>{current_digit ?? '--'}</b>
                    </div>
                    <div className='mw-signals__cell'>
                        <span>{localize('Signal strength')}</span>
                        <b>
                            {leader && status !== 'error'
                                ? localize('{{edge}} pts', { edge: leader.edge.toFixed(2) })
                                : '--'}
                        </b>
                    </div>
                    <div className='mw-signals__cell'>
                        <span>{localize('Sample')}</span>
                        <b>
                            {digits.length}/{SAMPLE_SIZE}
                        </b>
                    </div>
                </div>

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
                                    {localize('vs {{baseline}}% baseline', { baseline: side.baseline })}
                                </i>
                            </li>
                        ))}
                    </ul>
                )}

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
        </div>
    );
});

export default Signals;
