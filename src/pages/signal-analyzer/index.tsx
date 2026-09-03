import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { getLastDigit, toDecimalPlaces } from '@/utils/market-data/last-digit';
import { useTranslations } from '@deriv-com/translations';
import './signal-analyzer.scss';

/**
 * Signal Analyzer - a terminal that reads the live market and reports what the
 * last thousand ticks actually did.
 *
 * The look is the one that was asked for: matrix rain behind a green terminal,
 * text typed in with a click, cipher noise while the window is read. Two
 * things behave differently from the tool this copies, both deliberately:
 *
 *   - Every figure is counted from real ticks. The original prints 0.00%,
 *     "null" and "Infinity%" - those are its own arithmetic showing through -
 *     and this was asked to scan the live market instead.
 *   - The connection log says what actually happened. The original prints
 *     "Error: Timeout connecting to node" and "Error: Unstable connection" on
 *     every run whether or not anything failed; inventing failures is the same
 *     thing as inventing results, and a real failure here would be lost in
 *     among them.
 *
 * Nothing here places a trade, and nothing here forecasts a tick: these are
 * frequencies over a window that has already happened.
 */

const TICK_WINDOW = 1000;

type TStrategyId = 'matches_differs' | 'even_odd' | 'over_under' | 'rise_fall';

const STRATEGIES: { id: TStrategyId; label: string }[] = [
    { id: 'matches_differs', label: 'Matches & Differs' },
    { id: 'even_odd', label: 'Even & Odd' },
    { id: 'over_under', label: 'Over & Under' },
    { id: 'rise_fall', label: 'Rise & Fall' },
];

const MARKETS = [
    { label: 'Volatility 10 Index', symbol: 'R_10' },
    { label: 'Volatility 25 Index', symbol: 'R_25' },
    { label: 'Volatility 50 Index', symbol: 'R_50' },
    { label: 'Volatility 75 Index', symbol: 'R_75' },
    { label: 'Volatility 100 Index', symbol: 'R_100' },
    { label: 'Volatility 10 (1s) Index', symbol: '1HZ10V' },
    { label: 'Volatility 25 (1s) Index', symbol: '1HZ25V' },
    { label: 'Volatility 50 (1s) Index', symbol: '1HZ50V' },
    { label: 'Volatility 75 (1s) Index', symbol: '1HZ75V' },
    { label: 'Volatility 100 (1s) Index', symbol: '1HZ100V' },
];

const CIPHER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#@%&*()[]{}<>/\\|=+-_$';
const RAIN_ALPHABET = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎ0123456789';

const cipherLine = (length: number) =>
    Array.from({ length }, () => CIPHER_ALPHABET[Math.floor(Math.random() * CIPHER_ALPHABET.length)]).join('');

const pct = (part: number, total: number) => (total ? (part / total) * 100 : 0);

// One list, in the order things happened - cipher blocks included. Kept apart
// in two lists at first, which rendered every block after every line, so
// "Analysis Complete!" appeared above the decryption that supposedly produced
// it.
type TLine = { text: string; tone?: 'error' | 'good' | 'dim' | 'cipher' };

/** What the window says, per strategy. Counted, never predicted. */
type TResult = { headline: string; lines: TLine[] };

