import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import useUtcClock from '@/hooks/useUtcClock';
import { getDigitDistribution, getLastDigit, toDecimalPlaces } from '@/utils/market-data/last-digit';
import { TActiveSymbol, TTick } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';
import { evaluateWindow, MIN_ENTROPY, MIN_SAMPLE, MIN_SEPARATION_Z, TSide, TStrategy } from './signal-quality';
import './tick-analyser.scss';

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
// Its own key, so muting this panel does not mute the Signals analyzer.
const SOUND_KEY = 'mw_tick_analyser_sound';
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

const TickAnalyser = observer(() => {
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

    // The window's own digit frequencies, and the two ends of them. Every
    // figure on the digit card comes from here.
    const distribution = useMemo(
        () => (digits.length ? getDigitDistribution(digits) : Array.from({ length: 10 }, () => 0)),
        [digits]
    );
    const ranked_digits = useMemo(
        () => distribution.map((pct, digit) => ({ digit, pct })).sort((a, b) => b.pct - a.pct),
        [distribution]
    );
    const most_frequent = digits.length ? ranked_digits[0] : null;
    const least_frequent = digits.length ? ranked_digits[ranked_digits.length - 1] : null;

    // The verdict comes from one pure function so it can be exercised without a
    // feed, a socket or a DOM - see signal-quality.ts and its spec. Sides are
    // ranked by evidence rather than by raw point gap, because a point is not
    // the same size of surprise on a 10% baseline as on a 50% one.
    const has_feed = isConnected && !history_error;
    const evaluation = useMemo(
        () => evaluateWindow({ digits, has_feed, sides, strategy }),
        [digits, has_feed, sides, strategy]
    );
    const { entropy, leader, required_z, separation_z } = evaluation;

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

    const window_full = digits.length >= MIN_SAMPLE;
    const failing = conditions.filter(condition => !condition.pass);

    return (
        <div className='mw-tick'>
            <header className='mw-tick__head'>
                <div>
                    <h2>{localize('Tick Analyser')}</h2>
                    <p>
                        {localize('Live digit and price analysis over the last {{count}} ticks.', {
                            count: SAMPLE_SIZE,
                        })}
                    </p>
                </div>
                <div className='mw-tick__head-actions'>
                    <span className={`mw-tick__badge mw-tick__badge--${status}`}>{localize(STATUS_LABEL[status])}</span>
                    <button type='button' className='mw-tick__ghost' onClick={toggleSound} aria-pressed={sound_on}>
                        {sound_on ? localize('Alerts on') : localize('Alerts off')}
                    </button>
                    {/* Opens the app's own AI scanner - the floating orb's panel -
                        rather than starting a second one of this page's own. */}
                    <button
                        type='button'
                        className='mw-tick__launch'
                        onClick={() => window.dispatchEvent(new CustomEvent('mw:open-entry-scanner'))}
                    >
                        {localize('Launch AI')}
                    </button>
                </div>
            </header>

            {sound_blocked && (
                <div className='mw-tick__notice'>
                    <span>
                        {localize('Your browser is holding back the alert sound until you interact with the page.')}
                    </span>
                    <button type='button' onClick={enableSound}>
                        {localize('Enable sound')}
                    </button>
                </div>
            )}

            {history_error && (
                <div className='mw-tick__notice mw-tick__notice--error'>
                    <span>{localize('Could not read tick history for this market.')}</span>
                    <button type='button' onClick={() => setRetryToken(token => token + 1)}>
                        {localize('Retry')}
                    </button>
                </div>
            )}

            <div className='mw-tick__grid'>
                <section className='mw-tick__card'>
                    <h3>{localize('Market & strategy')}</h3>
                    <label className='mw-tick__field'>
                        <span>{localize('Market')}</span>
                        <select value={symbol} onChange={event => setSymbol(event.target.value)}>
                            <option value={NO_SYMBOL}>{localize('Select a market')}</option>
                            {symbols.map(item => (
                                <option key={item.underlying_symbol} value={item.underlying_symbol}>
                                    {item.underlying_symbol_name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className='mw-tick__field'>
                        <span>{localize('Strategy')}</span>
                        <select value={strategy} onChange={event => setStrategy(event.target.value as TStrategy)}>
                            {STRATEGIES.map(item => (
                                <option key={item.id} value={item.id}>
                                    {localize(item.label)}
                                </option>
                            ))}
                        </select>
                    </label>

                    <div className='mw-tick__live'>
                        <div>
                            <span>{localize('Current price')}</span>
                            <b>{quote === null ? '--' : quote.toFixed(decimals)}</b>
                        </div>
                        <div>
                            <span>{localize('Last digit')}</span>
                            <b>{current_digit === null ? '--' : current_digit}</b>
                        </div>
                        <div>
                            <span>{localize('Ticks')}</span>
                            <b>
                                {digits.length}/{SAMPLE_SIZE}
                            </b>
                        </div>
                    </div>
                    <div className='mw-tick__meter'>
                        <div style={{ width: `${Math.min(100, (digits.length / SAMPLE_SIZE) * 100)}%` }} />
                    </div>
                    <p className='mw-tick__muted'>{symbol ? symbol_name : localize('No market selected')}</p>
                </section>

                <section className='mw-tick__card mw-tick__card--wide'>
                    <h3>{localize('Digit frequency')}</h3>

                    <div className='mw-tick__digits'>
                        {distribution.map((pct, digit) => (
                            <div
                                key={digit}
                                className={`mw-tick__digit${digit === current_digit ? ' mw-tick__digit--now' : ''}${
                                    digit === most_frequent?.digit ? ' mw-tick__digit--most' : ''
                                }${digit === least_frequent?.digit ? ' mw-tick__digit--least' : ''}`}
                            >
                                <b>{digit}</b>
                                <i>{digits.length ? `${pct.toFixed(1)}%` : '--'}</i>
                                <span style={{ height: `${Math.min(100, pct * 5)}%` }} />
                            </div>
                        ))}
                    </div>
                    <div className='mw-tick__facts'>
                        <div>
                            <span>{localize('Current digit')}</span>
                            <b>{current_digit === null ? '--' : current_digit}</b>
                        </div>
                        <div>
                            <span>{localize('Most frequent')}</span>
                            <b>{most_frequent ? `${most_frequent.digit} · ${most_frequent.pct.toFixed(1)}%` : '--'}</b>
                        </div>
                        <div>
                            <span>{localize('Least frequent')}</span>
                            <b>
                                {least_frequent ? `${least_frequent.digit} · ${least_frequent.pct.toFixed(1)}%` : '--'}
                            </b>
                        </div>
                    </div>
                </section>

                <section className='mw-tick__card mw-tick__card--signal'>
                    <h3>{localize('AI signal')}</h3>
                    <dl>
                        <div>
                            <dt>{localize('Market')}</dt>
                            <dd>{symbol ? symbol_name : '--'}</dd>
                        </div>
                        <div>
                            <dt>{localize('Strategy')}</dt>
                            <dd>{strategy_label}</dd>
                        </div>
                        <div>
                            <dt>{localize('Signal')}</dt>
                            <dd className='mw-tick__signal'>{leader ? leader.label : '--'}</dd>
                        </div>
                        <div>
                            <dt>{localize('Observed share')}</dt>
                            <dd>{leader ? `${leader.pct.toFixed(2)}%` : '--'}</dd>
                        </div>
                        {/* Evidence, not a win rate: how far the leading side sits
                            from its own baseline, against what this strategy has
                            to clear. */}
                        <div>
                            <dt>{localize('Evidence')}</dt>
                            <dd>
                                {leader
                                    ? localize('{{z}} of {{required}} SE', {
                                          required: required_z.toFixed(2),
                                          z: leader.z.toFixed(2),
                                      })
                                    : '--'}
                            </dd>
                        </div>
                        <div>
                            <dt>{localize('Current digit')}</dt>
                            <dd>{current_digit === null ? '--' : current_digit}</dd>
                        </div>
                        <div>
                            <dt>{localize('Market condition')}</dt>
                            <dd>
                                {localize('{{status}} · spread {{entropy}}', {
                                    entropy: entropy.toFixed(3),
                                    status: localize(STATUS_LABEL[status]),
                                })}
                            </dd>
                        </div>
                        <div>
                            <dt>{localize('Entry condition')}</dt>
                            <dd>
                                {status === 'good_market'
                                    ? localize('All conditions met at {{time}} GMT', {
                                          time: detected_at ?? gmt(now),
                                      })
                                    : failing.length
                                      ? failing[0].label
                                      : localize('Waiting for the window to fill')}
                            </dd>
                        </div>
                    </dl>

                    <ul className='mw-tick__conditions'>
                        {conditions.map(condition => (
                            <li
                                key={condition.label}
                                className={condition.pass ? 'mw-tick__cond--pass' : 'mw-tick__cond--fail'}
                            >
                                {condition.label}
                            </li>
                        ))}
                    </ul>
                </section>
            </div>

            <section className='mw-tick__card'>
                <div className='mw-tick__scan-head'>
                    <h3>{localize('Scan every market')}</h3>
                    <div>
                        {scan_phase === 'scanning' ? (
                            <button type='button' className='mw-tick__ghost' onClick={closeScan}>
                                {localize('Stop')}
                            </button>
                        ) : (
                            <button
                                type='button'
                                className='mw-tick__launch'
                                onClick={runScan}
                                disabled={!symbols.length}
                            >
                                {localize('Scan markets')}
                            </button>
                        )}
                    </div>
                </div>

                {scan_result && (
                    <div className='mw-tick__result'>
                        <div>
                            <span>{localize('Market')}</span>
                            <b>{scan_result.name}</b>
                        </div>
                        <div>
                            <span>{localize('Signal')}</span>
                            <b>{scan_result.side}</b>
                        </div>
                        <div>
                            <span>{localize('Observed share')}</span>
                            <b>{scan_result.pct.toFixed(2)}%</b>
                        </div>
                        <div>
                            <span>{localize('Evidence')}</span>
                            <b>{localize('{{z}} SE', { z: scan_result.z.toFixed(2) })}</b>
                        </div>
                        <div>
                            <span>{localize('Sample')}</span>
                            <b>{scan_result.sample}</b>
                        </div>
                        <button type='button' className='mw-tick__ghost' onClick={() => setSymbol(scan_result.symbol)}>
                            {localize('Open this market')}
                        </button>
                    </div>
                )}

                {scan_log.length > 0 && (
                    <ul className='mw-tick__log'>
                        {scan_log.slice(-8).map((line, index) => (
                            // Lines are appended in order and only the tail is
                            // shown, so the index is stable for this render.
                            // eslint-disable-next-line react/no-array-index-key
                            <li key={`${line.text}-${index}`} className={`mw-tick__log--${line.tone}`}>
                                {line.text}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {history.length > 0 && (
                <section className='mw-tick__card'>
                    <h3>{localize('Recent signals')}</h3>
                    <table className='mw-tick__table'>
                        <thead>
                            <tr>
                                <th>{localize('Time (GMT)')}</th>
                                <th>{localize('Market')}</th>
                                <th>{localize('Signal')}</th>
                                <th>{localize('Edge')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.map(record => (
                                <tr key={record.id}>
                                    <td>{record.time}</td>
                                    <td>{record.market}</td>
                                    <td>{record.signal}</td>
                                    <td>{record.edge.toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            )}

            <p className='mw-tick__muted mw-tick__footnote'>
                {localize(
                    'Every figure is counted from the live feed over the window shown. They describe ticks that have already happened, not the next one, and nothing here places a trade.'
                )}
                {window_full ? '' : ` ${localize('The window is still filling.')}`}
            </p>
        </div>
    );
});

export default TickAnalyser;
