import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { useStore } from '@/hooks/useStore';
import { getLastDigit, toDecimalPlaces } from '@/utils/market-data/last-digit';
import { TActiveSymbol } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';
import useManualTrade from '../bulk-trader/use-manual-trade';
import './pro-ai.scss';

/**
 * The three market groups the scanner can watch. Volatility indices only - the
 * synthetic list also carries Boom, Crash, Jump, Step and Range Break, and
 * several of those quote to a precision that leaves the last digit barely
 * moving, which makes a digit pattern on them meaningless.
 */
const MARKET_GROUPS = [
    { id: 'standard', label: 'Volatility Indices only', test: /^R_\d+$/ },
    { id: 'one_second', label: 'Volatility Indices (1s) only', test: /^1HZ\d+V$/ },
    { id: 'all', label: 'All Volatilities', test: /^(R_\d+|1HZ\d+V)$/ },
] as const;

type TGroupId = (typeof MARKET_GROUPS)[number]['id'];

type TStrategy = {
    /** The digit the contract would be written against. */
    barrier: number;
    contract_type: 'DIGITOVER' | 'DIGITUNDER';
    /** How many consecutive digits the pattern waits for, by default. */
    digits: number;
    /** Which side of the barrier the run has to sit on. */
    direction: 'at_or_below' | 'at_or_above';
    id: string;
    name: string;
};

/**
 * Each strategy is one run-of-digits pattern. "Over 1 Pro" waits for three
 * digits at or below 1 and would enter Over 1; the Under strategies are its
 * mirror. Nothing here forecasts the next digit - the pattern is a description
 * of the ticks that have already printed, and that is all the scanner reports.
 */
const STRATEGIES: TStrategy[] = [
    { barrier: 1, contract_type: 'DIGITOVER', digits: 3, direction: 'at_or_below', id: 'over_1', name: 'Over 1 Pro' },
    {
        barrier: 8,
        contract_type: 'DIGITUNDER',
        digits: 3,
        direction: 'at_or_above',
        id: 'under_8',
        name: 'Under 8 Pro',
    },
    { barrier: 2, contract_type: 'DIGITOVER', digits: 4, direction: 'at_or_below', id: 'over_2', name: 'Over 2 Pro' },
    {
        barrier: 7,
        contract_type: 'DIGITUNDER',
        digits: 4,
        direction: 'at_or_above',
        id: 'under_7',
        name: 'Under 7 Pro',
    },
    { barrier: 3, contract_type: 'DIGITOVER', digits: 5, direction: 'at_or_below', id: 'over_3', name: 'Over 3 Pro' },
    {
        barrier: 6,
        contract_type: 'DIGITUNDER',
        digits: 5,
        direction: 'at_or_above',
        id: 'under_6',
        name: 'Under 6 Pro',
    },
];

/** Ticks seeded per market, so a pattern can be read the moment a scan starts. */
const SEED_TICKS = 100;

/** Digits kept per market. Only the tail is ever tested; the rest is the strip on screen. */
const WINDOW = 16;

/** Digits shown in the strip for each market. */
const STRIP = 10;

const MIN_DIGITS = 2;
const MAX_DIGITS = 8;

/** Gap between each market's first history request, so a dozen do not fire together. */
const STAGGER_MS = 200;

/** How long a market waits before asking for its history a second time. */
const RETRY_MS = 2000;

/**
 * Every entry is one tick. These strategies read a run that has just printed
 * and enter on the tick after it, so a longer contract would be settling on
 * ticks the pattern never described.
 */
const DURATION_TICKS = 1;

type TRow = {
    decimals: number;
    digits: number[];
    latest: number | null;
    name: string;
    symbol: string;
};

const BrainMark = () => (
    <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
        <g fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'>
            <path d='M12 5.2a2.6 2.6 0 0 0-4.6-1 2.4 2.4 0 0 0-2 3.1 2.5 2.5 0 0 0-.2 4.2 2.5 2.5 0 0 0 1.2 3.6 2.5 2.5 0 0 0 3.4 2.5A2.4 2.4 0 0 0 12 18.8Z' />
            <path d='M12 5.2a2.6 2.6 0 0 1 4.6-1 2.4 2.4 0 0 1 2 3.1 2.5 2.5 0 0 1 .2 4.2 2.5 2.5 0 0 1-1.2 3.6 2.5 2.5 0 0 1-3.4 2.5A2.4 2.4 0 0 1 12 18.8Z' />
            <path d='M12 5.2v13.6' />
        </g>
    </svg>
);

