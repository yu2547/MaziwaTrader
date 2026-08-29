import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import { DBOT_TABS } from '@/constants/bot-contents';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { useStore } from '@/hooks/useStore';
import { getDigitDistribution, getLastDigit, toDecimalPlaces } from '@/utils/market-data/last-digit';
import { TActiveSymbol, TTick } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';

const DEFAULT_SYMBOL = '1HZ100V';
const DEFAULT_TICK_WINDOW = 1000;
const MIN_TICK_WINDOW = 50;
const MAX_TICK_WINDOW = 5000;
const RECENT_COLLAPSED = 10;
const RECENT_EXPANDED = 50;

/** Digit circle colours, by the digit's standing in the live sample. */
type TStanding = 'highest' | 'second_highest' | 'lowest' | 'second_lowest' | 'none';

const DigitCircle = ({
    digit,
    percentage,
    standing,
    is_current,
}: {
    digit: number;
    percentage: number;
    standing: TStanding;
    is_current: boolean;
}) => (
    <div className='mw-dcircles__cell'>
        <span className={`mw-dcircles__marker ${is_current ? 'mw-dcircles__marker--on' : ''}`}>▼</span>
        <div
            className={`mw-dcircles__circle mw-dcircles__circle--${standing} ${
                is_current ? 'mw-dcircles__circle--current' : ''
            }`}
        >
            <span className='mw-dcircles__circle-digit'>{digit}</span>
            <span className='mw-dcircles__circle-pct'>{percentage.toFixed(1)}%</span>
        </div>
    </div>
);

const Bar = ({
    label,
    count,
    percentage,
    tone,
}: {
    label: string;
    count: number;
    percentage: number;
    tone: 'good' | 'bad' | 'flat';
}) => (
    <div className='mw-dcircles__panel'>
        <div className='mw-dcircles__panel-label'>{label}</div>
        <div className='mw-dcircles__panel-value'>
            {count} <span>({percentage.toFixed(1)}%)</span>
        </div>
        <div className='mw-dcircles__panel-track'>
            <div
                className={`mw-dcircles__panel-fill mw-dcircles__panel-fill--${tone}`}
                style={{ width: `${Math.min(percentage, 100)}%` }}
            />
        </div>
    </div>
);

const RecentStrip = ({
    title,
    items,
    expanded,
    onToggle,
}: {
    title: string;
    items: { key: string; text: string; tone: 'good' | 'bad' | 'flat' }[];
    expanded: boolean;
    onToggle: () => void;
}) => {
    const { localize } = useTranslations();
    return (
        <div className='mw-dcircles__recent'>
            <div className='mw-dcircles__recent-head'>
                <span>{title}</span>
                <button type='button' onClick={onToggle}>
                    {expanded ? localize('Less') : localize('More')}
                </button>
            </div>
            <div className='mw-dcircles__recent-strip'>
                {items.map(item => (
                    <span key={item.key} className={`mw-dcircles__chip mw-dcircles__chip--${item.tone}`}>
                        {item.text}
                    </span>
                ))}
            </div>
        </div>
    );
};