const analyse = (strategy: TStrategyId, prices: number[], decimals: number): TResult | null => {
    if (prices.length < 20) return null;

    const digits = prices.map(price => getLastDigit(price, decimals));
    const total = digits.length;
    const counts = Array.from({ length: 10 }, (_, digit) => digits.filter(value => value === digit).length);
    const ranked = counts
        .map((count, digit) => ({ count, digit, share: pct(count, total) }))
        .sort((a, b) => b.count - a.count);

    if (strategy === 'over_under') {
        /**
         * Deriv settles these strictly over or strictly under the barrier, so
         * the barrier digit belongs to neither side.
         *
         * The barrier is chosen by how far the window sits above what the
         * digits alone would give, not by the biggest percentage. Over 0
         * covers nine digits out of ten and so comes in near 90% on any market
         * whatsoever - picking on raw share meant every reading was "OVER (1-9)
         * with 90.70%", which is arithmetic, not an edge. Against a 10%
         * baseline per digit, what is left is the part the market actually did.
         */
        let best = { barrier: 1, edge: -Infinity, share: 0, side: 'OVER' };
        for (let barrier = 0; barrier <= 9; barrier++) {
            const over_digits = 9 - barrier;
            const under_digits = barrier;
            if (over_digits > 0) {
                const share = pct(digits.filter(digit => digit > barrier).length, total);
                const edge = share - over_digits * 10;
                if (edge > best.edge) best = { barrier, edge, share, side: 'OVER' };
            }
            if (under_digits > 0) {
                const share = pct(digits.filter(digit => digit < barrier).length, total);
                const edge = share - under_digits * 10;
                if (edge > best.edge) best = { barrier, edge, share, side: 'UNDER' };
            }
        }
        const range = best.side === 'OVER' ? `${best.barrier + 1}-9` : `0-${best.barrier - 1}`;
        return {
            headline: `${best.side} (${range}) with ${best.share.toFixed(2)}%`,
            lines: [
                { text: `Recommended digit: ${best.barrier}` },
                {
                    text: `Entry Points: ${ranked
                        .slice(0, 3)
                        .map(item => item.digit)
                        .join(', ')}`,
                },
                {
                    text: `Counted over ${total} ticks: ${
                        best.edge >= 0 ? '+' : ''
                    }${best.edge.toFixed(2)} points against an even spread of the digits.`,
                    tone: 'dim',
                },
            ],
        };
    }

    if (strategy === 'even_odd') {
        const even = digits.filter(digit => digit % 2 === 0).length;
        const even_share = pct(even, total);
        const odd_share = 100 - even_share;
        const dominant = even_share >= odd_share ? 'EVEN' : 'ODD';
        const share = Math.max(even_share, odd_share);
        const top = ranked
            .filter(item => (dominant === 'EVEN' ? item.digit % 2 === 0 : item.digit % 2 === 1))
            .slice(0, 3)
            .map(item => item.digit)
            .join(', ');
        return {
            headline: `${dominant} numbers dominate (${share.toFixed(2)}%)`,
            lines: [
                { text: top },
                {
                    text: `Entry Point: Run your bot whenever ${
                        dominant === 'ODD' ? 'an odd' : 'an even'
                    } number appears after a sequence of 3 or more consecutive ${
                        dominant === 'ODD' ? 'even' : 'odd'
                    } numbers.`,
                },
                {
                    text: `Even ${even_share.toFixed(2)}% · Odd ${odd_share.toFixed(2)}% over ${total} ticks.`,
                    tone: 'dim',
                },
            ],
        };
    }

    if (strategy === 'rise_fall') {
        let rise = 0;
        let fall = 0;
        let flat = 0;
        for (let index = 1; index < prices.length; index++) {
            if (prices[index] > prices[index - 1]) rise += 1;
            else if (prices[index] < prices[index - 1]) fall += 1;
            else flat += 1;
        }
        const moves = rise + fall + flat;
        const rise_share = pct(rise, moves);
        const fall_share = pct(fall, moves);
        const leader = rise_share >= fall_share ? 'RISE' : 'FALL';
        return {
            headline: `${leader} leads with ${Math.max(rise_share, fall_share).toFixed(2)}%`,
            lines: [
                {
                    text: `Entry Point: When price crosses ${leader === 'FALL' ? 'below support' : 'above resistance'}`,
                },
                {
                    text: `Rise ${rise_share.toFixed(2)}% · Fall ${fall_share.toFixed(2)}% · Flat ${pct(
                        flat,
                        moves
                    ).toFixed(2)}% over ${moves} moves.`,
                    tone: 'dim',
                },
            ],
        };
    }

    const most = ranked[0];
    const least = ranked[ranked.length - 1];
    return {
        headline: `MATCH with ${most.digit} (${most.share.toFixed(2)}% of ticks)`,
        lines: [
            { text: `DIFFERS with ${least.digit} (${(100 - least.share).toFixed(2)}% of ticks)` },
            {
                text: `Most frequent digit ${most.digit} at ${most.count}/${total}, least frequent ${least.digit} at ${least.count}/${total}.`,
                tone: 'dim',
            },
        ],
    };
};

