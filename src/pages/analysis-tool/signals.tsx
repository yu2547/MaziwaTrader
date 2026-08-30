import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { getDigitDistribution, getLastDigit, toDecimalPlaces } from '@/utils/market-data/last-digit';
import { TActiveSymbol, TTick } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';

const DEFAULT_SYMBOL = 'R_10';
const SAMPLE_SIZE = 1000;
const COUNTDOWN_FROM = 5;

type TStrategy = 'matches_differs' | 'even_odd' | 'over_under';

const STRATEGIES: { id: TStrategy; label: string }[] = [
    { id: 'matches_differs', label: 'Matches & Differs' },
    { id: 'even_odd', label: 'Even & Odd' },
    { id: 'over_under', label: 'Over & Under' },
];

/**
 * Background chatter. This is scenery - it is aria-hidden, it is behind a
 * scrim, and nothing in it is a reading of anything. The log that makes claims
 * is the one in the dashboard, and every line of that one is emitted by the
 * step that actually just happened.
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

const RainColumn = ({ seed, duration }: { seed: number; duration: number }) => {
    // Two copies of the same list, so the second reaches the top exactly as the
    // first leaves it and the loop has no seam.
    const lines = useMemo(() => {
        const rotated = [
            ...RAIN_LINES.slice(seed % RAIN_LINES.length),
            ...RAIN_LINES.slice(0, seed % RAIN_LINES.length),
        ];
        const filled = Array.from({ length: 24 }, (_, index) => rotated[(index * 5 + seed) % rotated.length]);
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

    const [symbols, setSymbols] = useState<TActiveSymbol[]>([]);
    const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
    const [strategy, setStrategy] = useState<TStrategy>('matches_differs');
    const [digits, setDigits] = useState<number[]>([]);
    const [last_tick, setLastTick] = useState<TTick | null>(null);
    const [decimals, setDecimals] = useState(2);

    const [phase, setPhase] = useState<'idle' | 'scanning' | 'done'>('idle');
    const [log, setLog] = useState<{ text: string; tone: 'ok' | 'warn' | 'head' }[]>([]);
    const [countdown, setCountdown] = useState<number | null>(null);

    // analyse() schedules callbacks that run after it returns, so they cannot
    // read `digits` from their closure - it is whatever the sample was at the
    // moment the button was pressed, which for the first press is the one tick
    // that arrived before the history landed. The ref is what the scan counts.
    const digits_ref = useRef<number[]>([]);
    digits_ref.current = digits;

    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
    const clearTimers = useCallback(() => {
        timers.current.forEach(clearTimeout);
        timers.current = [];
    }, []);
    useEffect(() => clearTimers, [clearTimers]);

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

    // Same seed-then-stream shape as the digit circles: history fills the
    // sample immediately, the live feed keeps it current.
    const request_id = useRef(0);
    useEffect(() => {
        if (!isConnected) return undefined;
        const id = ++request_id.current;
        setDigits([]);
        setLastTick(null);

        feed.getTickHistory(symbol, SAMPLE_SIZE)
            .then(({ prices, pip_size }) => {
                if (id !== request_id.current) return;
                const places = toDecimalPlaces(pip_size) ?? 2;
                setDecimals(places);
                setDigits(prices.map(price => getLastDigit(price, places)).reverse());
            })
            .catch(() => {
                // Non-fatal: the live stream still fills the sample.
            });

        const unsubscribe = feed.subscribeTicks(symbol, tick => {
            if (id !== request_id.current) return;
            const places = toDecimalPlaces(tick.pip_size) ?? 2;
            setDecimals(places);
            setLastTick(tick);
            setDigits(prev => [getLastDigit(tick.quote, places), ...prev].slice(0, SAMPLE_SIZE));
        });

        return () => unsubscribe();
    }, [isConnected, feed, symbol]);

    const symbol_name = symbols.find(item => item.underlying_symbol === symbol)?.underlying_symbol_name ?? symbol;
    const strategy_label = STRATEGIES.find(item => item.id === strategy)?.label ?? '';
    const current_digit = digits[0] ?? null;

    // The reading itself. Counted from the sample above - the same ticks the
    // Latest Tick line is showing - so the percentages are of a real window and
    // the window size is stated with them.
    const verdict = useMemo(() => {
        if (!digits.length) return null;
        const distribution = getDigitDistribution(digits);
        const ranked = distribution.map((pct, digit) => ({ pct, digit })).sort((a, b) => b.pct - a.pct);
        const even = (digits.filter(digit => digit % 2 === 0).length / digits.length) * 100;
        const under = (digits.filter(digit => digit < 5).length / digits.length) * 100;
        const over = (digits.filter(digit => digit > 5).length / digits.length) * 100;

        // Even/Odd and Over/Under are two sides of one bet, so the larger side
        // is a call worth naming.
        if (strategy === 'even_odd') {
            return {
                rows: [
                    { label: localize('EVEN'), pct: even },
                    { label: localize('ODD'), pct: 100 - even },
                ],
                call: even >= 50 ? localize('EVEN') : localize('ODD'),
            };
        }
        if (strategy === 'over_under') {
            return {
                rows: [
                    { label: localize('UNDER 5'), pct: under },
                    { label: localize('OVER 5'), pct: over },
                    { label: localize('EQUALS 5'), pct: 100 - under - over },
                ],
                call: under >= over ? localize('UNDER 5') : localize('OVER 5'),
            };
        }

        // Matches and Differs are not. A differs rate near 90% and a matches
        // rate near 10% are the same distribution read two ways, and they pay
        // accordingly - naming the bigger number as the better side would be
        // comparing a percentage against a percentage that does not mean the
        // same thing. Both candidates are listed with their own frequency and
        // no call is made between them.
        const top = ranked[0];
        const bottom = ranked[ranked.length - 1];
        return {
            rows: [
                { label: localize('MATCHES {{digit}}', { digit: top.digit }), pct: top.pct },
                { label: localize('DIFFERS from {{digit}}', { digit: bottom.digit }), pct: 100 - bottom.pct },
            ],
            call: null,
        };
    }, [digits, strategy, localize]);

    const push = (text: string, tone: 'ok' | 'warn' | 'head' = 'ok') => setLog(prev => [...prev, { text, tone }]);

    const analyse = () => {
        clearTimers();
        setPhase('scanning');
        setCountdown(null);
        setLog([
            {
                text: localize('Analysis Dashboard - {{strategy}} on {{symbol}}', { strategy: strategy_label, symbol }),
                tone: 'head',
            },
        ]);

        const steps: { text: string; tone: 'ok' | 'warn' }[] = [
            { text: localize('Connecting to the tick stream...'), tone: 'ok' },
            {
                text: isConnected ? localize('Stream connected.') : localize('Stream not connected. Retrying...'),
                tone: isConnected ? 'ok' : 'warn',
            },
            { text: localize('Retrieving market data...'), tone: 'ok' },
        ];

        steps.forEach((step, index) => {
            timers.current.push(setTimeout(() => push(step.text, step.tone), 400 * (index + 1)));
        });

        // The scan ends when there is actually a sample to read, not on a fixed
        // timer - if the feed is down this stays scanning and says so rather
        // than printing a verdict over no data.
        const settle = () => {
            if (!digits_ref.current.length) {
                push(localize('No ticks received yet. Still waiting for the feed...'), 'warn');
                timers.current.push(setTimeout(settle, 1500));
                return;
            }
            push(localize('Read {{count}} ticks.', { count: digits_ref.current.length }));
            setPhase('done');
        };
        timers.current.push(setTimeout(settle, 1600));
    };

    // The countdown from the reference, kept as the beat between the reading
    // and acting on it. It ends on the call, not on a trade: nothing here
    // places an order, and the strategy still has to be loaded and run in the
    // Bot Builder by hand.
    useEffect(() => {
        if (phase !== 'done' || countdown !== null) return;
        setCountdown(COUNTDOWN_FROM);
    }, [phase, countdown]);

    useEffect(() => {
        if (countdown === null || countdown < 0) return undefined;
        const timer = setTimeout(() => setCountdown(value => (value === null ? null : value - 1)), 1000);
        return () => clearTimeout(timer);
    }, [countdown]);

    const reset = () => {
        clearTimers();
        setPhase('idle');
        setLog([]);
        setCountdown(null);
    };

    return (
        <div className='mw-signals'>
            <div className='mw-signals__rain' aria-hidden='true'>
                <RainColumn seed={1} duration={26} />
                <RainColumn seed={7} duration={34} />
                <RainColumn seed={4} duration={30} />
            </div>

            <div className='mw-signals__console'>
                <h2 className='mw-signals__title'>{localize('Signal Analyzer')}</h2>

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
                        {symbols.length === 0 && <option value={symbol}>{symbol}</option>}
                        {symbols.map(item => (
                            <option key={item.underlying_symbol} value={item.underlying_symbol}>
                                {item.underlying_symbol_name}
                            </option>
                        ))}
                    </select>
                </label>

                <div className='mw-signals__readout'>
                    <p>
                        {localize('Latest Tick:')} <b>{last_tick ? last_tick.quote.toFixed(decimals) : '--'}</b>
                    </p>
                    <p>
                        {localize('Last Digit:')} <b>{current_digit ?? '--'}</b>
                    </p>
                </div>

                <button type='button' className='mw-signals__analyse' onClick={analyse} disabled={phase === 'scanning'}>
                    {phase === 'scanning' ? localize('Analysing...') : localize('Analyse')}
                </button>
            </div>

            {phase !== 'idle' && (
                <div className='mw-signals__dash' role='status' aria-live='polite'>
                    <div className='mw-signals__dash-bar'>
                        <span className='mw-signals__dot' />
                        <span className='mw-signals__dot' />
                        <span className='mw-signals__dot' />
                        <button
                            type='button'
                            className='mw-signals__close'
                            onClick={reset}
                            aria-label={localize('Close the analysis dashboard')}
                        >
                            X
                        </button>
                    </div>

                    <div className='mw-signals__dash-body'>
                        {log.map((line, index) => (
                            <p key={index} className={`mw-signals__line mw-signals__line--${line.tone}`}>
                                {line.text}
                            </p>
                        ))}

                        {phase === 'scanning' && <p className='mw-signals__line'>{localize('Analysing...')}</p>}

                        {phase === 'done' && verdict && (
                            <>
                                <p className='mw-signals__line mw-signals__line--head'>
                                    {localize('Analysis complete.')}
                                </p>
                                <p className='mw-signals__line mw-signals__line--dim'>
                                    {localize('{{name}}, last {{count}} ticks:', {
                                        name: symbol_name,
                                        count: digits.length,
                                    })}
                                </p>
                                {verdict.rows.map(row => (
                                    <p key={row.label} className='mw-signals__line'>
                                        {localize('{{label}} - {{pct}}%', {
                                            label: row.label,
                                            pct: row.pct.toFixed(1),
                                        })}
                                    </p>
                                ))}
                                {verdict.call && (
                                    <p className='mw-signals__line mw-signals__line--head'>
                                        {localize('Stronger side: {{call}}', { call: verdict.call })}
                                    </p>
                                )}
                                {countdown !== null && countdown >= 0 && (
                                    <p className='mw-signals__line'>
                                        {localize('Ready in {{count}} seconds...', { count: countdown })}
                                    </p>
                                )}
                                {countdown !== null && countdown < 0 && (
                                    <p className='mw-signals__line mw-signals__line--head'>
                                        {localize(
                                            'Signal ready. Load this strategy in the Bot Builder to trade it - nothing is placed from here.'
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