const Dcircles = observer(() => {
    const { feed, isConnected } = usePublicMarketFeed();
    const { dashboard, quick_strategy } = useStore() ?? {};
    const { localize } = useTranslations();
    const navigate = useNavigate();

    const [symbols, setSymbols] = useState<TActiveSymbol[]>([]);
    const [selected_symbol, setSelectedSymbol] = useState(DEFAULT_SYMBOL);
    const [tick_window, setTickWindow] = useState(DEFAULT_TICK_WINDOW);
    const [barrier, setBarrier] = useState(5);
    const [digits, setDigits] = useState<number[]>([]);
    const [last_tick, setLastTick] = useState<TTick | null>(null);
    const [history_decimals, setHistoryDecimals] = useState<number | null>(null);
    const [is_ai_open, setIsAiOpen] = useState(false);
    const [is_info_open, setIsInfoOpen] = useState(false);
    const [expanded, setExpanded] = useState({ eo: false, ou: false, md: false });

    // Every market Deriv offers, not a curated subset - the reference lists
    // the 1s indices alongside the standard ones.
    useEffect(() => {
        if (!isConnected) return;
        feed.getActiveSymbols()
            .then(list => {
                const synthetics = list.filter(item => item.market === 'synthetic_index');
                setSymbols(synthetics.length ? synthetics : list);
            })
            .catch(() => {
                // Non-fatal: the selector stays on the default symbol.
            });
    }, [isConnected, feed]);

    const selected_symbol_info = symbols.find(item => item.underlying_symbol === selected_symbol);
    const decimals =
        toDecimalPlaces(last_tick?.pip_size) ??
        history_decimals ??
        toDecimalPlaces(selected_symbol_info?.pip_size) ??
        2;

    // Seed the sample from history, then keep it current from the live
    // stream. Without the seed the distribution would climb from 0/1000 over
    // sixteen minutes before it meant anything.
    const request_id = useRef(0);
    useEffect(() => {
        if (!isConnected) return undefined;
        const id = ++request_id.current;
        setDigits([]);
        setLastTick(null);
        setHistoryDecimals(null);

        feed.getTickHistory(selected_symbol, MAX_TICK_WINDOW)
            .then(({ prices, pip_size }) => {
                if (id !== request_id.current) return; // a later market won the race
                const places = toDecimalPlaces(pip_size) ?? 2;
                setHistoryDecimals(places);
                // History arrives oldest-first; this list is newest-first.
                setDigits(prices.map(price => getLastDigit(price, places)).reverse());
            })
            .catch(() => {
                // Non-fatal: the live stream still fills the sample.
            });

        const unsubscribe = feed.subscribeTicks(selected_symbol, tick => {
            if (id !== request_id.current) return;
            setLastTick(tick);
            const places = toDecimalPlaces(tick.pip_size) ?? 2;
            setDigits(prev => [getLastDigit(tick.quote, places), ...prev].slice(0, MAX_TICK_WINDOW));
        });

        return () => unsubscribe();
    }, [isConnected, feed, selected_symbol]);

    const sample = useMemo(() => digits.slice(0, tick_window), [digits, tick_window]);
    const distribution = useMemo(() => getDigitDistribution(sample), [sample]);
    const current_digit = digits[0] ?? null;

    // Highest and lowest get the strong colours, runners-up a softer one -
    // the same read the reference gives: what is running hot, what is cold.
    const standings = useMemo(() => {
        const result: TStanding[] = new Array(10).fill('none');
        if (!sample.length) return result;
        const order = distribution.map((pct, digit) => ({ pct, digit })).sort((a, b) => b.pct - a.pct);
        if (order[0]) result[order[0].digit] = 'highest';
        if (order[1]) result[order[1].digit] = 'second_highest';
        if (order[9]) result[order[9].digit] = 'lowest';
        if (order[8]) result[order[8].digit] = 'second_lowest';
        return result;
    }, [distribution, sample.length]);

    const total = sample.length || 1;
    const even_count = sample.filter(digit => digit % 2 === 0).length;
    const under_count = sample.filter(digit => digit < barrier).length;
    const equal_count = sample.filter(digit => digit === barrier).length;
    const over_count = sample.filter(digit => digit > barrier).length;

    const recent = (limit: number) => digits.slice(0, limit);
    const eo_items = recent(expanded.eo ? RECENT_EXPANDED : RECENT_COLLAPSED).map((digit, index) => ({
        key: `eo-${index}`,
        text: digit % 2 === 0 ? 'E' : 'O',
        tone: (digit % 2 === 0 ? 'good' : 'bad') as 'good' | 'bad',
    }));
    const ou_items = recent(expanded.ou ? RECENT_EXPANDED : RECENT_COLLAPSED).map((digit, index) => ({
        key: `ou-${index}`,
        text: digit < barrier ? 'U' : digit === barrier ? '=' : 'O',
        tone: (digit < barrier ? 'good' : digit === barrier ? 'flat' : 'bad') as 'good' | 'bad' | 'flat',
    }));
    const md_items = recent(expanded.md ? RECENT_EXPANDED : RECENT_COLLAPSED).map((digit, index) => ({
        key: `md-${index}`,
        text: digit === barrier ? 'M' : 'D',
        tone: (digit === barrier ? 'good' : 'bad') as 'good' | 'bad',
    }));

    const openTradingConfiguration = () => {
        startTransition(() => {
            navigate('/');
            dashboard?.setActiveTab(DBOT_TABS.BOT_BUILDER);
            quick_strategy?.setFormVisibility(true);
        });
    };

    return (
        <div className='mw-dcircles'>
            <div className='mw-dcircles__actions'>
                <button type='button' className='mw-dcircles__action mw-dcircles__action--eye'>
                    {localize('Wide Eye')}
                </button>
                <button
                    type='button'
                    className='mw-dcircles__action mw-dcircles__action--ai'
                    onClick={() => setIsAiOpen(prev => !prev)}
                >
                    {localize('Launch AI')}
                </button>
                <button
                    type='button'
                    className='mw-dcircles__info'
                    onClick={() => setIsInfoOpen(prev => !prev)}
                    aria-label={localize('About this analysis')}
                >
                    i
                </button>
            </div>

            {is_info_open && (
                <p className='mw-dcircles__note'>
                    {localize(
                        'Every figure here is counted from real ticks on the selected market: the last digit of each quote at that market’s own precision. The sample is seeded from tick history and kept current from the live stream, so it is full immediately rather than filling over the next {{count}} seconds.',
                        { count: tick_window }
                    )}
                </p>
            )}

            {is_ai_open && (
                <p className='mw-dcircles__note mw-dcircles__note--warn'>
                    {localize(
                        'No analysis backend is connected to this build, so there is nothing for Launch AI to run yet. The control is wired up; the service behind it is what is missing. It says so rather than inventing a reading.'
                    )}
                </p>
            )}

            {/* Trading Configuration. Every control below already existed and
                already rendered in this order - market, price and current
                digit, tick window, sample size, the digit circles, the legend.
                What did not exist was any statement that they are one thing:
                they read as six loose rows, and the name "Trading
                Configuration" was taken by the button under them, which leaves
                the Analysis Tool for the Bot Builder. Naming the section here
                puts the title on the controls it describes. Nothing is moved,
                duplicated or re-wired - this is a wrapper around the existing
                elements, reading from the existing feed. */}
            <section className='mw-dcircles__config-panel' aria-labelledby='mw-trading-configuration'>
                <h3 className='mw-dcircles__config-title' id='mw-trading-configuration'>
                    {localize('Trading Configuration')}
                </h3>

                <label className='mw-dcircles__market'>
                    <span>{localize('Select Market:')}</span>
                    <select value={selected_symbol} onChange={event => setSelectedSymbol(event.target.value)}>
                        {symbols.length === 0 && <option value={selected_symbol}>{selected_symbol}</option>}
                        {symbols.map(item => (
                            <option key={item.underlying_symbol} value={item.underlying_symbol}>
                                {item.underlying_symbol_name}
                            </option>
                        ))}
                    </select>
                </label>

                <div className='mw-dcircles__quote'>
                    <span className='mw-dcircles__quote-value'>
                        {last_tick ? last_tick.quote.toFixed(decimals) : '—'}
                    </span>
                    <span className='mw-dcircles__quote-digit'>{current_digit ?? '—'}</span>
                </div>

                <div className='mw-dcircles__window'>
                    <span>{localize('Ticks window:')}</span>
                    <input
                        type='number'
                        value={tick_window}
                        min={MIN_TICK_WINDOW}
                        max={MAX_TICK_WINDOW}
                        step={50}
                        onChange={event =>
                            setTickWindow(
                                Math.min(MAX_TICK_WINDOW, Math.max(MIN_TICK_WINDOW, Number(event.target.value) || 0))
                            )
                        }
                    />
                    <span className='mw-dcircles__window-range'>
                        ({MIN_TICK_WINDOW}–{MAX_TICK_WINDOW})
                    </span>
                </div>

                <div className='mw-dcircles__dist-head'>
                    <span>{localize('Last {{count}} ticks digit distribution', { count: tick_window })}</span>
                    <span className='mw-dcircles__dist-count'>
                        {sample.length}/{tick_window}
                    </span>
                </div>

                <div className='mw-dcircles__grid'>
                    {distribution.map((percentage, digit) => (
                        <DigitCircle
                            key={digit}
                            digit={digit}
                            percentage={percentage}
                            standing={standings[digit]}
                            is_current={digit === current_digit}
                        />
                    ))}
                </div>
                {/* One entry per state the circles above can actually be in.
                The circles rank four ways - highest, second highest, second
                lowest, lowest - and mark the current digit on top of that, but
                the legend named only three of the five and carried no colour at
                all, so the blue and orange circles had nothing explaining them.
                The swatches are the circle fills; the ▼ is the marker the
                current digit already wears. Ranking, colours and counts are
                untouched - this only says out loud what they already mean. */}
                <div className='mw-dcircles__legend'>
                    <span className='mw-dcircles__legend-item'>
                        <span className='mw-dcircles__legend-marker' aria-hidden='true'>
                            ▼
                        </span>
                        {localize('current digit')}
                    </span>
                    <span className='mw-dcircles__legend-item'>
                        <span
                            className='mw-dcircles__legend-swatch mw-dcircles__legend-swatch--highest'
                            aria-hidden='true'
                        />
                        {localize('most frequent')}
                    </span>
                    <span className='mw-dcircles__legend-item'>
                        <span
                            className='mw-dcircles__legend-swatch mw-dcircles__legend-swatch--second_highest'
                            aria-hidden='true'
                        />
                        {localize('2nd most frequent')}
                    </span>
                    <span className='mw-dcircles__legend-item'>
                        <span
                            className='mw-dcircles__legend-swatch mw-dcircles__legend-swatch--second_lowest'
                            aria-hidden='true'
                        />
                        {localize('2nd least frequent')}
                    </span>
                    <span className='mw-dcircles__legend-item'>
                        <span
                            className='mw-dcircles__legend-swatch mw-dcircles__legend-swatch--lowest'
                            aria-hidden='true'
                        />
                        {localize('least frequent')}
                    </span>
                </div>
            </section>

            {/* Directly under the digit circles: this is where someone decides
                a distribution is worth trading, so the way into the trade
                settings belongs at that point rather than up in the header.
                Its behaviour is unchanged - it still opens Quick Strategy in
                the Bot Builder. Only the label is: it read "Trading
                Configuration", which is the name of the section above it, so
                the one control on this screen that leaves the Analysis Tool
                was the one carrying the name of the panel that stays on it.
                The label now says where it goes. */}
            <button type='button' className='mw-dcircles__config' onClick={openTradingConfiguration}>
                {localize('Configure bot in Bot Builder')}
            </button>

            <h3 className='mw-dcircles__heading'>{localize('Even/Odd')}</h3>
            <div className='mw-dcircles__panels mw-dcircles__panels--two'>
                <Bar label={localize('Even')} count={even_count} percentage={(even_count / total) * 100} tone='good' />
                <Bar
                    label={localize('Odd')}
                    count={sample.length - even_count}
                    percentage={((sample.length - even_count) / total) * 100}
                    tone='bad'
                />
            </div>
            <RecentStrip
                title={localize('Recent E/O')}
                items={eo_items}
                expanded={expanded.eo}
                onToggle={() => setExpanded(prev => ({ ...prev, eo: !prev.eo }))}
            />

            <label className='mw-dcircles__barrier'>
                <span>{localize('Over/Under:')}</span>
                <select value={barrier} onChange={event => setBarrier(Number(event.target.value))}>
                    {Array.from({ length: 10 }, (_, digit) => (
                        <option key={digit} value={digit}>
                            {digit}
                        </option>
                    ))}
                </select>
            </label>
            <div className='mw-dcircles__panels mw-dcircles__panels--three'>
                <Bar
                    label={localize('Under')}
                    count={under_count}
                    percentage={(under_count / total) * 100}
                    tone='good'
                />
                <Bar
                    label={localize('Equal')}
                    count={equal_count}
                    percentage={(equal_count / total) * 100}
                    tone='flat'
                />
                <Bar label={localize('Over')} count={over_count} percentage={(over_count / total) * 100} tone='bad' />
            </div>
            <RecentStrip
                title={localize('Recent U/= /O')}
                items={ou_items}
                expanded={expanded.ou}
                onToggle={() => setExpanded(prev => ({ ...prev, ou: !prev.ou }))}
            />

            <h3 className='mw-dcircles__heading'>{localize('Matches/Differs')}</h3>
            <div className='mw-dcircles__panels mw-dcircles__panels--two'>
                <Bar
                    label={localize('Matches')}
                    count={equal_count}
                    percentage={(equal_count / total) * 100}
                    tone='good'
                />
                <Bar
                    label={localize('Differs')}
                    count={sample.length - equal_count}
                    percentage={((sample.length - equal_count) / total) * 100}
                    tone='bad'
                />
            </div>
            <RecentStrip
                title={localize('Recent M/D')}
                items={md_items}
                expanded={expanded.md}
                onToggle={() => setExpanded(prev => ({ ...prev, md: !prev.md }))}
            />
        </div>
    );
});

export default Dcircles;