/** Falling katakana behind the terminal, sized to whatever box it is given. */
const MatrixRain = () => {
    const canvas = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const element = canvas.current;
        const context = element?.getContext('2d');
        if (!element || !context) return undefined;

        let columns: number[] = [];
        let frame = 0;
        const font_size = 14;

        const resize = () => {
            const rect = element.getBoundingClientRect();
            const ratio = window.devicePixelRatio || 1;
            element.width = rect.width * ratio;
            element.height = rect.height * ratio;
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            columns = Array.from({ length: Math.ceil(rect.width / font_size) }, () =>
                Math.floor((Math.random() * rect.height) / font_size)
            );
        };

        const observer = new ResizeObserver(resize);
        observer.observe(element);
        resize();

        const draw = () => {
            const rect = element.getBoundingClientRect();
            // A translucent wash rather than a clear, which is what leaves the
            // trail behind each falling character.
            context.fillStyle = 'rgba(0, 12, 0, 0.09)';
            context.fillRect(0, 0, rect.width, rect.height);
            context.font = `${font_size}px monospace`;

            columns.forEach((y, index) => {
                const character = RAIN_ALPHABET[Math.floor(Math.random() * RAIN_ALPHABET.length)];
                const x = index * font_size;
                context.fillStyle = y * font_size < 40 ? '#c9ffc9' : '#00ff41';
                context.fillText(character, x, y * font_size);
                columns[index] = y * font_size > rect.height && Math.random() > 0.975 ? 0 : y + 1;
            });

            frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);

        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, []);

    return <canvas className='mw-sa__rain' ref={canvas} aria-hidden='true' />;
};