const PulseMark = () => (
    <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
        <path
            d='M3 12h3.2l2-5.4 3.4 10L14.9 12H21'
            fill='none'
            stroke='currentColor'
            strokeWidth='1.8'
            strokeLinecap='round'
            strokeLinejoin='round'
        />
    </svg>
);

const WaveMark = () => (
    <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
        <g fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round'>
            <circle cx='12' cy='12' r='2' fill='currentColor' stroke='none' />
            <path d='M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4' />
            <path d='M4.9 4.9a10 10 0 0 0 0 14.2M19.1 19.1a10 10 0 0 0 0-14.2' opacity='0.55' />
        </g>
    </svg>
);

/** True when the last `count` digits all sit on the strategy's side of the barrier. */
const isMatch = (digits: number[], count: number, strategy: TStrategy): boolean => {
    if (digits.length < count) return false;
    return digits
        .slice(-count)
        .every(digit => (strategy.direction === 'at_or_below' ? digit <= strategy.barrier : digit >= strategy.barrier));
};

/** True when one digit is on the wanted side - what colours a chip in the strip. */
const isInRange = (digit: number, strategy: TStrategy): boolean =>
    strategy.direction === 'at_or_below' ? digit <= strategy.barrier : digit >= strategy.barrier;

const describe = (strategy: TStrategy, count: number) =>
    strategy.direction === 'at_or_below'
        ? `Waits for ${count} digits at or below ${strategy.barrier}`
        : `Waits for ${count} digits at or above ${strategy.barrier}`;

const entryLabel = (strategy: TStrategy, count: number) =>
    `Entry: last ${count} digits ${strategy.direction === 'at_or_below' ? '≤' : '≥'} ${strategy.barrier}`;

/**
 * One strategy, opened. Every card opens this same screen - the strategy is
 * the only thing that differs, so the pattern, the entry chip and the barrier
 * all read off it rather than being written out six times.
 */
