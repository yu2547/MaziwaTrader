import { useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { getLastDigit, toDecimalPlaces } from '@/utils/market-data/last-digit';
import { TActiveSymbol } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';
import './dp-tools.scss';

/**
 * DP Tools: four readings of the same live tick sample - even/odd, over/under
 * a barrier, match/differ a digit, and rise/fall between consecutive ticks.
 *
 * Every figure is counted from real ticks on the selected market: the sample
 * is seeded from tick history and kept current from the live stream, the same
 * way Dcircles does it. With no ticks yet the page says so rather than showing
 * 0%, because 0% is a measurement and there has not been one.
 *
 * Ticks are kept with their epoch so the history seed and the live stream can
 * be joined without counting the tick at the seam twice.
 */

type TMode = 'even_odd' | 'over_under' | 'match_differ' | 'rise_fall';
type TTickPoint = { quote: number; epoch: number };
type TTone = 'green' | 'pink' | 'grey';

const DEFAULT_SYMBOL = 'R_10';
/** Volatility indices only - the markets whose last digit is a reading of the market, not of its tick format. */
const VOLATILITY_SYMBOL = /^(R_\d+|1HZ\d+V)$/;
const DEFAULT_COUNT = 1000;
const MIN_COUNT = 50;
const MAX_COUNT = 5000;
const RECENT_DIGITS = 20;
const RECENT_MOVES = 60;
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const MODES: Array<{ id: TMode; label: string; title: string; subtitle: string }> = [
    { id: 'even_odd', label: 'Even/odd', title: 'Analysis', subtitle: 'Trading Pattern Recognition' },
    { id: 'over_under', label: 'Over/under', title: 'Over / Under', subtitle: 'Digit Barrier Analysis' },
    { id: 'match_differ', label: 'Match/differ', title: 'Match / Differ', subtitle: 'Digit Match Analysis' },
    { id: 'rise_fall', label: 'Rise/fall', title: 'Analysis', subtitle: 'Rise Pattern Analysis' },
];

const formatPct = (value: number, has_data: boolean) => (has_data ? `${value.toFixed(2)}%` : '—');

/** Bars on a fixed 0-100 axis, so two readings on different pages compare by eye. */
const PercentChart = ({
    bars,
    has_data,
}: {
    bars: Array<{ label: string; value: number; tone: TTone }>;
    has_data: boolean;
}) => (
    <div
        className='mw-dp__chart'
        role='img'
        aria-label={bars.map(bar => `${bar.label} ${formatPct(bar.value, has_data)}`).join(', ')}
    >
        <div className='mw-dp__axis' aria-hidden='true'>
            {[100, 80, 60, 40, 20, 0].map(tick => (
                <span key={tick}>{tick}</span>
            ))}
        </div>
        <div className='mw-dp__plot'>
            {bars.map(bar => {
                const height = has_data ? Math.min(100, bar.value) : 0;
                return (
                    <div className='mw-dp__col' key={bar.label}>
                        <div className='mw-dp__track'>
                            <span
                                className={`mw-dp__bar-value mw-dp__bar-value--${bar.tone}`}
                                style={{ bottom: `calc(${height}% + 4px)` }}
                            >
                                {formatPct(bar.value, has_data)}
                            </span>
                            <div className={`mw-dp__bar mw-dp__bar--${bar.tone}`} style={{ height: `${height}%` }} />
                        </div>
                        <span className='mw-dp__col-label'>{bar.label}</span>
                    </div>
                );
            })}
        </div>
    </div>
);

/** Raw counts per digit, scaled to the busiest digit rather than to 100%. */
const CountChart = ({ counts, highlight }: { counts: number[]; highlight: (digit: number) => TTone }) => {
    const peak = Math.max(1, ...counts);
    return (
        <div
            className='mw-dp__freq'
            role='img'
            aria-label={counts.map((count, digit) => `${digit}: ${count}`).join(', ')}
        >
            {DIGITS.map(digit => (
                <div className='mw-dp__freq-col' key={digit}>
                    <span className='mw-dp__freq-count'>{counts[digit]}</span>
                    <div className='mw-dp__freq-track'>
                        <div
                            className={`mw-dp__bar mw-dp__bar--${highlight(digit)}`}
                            style={{ height: `${(counts[digit] / peak) * 100}%` }}
                        />
                    </div>
                    <span className='mw-dp__col-label'>{digit}</span>
                </div>
            ))}
        </div>
    );
};

const DpTools = observer(() => {
    const { feed, isConnected } = usePublicMarketFeed();
    const { localize } = useTranslations();

    const [mode, setMode] = useState<TMode>('even_odd');
    const [is_menu_open, setIsMenuOpen] = useState(false);
    const [symbols, setSymbols] = useState<TActiveSymbol[]>([]);
    const [selected_symbol, setSelectedSymbol] = useState(DEFAULT_SYMBOL);
    const [count_input, setCountInput] = useState(String(DEFAULT_COUNT));
    const [barrier, setBarrier] = useState(2);
    const [target, setTarget] = useState(5);
    const [ticks, setTicks] = useState<TTickPoint[]>([]); // newest first
    const [live_decimals, setLiveDecimals] = useState<number | null>(null);

    useEffect(() => {
        if (!isConnected) return;
        feed.getActiveSymbols()
            .then(list => setSymbols(list.filter(item => VOLATILITY_SYMBOL.test(item.underlying_symbol))))
            .catch(() => {
                // Non-fatal: the selector stays on the default market.
            });
    }, [isConnected, feed]);

    // History is always fetched at the maximum window, so changing Number of
    // Digits re-slices what is already here instead of refetching it.
    const request_id = useRef(0);
    useEffect(() => {
        if (!isConnected) return undefined;
        const id = ++request_id.current;
        setTicks([]);
        setLiveDecimals(null);

        feed.getTickHistory(selected_symbol, MAX_COUNT)
            .then(({ prices, times, pip_size }) => {
                if (id !== request_id.current) return; // a later market won the race
                setLiveDecimals(previous => previous ?? toDecimalPlaces(pip_size) ?? 2);
                const history = prices.map((quote, index) => ({ quote, epoch: times[index] ?? 0 })).reverse();
                const newest_in_history = history[0]?.epoch ?? 0;
                // Live ticks that beat the history reply are kept, but only the
                // ones newer than it - the rest are already in the history.
                setTicks(previous =>
                    [...previous.filter(tick => tick.epoch > newest_in_history), ...history].slice(0, MAX_COUNT)
                );
            })
            .catch(() => {
                // Non-fatal: the live stream still fills the sample.
            });

        const unsubscribe = feed.subscribeTicks(selected_symbol, tick => {
            if (id !== request_id.current) return;
            setLiveDecimals(toDecimalPlaces(tick.pip_size) ?? 2);
            setTicks(previous =>
                previous.length && previous[0].epoch >= tick.epoch
                    ? previous
                    : [{ quote: tick.quote, epoch: tick.epoch }, ...previous].slice(0, MAX_COUNT)
            );
        });

        return () => unsubscribe();
    }, [isConnected, feed, selected_symbol]);

    const market_options = symbols;
    const symbol_info = symbols.find(item => item.underlying_symbol === selected_symbol);
    const places = live_decimals ?? toDecimalPlaces(symbol_info?.pip_size) ?? 2;

    const parsed_count = Number.parseInt(count_input, 10);
    const tick_count = Number.isFinite(parsed_count)
        ? Math.min(MAX_COUNT, Math.max(MIN_COUNT, parsed_count))
        : DEFAULT_COUNT;

    const sample = useMemo(() => ticks.slice(0, tick_count), [ticks, tick_count]);
    const digits = useMemo(() => sample.map(tick => getLastDigit(tick.quote, places)), [sample, places]);
    const counts = useMemo(() => {
        const result = new Array(10).fill(0);
        digits.forEach(digit => {
            result[digit] += 1;
        });
        return result;
    }, [digits]);

    // A move needs two ticks, so a sample of N ticks gives N-1 of them. Equal
    // consecutive quotes are neither a rise nor a fall and are left out of
    // both percentages.
    const moves = useMemo(() => {
        const result: Array<'R' | 'F'> = [];
        for (let index = 0; index < sample.length - 1; index++) {
            const newer = sample[index].quote;
            const older = sample[index + 1].quote;
            if (newer > older) result.push('R');
            else if (newer < older) result.push('F');
        }
        return result;
    }, [sample]);

    const total = digits.length;
    const has_data = total > 0;
    const share = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);

    const even = digits.filter(digit => digit % 2 === 0).length;
    const over = digits.filter(digit => digit > barrier).length;
    const under = digits.filter(digit => digit < barrier).length;
    const equal = total - over - under;
    const match = counts[target] ?? 0;
    const rises = moves.filter(move => move === 'R').length;
    const move_total = moves.length;
    const has_moves = move_total > 0;

    const recent_digits = digits.slice(0, RECENT_DIGITS).reverse(); // oldest to newest, left to right
    const recent_moves = moves.slice(0, RECENT_MOVES).reverse();
    const latest_price = sample[0] ? sample[0].quote.toFixed(places) : null;
    const meta = MODES.find(item => item.id === mode) ?? MODES[0];

    const digitTone = (digit: number): TTone => {
        if (mode === 'over_under') return digit > barrier ? 'green' : digit < barrier ? 'pink' : 'grey';
        if (mode === 'match_differ') return digit === target ? 'green' : 'pink';
        return digit % 2 === 0 ? 'green' : 'pink';
    };

    const pills = (() => {
        switch (mode) {
            case 'over_under':
                return [
                    {
                        key: 'a',
                        text: localize('Over {{digit}}: {{value}}', {
                            digit: barrier,
                            value: formatPct(share(over, total), has_data),
                        }),
                    },
                    {
                        key: 'b',
                        text: localize('Under {{digit}}: {{value}}', {
                            digit: barrier,
                            value: formatPct(share(under, total), has_data),
                        }),
                    },
                ];
            case 'match_differ':
                return [
                    {
                        key: 'a',
                        text: localize('Match {{digit}}: {{value}}', {
                            digit: target,
                            value: formatPct(share(match, total), has_data),
                        }),
                    },
                    {
                        key: 'b',
                        text: localize('Differ {{digit}}: {{value}}', {
                            digit: target,
                            value: formatPct(share(total - match, total), has_data),
                        }),
                    },
                ];
            // No rise/fall case: that mode shows its split in the results, not here.
            default:
                return [
                    { key: 'a', text: localize('Even: {{value}}', { value: formatPct(share(even, total), has_data) }) },
                    {
                        key: 'b',
                        text: localize('Odd: {{value}}', { value: formatPct(share(total - even, total), has_data) }),
                    },
                ];
        }
    })();

    const chart = (() => {
        switch (mode) {
            case 'over_under':
                return {
                    title: localize('Over / Under Distribution'),
                    has_data,
                    bars: [
                        { label: localize('Over'), value: share(over, total), tone: 'green' as TTone },
                        { label: localize('Under'), value: share(under, total), tone: 'pink' as TTone },
                        { label: localize('Equal'), value: share(equal, total), tone: 'grey' as TTone },
                    ],
                };
            case 'match_differ':
                return {
                    title: localize('Match / Differ Distribution'),
                    has_data,
                    bars: [
                        { label: localize('Match'), value: share(match, total), tone: 'green' as TTone },
                        { label: localize('Differ'), value: share(total - match, total), tone: 'pink' as TTone },
                    ],
                };
            case 'rise_fall':
                return {
                    title: localize('Rise Pattern Distribution'),
                    has_data: has_moves,
                    bars: [
                        { label: localize('Rise'), value: share(rises, move_total), tone: 'green' as TTone },
                        {
                            label: localize('Fall'),
                            value: share(move_total - rises, move_total),
                            tone: 'pink' as TTone,
                        },
                    ],
                };
            default:
                return {
                    title: localize('Digit Distribution'),
                    has_data,
                    bars: [
                        { label: localize('Even'), value: share(even, total), tone: 'green' as TTone },
                        { label: localize('Odd'), value: share(total - even, total), tone: 'pink' as TTone },
                    ],
                };
        }
    })();

    const market_name = symbol_info?.underlying_symbol_name ?? selected_symbol;

    return (
        <div className='mw-dp'>
            <aside
                className={`mw-dp__menu${is_menu_open ? ' mw-dp__menu--open' : ''}`}
                aria-label={localize('Analyses')}
            >
                <div className='mw-dp__menu-head'>
                    <span className='mw-dp__menu-title'>{localize('Analysis Tool')}</span>
                    <button
                        type='button'
                        className='mw-dp__menu-close'
                        onClick={() => setIsMenuOpen(false)}
                        aria-label={localize('Close')}
                    >
                        ✕
                    </button>
                </div>
                {MODES.map(item => (
                    <button
                        key={item.id}
                        type='button'
                        className={`mw-dp__menu-item${mode === item.id ? ' mw-dp__menu-item--active' : ''}`}
                        aria-current={mode === item.id}
                        onClick={() => {
                            setMode(item.id);
                            setIsMenuOpen(false);
                        }}
                    >
                        {localize(item.label)}
                    </button>
                ))}
            </aside>

            <section className='mw-dp__config'>
                <button
                    type='button'
                    className='mw-dp__burger'
                    onClick={() => setIsMenuOpen(true)}
                    aria-label={localize('Choose analysis')}
                    aria-expanded={is_menu_open}
                >
                    <span />
                    <span />
                    <span />
                </button>
                <h2 className='mw-dp__title'>{localize(meta.title)}</h2>
                <p className='mw-dp__subtitle'>{localize(meta.subtitle)}</p>
                <span className='mw-dp__rule' aria-hidden='true' />

                <label className='mw-dp__field'>
                    <span className='mw-dp__label'>{localize('Volatility Index')}</span>
                    <select value={selected_symbol} onChange={event => setSelectedSymbol(event.target.value)}>
                        {market_options.length ? (
                            market_options.map(item => (
                                <option key={item.underlying_symbol} value={item.underlying_symbol}>
                                    {item.underlying_symbol_name}
                                </option>
                            ))
                        ) : (
                            <option value={selected_symbol}>{selected_symbol}</option>
                        )}
                    </select>
                </label>

                <label className='mw-dp__field'>
                    <span className='mw-dp__label'>{localize('Number of Digits')}</span>
                    <input
                        type='number'
                        min={MIN_COUNT}
                        max={MAX_COUNT}
                        value={count_input}
                        onChange={event => setCountInput(event.target.value)}
                        onBlur={() => setCountInput(String(tick_count))}
                    />
                </label>

                {mode === 'over_under' && (
                    <label className='mw-dp__field'>
                        <span className='mw-dp__label'>{localize('Barrier Digit')}</span>
                        <select value={barrier} onChange={event => setBarrier(Number(event.target.value))}>
                            {DIGITS.map(digit => (
                                <option key={digit} value={digit}>
                                    {digit}
                                </option>
                            ))}
                        </select>
                    </label>
                )}

                {mode === 'match_differ' && (
                    <label className='mw-dp__field'>
                        <span className='mw-dp__label'>{localize('Match Digit')}</span>
                        <select value={target} onChange={event => setTarget(Number(event.target.value))}>
                            {DIGITS.map(digit => (
                                <option key={digit} value={digit}>
                                    {digit}
                                </option>
                            ))}
                        </select>
                    </label>
                )}

                {mode === 'rise_fall' ? (
                    <div className='mw-dp__sequence'>
                        <h3 className='mw-dp__sequence-title'>{localize('Last Digits Sequence')}</h3>
                        <p className='mw-dp__sequence-body'>
                            {localize('Last Prices:')}{' '}
                            {recent_moves.length ? recent_moves.join(', ') : localize('Collecting ticks...')}
                        </p>
                    </div>
                ) : null}

                {/* Rise/fall carries its split in the results instead, as the
                    reference does - its settings column ends on the sequence. */}
                {mode !== 'rise_fall' && (
                    <div className={`mw-dp__pills mw-dp__pills--${mode}`}>
                        {pills.map((pill, index) => (
                            <div key={pill.key} className={`mw-dp__pill mw-dp__pill--${index === 0 ? 'a' : 'b'}`}>
                                {pill.text}
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <section className='mw-dp__results'>
                <div className='mw-dp__card mw-dp__card--price'>
                    <p className='mw-dp__eyebrow'>{localize('Current Price')}</p>
                    <p className='mw-dp__price'>
                        {localize('Latest Price:')} {latest_price ?? '—'}
                    </p>
                </div>

                {mode !== 'rise_fall' && (
                    <div className='mw-dp__card'>
                        <h3 className='mw-dp__card-title'>
                            {mode === 'even_odd' ? localize('Digits') : localize('Last Digits')}
                        </h3>
                        <div className='mw-dp__digits'>
                            {recent_digits.length ? (
                                recent_digits.map((digit, index) => (
                                    <span key={index} className={`mw-dp__digit mw-dp__digit--${digitTone(digit)}`}>
                                        {mode === 'even_odd' ? (digit % 2 === 0 ? 'E' : 'O') : digit}
                                    </span>
                                ))
                            ) : (
                                <span className='mw-dp__muted'>{localize('Collecting ticks...')}</span>
                            )}
                        </div>
                    </div>
                )}

                <div className='mw-dp__card'>
                    <h3 className='mw-dp__card-title'>{chart.title}</h3>
                    <PercentChart bars={chart.bars} has_data={chart.has_data} />
                </div>

                {(mode === 'over_under' || mode === 'match_differ') && (
                    <div className='mw-dp__card'>
                        <h3 className='mw-dp__card-title'>{localize('Digit Frequency (0-9)')}</h3>
                        <CountChart counts={counts} highlight={digitTone} />
                    </div>
                )}

                {mode === 'rise_fall' && (
                    <div className='mw-dp__card mw-dp__card--summary'>
                        {localize('R Percentage: {{rise}} | F Percentage: {{fall}}', {
                            rise: formatPct(share(rises, move_total), has_moves),
                            fall: formatPct(share(move_total - rises, move_total), has_moves),
                        })}
                    </div>
                )}

                <p className='mw-dp__note'>
                    {localize('Counted from the last {{count}} ticks on {{market}}.', {
                        count: has_data ? total : tick_count,
                        market: market_name,
                    })}
                </p>
            </section>
        </div>
    );
});

export default DpTools;