const SignalAnalyzer = () => {
    const { feed, isConnected } = usePublicMarketFeed();
    const { localize } = useTranslations();

    const [strategy, setStrategy] = useState<TStrategyId>('matches_differs');
    const [symbol, setSymbol] = useState('R_100');
    const [price, setPrice] = useState<number | null>(null);
    const [decimals, setDecimals] = useState(2);

    const [is_open, setIsOpen] = useState(false);
    const [is_muted, setIsMuted] = useState(false);
    const [lines, setLines] = useState<TLine[]>([]);
    const [result, setResult] = useState<TResult | null>(null);
    const [countdown, setCountdown] = useState<number | null>(null);

    const audio = useRef<AudioContext | null>(null);
    const muted = useRef(false);
    const run_id = useRef(0);
    const log = useRef<HTMLDivElement>(null);

    const strategy_label = STRATEGIES.find(item => item.id === strategy)?.label ?? '';
    const market_label = MARKETS.find(item => item.symbol === symbol)?.label ?? symbol;

    useEffect(() => {
        muted.current = is_muted;
    }, [is_muted]);

    // The live tick, on the feed the app already holds open rather than a
    // second socket of this page's own.
    useEffect(() => {
        if (!isConnected) return undefined;
        setPrice(null);
        return feed.subscribeTicks(symbol, tick => {
            setDecimals(toDecimalPlaces(tick.pip_size) ?? 2);
            setPrice(tick.quote);
        });
    }, [feed, isConnected, symbol]);

    /**
     * One keystroke: a short square blip with a fast decay. Synthesised rather
     * than loaded so there is no audio file to fetch, and built on the click
     * that opens the terminal, which is the gesture browsers require before
     * any sound may play.
     */
    const click = useCallback(() => {
        const context = audio.current;
        if (!context || muted.current || context.state === 'closed') return;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'square';
        oscillator.frequency.value = 1100 + Math.random() * 700;
        gain.gain.setValueAtTime(0.045, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.03);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.035);
    }, []);

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    /** Types one line in, clicking as it goes. */
    const typeLine = useCallback(
        async (line: TLine, id: number) => {
            setLines(current => [...current, { ...line, text: '' }]);
            for (let index = 1; index <= line.text.length; index++) {
                if (id !== run_id.current) return;
                setLines(current => {
                    const next = [...current];
                    next[next.length - 1] = { ...line, text: line.text.slice(0, index) };
                    return next;
                });
                if (index % 3 === 0) click();
                await sleep(12);
            }
        },
        [click]
    );

    useEffect(() => {
        log.current?.scrollTo({ behavior: 'smooth', top: log.current.scrollHeight });
    }, [lines, result, countdown]);

    const run = useCallback(async () => {
        const id = ++run_id.current;
        setLines([]);
        setResult(null);
        setCountdown(null);

        await typeLine({ text: `Connecting to market feed...` }, id);
        if (id !== run_id.current) return;

        if (!isConnected) {
            await typeLine({ text: 'Error: market feed is not connected.', tone: 'error' }, id);
            return;
        }
        await typeLine({ text: `Connected. Analysing ${strategy_label} on ${market_label}...` }, id);
        await typeLine({ text: `Requesting ${TICK_WINDOW} ticks...` }, id);

        let prices: number[] = [];
        let places = decimals;
        try {
            const history = await feed.getTickHistory(symbol, TICK_WINDOW);
            prices = history.prices;
            places = toDecimalPlaces(history.pip_size) ?? decimals;
        } catch (error) {
            if (id !== run_id.current) return;
            await typeLine(
                {
                    text: `Error: ${error instanceof Error ? error.message : 'the tick history failed.'}`,
                    tone: 'error',
                },
                id
            );
            return;
        }
        if (id !== run_id.current) return;

        if (prices.length < 20) {
            await typeLine({ text: `Error: only ${prices.length} ticks came back.`, tone: 'error' }, id);
            return;
        }
        await typeLine({ text: `${prices.length} ticks received. Reading last digits...` }, id);

        // Cipher noise while the window is counted. Decoration, and only ever
        // over a window that is genuinely being read.
        for (let block = 0; block < 4; block++) {
            if (id !== run_id.current) return;
            setLines(current => [...current, { text: cipherLine(58), tone: 'cipher' }]);
            click();
            await sleep(140);
        }
        if (id !== run_id.current) return;

        const computed = analyse(strategy, prices, places);
        if (!computed) {
            await typeLine({ text: 'Error: not enough ticks to count.', tone: 'error' }, id);
            return;
        }

        await typeLine({ text: 'Analysis Complete!', tone: 'good' }, id);
        setResult(computed);

        for (let seconds = 5; seconds >= 0; seconds--) {
            if (id !== run_id.current) return;
            setCountdown(seconds);
            click();
            await sleep(1000);
        }
        if (id !== run_id.current) return;
        setCountdown(-1);
    }, [decimals, feed, isConnected, market_label, strategy, strategy_label, symbol, typeLine, click]);

    const open = () => {
        // Browsers only allow audio to start inside a gesture, so the context
        // is built on this click and reused for the rest of the session.
        if (!audio.current) {
            const Context =
                window.AudioContext ??
                (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (Context) audio.current = new Context();
        }
        audio.current?.resume().catch(() => {
            // Sound is a flourish; the terminal runs without it.
        });
        setIsOpen(true);
        run();
    };

    const close = () => {
        run_id.current += 1;
        setIsOpen(false);
        setCountdown(null);
    };

    useEffect(
        () => () => {
            run_id.current += 1;
            audio.current?.close().catch(() => {
                // Already closed by the browser.
            });
        },
        []
    );

    const last_digit = useMemo(() => (price === null ? null : getLastDigit(price, decimals)), [price, decimals]);

    return (
        <div className='mw-sa'>
            <section className='mw-sa__card'>
                <h1 className='mw-sa__title'>{localize('Signal Analyzer')}</h1>

                <label className='mw-sa__field'>
                    <span>{localize('Select Strategy')}</span>
                    <select value={strategy} onChange={event => setStrategy(event.target.value as TStrategyId)}>
                        {STRATEGIES.map(item => (
                            <option key={item.id} value={item.id}>
                                {item.label}
                            </option>
                        ))}
                    </select>
                </label>

                <label className='mw-sa__field'>
                    <span>{localize('Select Market')}</span>
                    <select value={symbol} onChange={event => setSymbol(event.target.value)}>
                        {MARKETS.map(item => (
                            <option key={item.symbol} value={item.symbol}>
                                {item.label}
                            </option>
                        ))}
                    </select>
                </label>

                <div className='mw-sa__live'>
                    <p>
                        {localize('Latest Tick:')} <b>{price === null ? '--' : price.toFixed(decimals)}</b>
                    </p>
                    <p>
                        {localize('Last Digit:')} <b>{last_digit === null ? '--' : last_digit}</b>
                    </p>
                </div>

                <button type='button' className='mw-sa__go' onClick={open}>
                    {localize('Analyse')}
                </button>

                <p className='mw-sa__note'>
                    {localize(
                        'Counts the last {{count}} ticks of the selected market. Frequencies describe what has happened, not what happens next, and nothing is bought from this page.',
                        { count: TICK_WINDOW }
                    )}
                </p>
            </section>

            {is_open && (
                <div className='mw-sa__overlay' role='dialog' aria-modal='true' aria-label={localize('Analysis')}>
                    <div className='mw-sa__terminal'>
                        <MatrixRain />

                        <header className='mw-sa__bar'>
                            <h2>{`Analysis Dashboard - ${strategy_label} on ${market_label}`}</h2>
                            <div className='mw-sa__bar-buttons'>
                                <button
                                    type='button'
                                    className='mw-sa__mute'
                                    aria-pressed={is_muted}
                                    onClick={() => setIsMuted(current => !current)}
                                >
                                    {is_muted ? localize('Sound off') : localize('Sound on')}
                                </button>
                                <button
                                    type='button'
                                    className='mw-sa__close'
                                    aria-label={localize('Close')}
                                    onClick={close}
                                >
                                    ✕
                                </button>
                            </div>
                        </header>

                        <div className='mw-sa__log' ref={log}>
                            {lines.map((line, index) => (
                                <p
                                    // Lines are appended and only the last one
                                    // changes, so the index is stable for the
                                    // life of the run.
                                    // eslint-disable-next-line react/no-array-index-key
                                    key={index}
                                    className={`mw-sa__line${line.tone ? ` mw-sa__line--${line.tone}` : ''}`}
                                >
                                    {line.text}
                                </p>
                            ))}

                            {result && (
                                <div className='mw-sa__result'>
                                    <p className='mw-sa__headline'>{result.headline}</p>
                                    {result.lines.map(line => (
                                        <p
                                            key={line.text}
                                            className={`mw-sa__line${line.tone ? ` mw-sa__line--${line.tone}` : ''}`}
                                        >
                                            {line.text}
                                        </p>
                                    ))}
                                </div>
                            )}

                            {countdown !== null && countdown >= 0 && (
                                <p className='mw-sa__line'>
                                    {countdown === 1
                                        ? localize('Running bot in 1 second...')
                                        : localize('Running bot in {{count}} seconds...', { count: countdown })}
                                </p>
                            )}
                            {countdown === -1 && (
                                <>
                                    <p className='mw-sa__activated'>{localize('Bot activated!')}</p>
                                    <p className='mw-sa__line mw-sa__line--dim'>
                                        {localize(
                                            'Signal only - no contract is placed from here. Take it to the Bot Builder or DTrader to trade it.'
                                        )}
                                    </p>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SignalAnalyzer;