const ProAiBot = observer(({ onBack, strategy }: { onBack: () => void; strategy: TStrategy }) => {
    const { feed, isConnected } = usePublicMarketFeed();
    const { client, oauth_session } = useStore() ?? {};
    const { localize } = useTranslations();
    const trade = useManualTrade();

    const [symbols, setSymbols] = useState<TActiveSymbol[]>([]);
    const [stake, setStake] = useState(1);
    const [trades, setTrades] = useState(5);
    const [group_id, setGroupId] = useState<TGroupId>('standard');
    const [digit_count, setDigitCount] = useState(strategy.digits);

    const [scanning, setScanning] = useState(false);
    const [rows, setRows] = useState<Record<string, TRow>>({});
    const [matches, setMatches] = useState(0);
    const [errors, setErrors] = useState(0);

    // Off every time this screen opens. Arming is a decision about real money,
    // so it is never carried in from a previous visit or a previous strategy.
    const [armed, setArmed] = useState(false);
    const [sent, setSent] = useState(0);
    const [last_entry, setLastEntry] = useState<string | null>(null);

    // The tick handlers are registered once per scan and have to see the digits
    // as they are now, not as they were when the subscription was taken.
    const rows_ref = useRef<Record<string, TRow>>({});

    // Markets with an entry in flight. Without this, several ticks arriving in
    // the same instant on one market could each fire their own batch.
    const firing_ref = useRef<Set<string>>(new Set());

    // Read by the tick handlers, which are registered once per scan and would
    // otherwise hold whichever version of this function existed at that moment.
    const fire_ref = useRef<(symbol: string, name: string) => void>(() => {});

    // Same reason, and it is the one that matters: disarming has to take effect
    // on the very next tick, not when the scan happens to be rebuilt.
    const armed_ref = useRef(false);
    armed_ref.current = armed;

    const is_logged_in = Boolean(oauth_session?.is_authenticated || client?.is_logged_in);
    const currency = oauth_session?.currency || (is_logged_in && (client?.currency as string)) || 'USD';
    const risk = stake * trades;

    const group = MARKET_GROUPS.find(item => item.id === group_id) ?? MARKET_GROUPS[0];

    /**
     * Buys the strategy's contract on the market whose pattern just completed.
     *
     * Goes through the same placeTrades() the Manual and Bulk Trader pages use,
     * so an entry from here opens the trading connection the same way, lands in
     * the app's own Transactions and Journal, and is subject to the same account
     * checks. There is no second trading engine behind this page.
     *
     * A market that is already buying is skipped rather than queued: the point
     * of the batch is that every contract in it prices off the same moment, and
     * a second batch on the same market is a different moment.
     */
    const fire = useCallback(
        async (symbol: string, name: string) => {
            if (firing_ref.current.has(symbol)) return;
            firing_ref.current.add(symbol);
            try {
                const opened = await trade.placeTrades(
                    {
                        barrier: strategy.barrier,
                        contract_type: strategy.contract_type,
                        duration: DURATION_TICKS,
                        stake,
                        symbol,
                    },
                    trades
                );
                if (opened > 0) {
                    setSent(count => count + opened);
                    setLastEntry(`${name} - ${opened} x ${strategy.contract_type} ${strategy.barrier}`);
                }
            } finally {
                firing_ref.current.delete(symbol);
            }
        },
        [stake, strategy, trade, trades]
    );

    useEffect(() => {
        fire_ref.current = fire;
    });

    // Disarmed the moment the scan stops, so a stopped scanner can never be
    // left holding permission to trade.
    useEffect(() => {
        if (!scanning) setArmed(false);
    }, [scanning]);

    useEffect(() => {
        if (!isConnected) return;
        feed.getActiveSymbols()
            .then(list => setSymbols(list))
            .catch(() => {
                // Non-fatal: Start simply finds no markets to watch and says so.
            });
    }, [isConnected, feed]);

    const watched = useMemo(() => symbols.filter(item => group.test.test(item.underlying_symbol)), [symbols, group]);

    /**
     * The scan itself: seed each market from history, then keep it current from
     * the live stream. Both come off the feed the rest of the app already holds
     * open - no second socket, and no market data that was not measured.
     *
     * Settings are locked while this runs, so a window can never be judged
     * against a rule that changed underneath it.
     */
    useEffect(() => {
        if (!scanning || !isConnected) return undefined;

        let cancelled = false;
        const timers: ReturnType<typeof setTimeout>[] = [];
        const unsubscribes: (() => void)[] = [];

        const write = (symbol: string, row: TRow) => {
            rows_ref.current = { ...rows_ref.current, [symbol]: row };
            setRows(rows_ref.current);
        };

        /**
         * Fills a market's window from history. Retried once, because restarting
         * a scan sends a fresh history request for every market within a couple
         * of seconds of the last batch, and the feed throttles that - a scan
         * that lost its seed to a momentary limit would otherwise take a minute
         * of live ticks to become readable again.
         */
        const seed = (symbol: string, name: string, attempt = 0) => {
            feed.getTickHistory(symbol, SEED_TICKS)
                .then(({ pip_size, prices }) => {
                    if (cancelled) return;
                    const decimals = toDecimalPlaces(pip_size) ?? 2;
                    const digits = prices.map(price => getLastDigit(price, decimals)).slice(-WINDOW);
                    write(symbol, {
                        decimals,
                        digits,
                        latest: prices[prices.length - 1] ?? null,
                        name,
                        symbol,
                    });
                })
                .catch(() => {
                    if (cancelled) return;
                    if (attempt === 0) {
                        timers.push(setTimeout(() => !cancelled && seed(symbol, name, 1), RETRY_MS));
                        return;
                    }
                    setErrors(count => count + 1);
                });
        };

        watched.forEach((item, index) => {
            const symbol = item.underlying_symbol;
            const name = item.underlying_symbol_name;

            timers.push(
                setTimeout(() => {
                    if (cancelled) return;

                    seed(symbol, name);

                    unsubscribes.push(
                        feed.subscribeTicks(symbol, tick => {
                            if (cancelled) return;
                            const decimals = toDecimalPlaces(tick.pip_size) ?? 2;
                            const previous = rows_ref.current[symbol];
                            const digits = [...(previous?.digits ?? []), getLastDigit(tick.quote, decimals)].slice(
                                -WINDOW
                            );

                            // Counted on the tick that completes the run, not on
                            // every tick that leaves it standing - otherwise one
                            // pattern would score again on each tick that held.
                            const was_matching = previous ? isMatch(previous.digits, digit_count, strategy) : false;
                            if (!was_matching && isMatch(digits, digit_count, strategy)) {
                                setMatches(count => count + 1);
                                // A run has to break and re-form before this
                                // fires again, because the count is on the
                                // transition - so one pattern is one entry.
                                if (armed_ref.current) fire_ref.current(symbol, name);
                            }

                            write(symbol, { decimals, digits, latest: tick.quote, name, symbol });
                        })
                    );
                }, index * STAGGER_MS)
            );
        });

        return () => {
            cancelled = true;
            timers.forEach(timer => clearTimeout(timer));
            unsubscribes.forEach(stop => stop());
        };
    }, [scanning, isConnected, feed, watched, digit_count, strategy]);

    const start = () => {
        rows_ref.current = {};
        setRows({});
        setMatches(0);
        setErrors(0);
        setSent(0);
        setLastEntry(null);
        setScanning(true);
    };

    const stop = () => setScanning(false);

    // Matching markets first, then alphabetically, so a completed pattern is at
    // the top of the feed rather than wherever the market list happened to put it.
    const feed_rows = useMemo(() => {
        const list = Object.values(rows);
        return list.sort((a, b) => {
            const a_match = isMatch(a.digits, digit_count, strategy) ? 0 : 1;
            const b_match = isMatch(b.digits, digit_count, strategy) ? 0 : 1;
            return a_match - b_match || a.name.localeCompare(b.name);
        });
    }, [rows, digit_count, strategy]);

    const live_count = feed_rows.length;

    return (
        <div className='mw-proai mw-proai--bot'>
            <header className='mw-proai__bot-head'>
                <button type='button' className='mw-proai__back' onClick={onBack}>
                    <span aria-hidden='true'>&larr;</span> {localize('Back')}
                </button>
                <div className='mw-proai__bot-title'>
                    <span>{localize('Pro AI bot')}</span>
                    <h1>{strategy.name}</h1>
                </div>
            </header>

            <div className='mw-proai__bot-body'>
                <aside className='mw-proai__panel'>
                    <div className='mw-proai__grid2'>
                        <label className='mw-proai__field'>
                            <span>{localize('Stake')}</span>
                            <input
                                type='number'
                                min={0.35}
                                step={0.01}
                                value={stake}
                                disabled={scanning}
                                onChange={event => setStake(Math.max(0.35, Number(event.target.value) || 0.35))}
                            />
                        </label>
                        <label className='mw-proai__field'>
                            <span>{localize('No. of trades')}</span>
                            <input
                                type='number'
                                min={1}
                                value={trades}
                                disabled={scanning}
                                onChange={event => setTrades(Math.max(1, Number(event.target.value) || 1))}
                            />
                        </label>
                        <label className='mw-proai__field'>
                            <span>{localize('Markets')}</span>
                            <select
                                value={group_id}
                                disabled={scanning}
                                onChange={event => setGroupId(event.target.value as TGroupId)}
                            >
                                {MARKET_GROUPS.map(item => (
                                    <option key={item.id} value={item.id}>
                                        {localize(item.label)}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className='mw-proai__field'>
                            <span>{localize('Digits to check')}</span>
                            <input
                                type='number'
                                min={MIN_DIGITS}
                                max={MAX_DIGITS}
                                value={digit_count}
                                disabled={scanning}
                                onChange={event =>
                                    setDigitCount(
                                        Math.min(
                                            MAX_DIGITS,
                                            Math.max(MIN_DIGITS, Number(event.target.value) || MIN_DIGITS)
                                        )
                                    )
                                }
                            />
                        </label>
                    </div>

                    <div className={`mw-proai__status${scanning ? ' mw-proai__status--on' : ''}`}>
                        <span className='mw-proai__status-mark'>
                            <PulseMark />
                        </span>
                        <div>
                            <b>{scanning ? localize('Scanner running') : localize('Scanner stopped')}</b>
                            <p>
                                {scanning
                                    ? localize('Watching {{count}} markets for the pattern.', {
                                          count: watched.length,
                                      })
                                    : localize('Choose your settings, then start scanning.')}
                            </p>
                        </div>
                    </div>

                    <div className='mw-proai__counters'>
                        <div>
                            <span>{localize('Feeds')}</span>
                            <b>{live_count}</b>
                        </div>
                        <div>
                            <span>{localize('Matches')}</span>
                            <b>{matches}</b>
                        </div>
                        <div>
                            <span>{localize('Trades sent')}</span>
                            <b>{sent}</b>
                        </div>
                        <div>
                            <span>{localize('Errors')}</span>
                            <b>{errors}</b>
                        </div>
                    </div>

                    {/* Arming is the one control that stays live while the scan
                        runs. Every other setting locks, but a trader has to be
                        able to take permission away on the tick they decide to,
                        not at the next restart. */}
                    <label className={`mw-proai__arm${armed ? ' mw-proai__arm--on' : ''}`}>
                        <span>
                            <b>{localize('Send trades on match')}</b>
                            <i>
                                {is_logged_in
                                    ? localize('{{count}} x {{stake}} {{currency}} per entry, one tick each.', {
                                          count: trades,
                                          currency,
                                          stake: stake.toFixed(2),
                                      })
                                    : localize('Log in to a Deriv account to arm this.')}
                            </i>
                        </span>
                        <input
                            type='checkbox'
                            checked={armed}
                            disabled={!is_logged_in || !scanning}
                            onChange={event => setArmed(event.target.checked)}
                        />
                    </label>

                    {/* Said plainly rather than left to be discovered. */}
                    <p className='mw-proai__note'>
                        {armed
                            ? localize(
                                  'Armed. Every completed pattern buys {{risk}} {{currency}} on the market that matched, without asking again. Nothing here predicts the next digit.',
                                  { currency, risk: risk.toFixed(2) }
                              )
                            : localize(
                                  'Not armed: the scanner reports patterns and buys nothing. Start the scan, then arm it to send entries.'
                              )}
                    </p>

                    {last_entry && <p className='mw-proai__entry-log'>{last_entry}</p>}
                    {trade.error_message && <p className='mw-proai__error'>{trade.error_message}</p>}

                    <button
                        type='button'
                        className={`mw-proai__run${scanning ? ' mw-proai__run--stop' : ''}`}
                        onClick={scanning ? stop : start}
                        disabled={!isConnected || (!scanning && watched.length === 0)}
                    >
                        {scanning ? localize('Stop scanning') : localize('Start scanning')}
                    </button>
                </aside>

                <section className='mw-proai__feed'>
                    <header className='mw-proai__feed-head'>
                        <div>
                            <span className='mw-proai__eyebrow'>
                                <WaveMark /> {localize('Live pattern feed')}
                            </span>
                            <h2>{localize('Scanned markets')}</h2>
                        </div>
                        <span className='mw-proai__entry'>{entryLabel(strategy, digit_count)}</span>
                    </header>

                    {feed_rows.length === 0 ? (
                        <div className='mw-proai__empty'>
                            <span className='mw-proai__empty-mark'>
                                <WaveMark />
                            </span>
                            <b>{localize('No live scan data')}</b>
                            <p>
                                {localize(
                                    'Start the scanner to stream digit patterns from the selected volatility markets.'
                                )}
                            </p>
                        </div>
                    ) : (
                        <ul className='mw-proai__rows'>
                            {feed_rows.map(row => {
                                const hit = isMatch(row.digits, digit_count, strategy);
                                return (
                                    <li key={row.symbol} className={`mw-proai__row${hit ? ' mw-proai__row--hit' : ''}`}>
                                        <div className='mw-proai__row-head'>
                                            <b>{row.name}</b>
                                            {hit && <em>{localize('Pattern complete')}</em>}
                                        </div>
                                        <div className='mw-proai__strip'>
                                            {row.digits.slice(-STRIP).map((digit, index) => (
                                                <span
                                                    key={`${row.symbol}-${index}`}
                                                    className={
                                                        isInRange(digit, strategy)
                                                            ? 'mw-proai__digit mw-proai__digit--in'
                                                            : 'mw-proai__digit'
                                                    }
                                                >
                                                    {digit}
                                                </span>
                                            ))}
                                        </div>
                                        <span className='mw-proai__row-tick'>
                                            {row.latest === null ? '--' : row.latest.toFixed(row.decimals)}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>
            </div>
        </div>
    );
});

const ProAi = observer(() => {
    const { localize } = useTranslations();
    const [open_id, setOpenId] = useState<string | null>(null);

    const open = STRATEGIES.find(item => item.id === open_id) ?? null;
    if (open) return <ProAiBot strategy={open} onBack={() => setOpenId(null)} />;

    return (
        <div className='mw-proai'>
            <header className='mw-proai__head'>
                <span className='mw-proai__eyebrow'>{localize('Automated digit entries')}</span>
                <h1>{localize('Pro AI')}</h1>
                <p>
                    {localize(
                        'Select a strategy, configure the scan, and let it watch every matching volatility market.'
                    )}
                </p>
            </header>

            <div className='mw-proai__cards'>
                {STRATEGIES.map(strategy => (
                    <button
                        key={strategy.id}
                        type='button'
                        className='mw-proai__card'
                        onClick={() => setOpenId(strategy.id)}
                    >
                        <span className='mw-proai__card-mark'>
                            <BrainMark />
                        </span>
                        <span className='mw-proai__card-text'>
                            <b>{strategy.name}</b>
                            <i>{describe(strategy, strategy.digits)}</i>
                        </span>
                        <span className='mw-proai__card-open'>{localize('Open')}</span>
                    </button>
                ))}
            </div>
        </div>
    );
});

export default ProAi;
