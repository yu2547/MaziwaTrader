import { startTransition, useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useNavigate } from 'react-router-dom';
import { DBOT_TABS } from '@/constants/bot-contents';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { useStore } from '@/hooks/useStore';
import { getDigitDistribution, getLastDigit, toDecimalPlaces } from '@/utils/market-data/last-digit';
import { TActiveSymbol, TTick } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';

const DEFAULT_SYMBOL = 'R_100';
const DEFAULT_TICK_WINDOW = 1000;
const MIN_TICK_WINDOW = 10;
const MAX_TICK_WINDOW = 1000;

/**
 * The markets the analysis view offers, named the way Deriv names them in
 * active_symbols. Matching on the API's own display name rather than writing
 * symbol codes here means the codes are never guessed - whatever
 * `underlying_symbol` Deriv returns for "Volatility 75 Index" is what gets
 * subscribed to.
 */
const PREFERRED_MARKETS = [
    'Volatility 10 Index',
    'Volatility 25 Index',
    'Volatility 50 Index',
    'Volatility 75 Index',
    'Volatility 100 Index',
    'Jump 10 Index',
    'Jump 25 Index',
    'Jump 50 Index',
    'Jump 75 Index',
    'Jump 100 Index',
];

const DigitCircle = ({
    digit,
    percentage,
    is_latest,
    is_highest,
}: {
    digit: number;
    percentage: number;
    is_latest: boolean;
    is_highest: boolean;
}) => {
    const radius = 26;
    const circumference = 2 * Math.PI * radius;
    // The arc is the digit's share of the sample, drawn from the top.
    const offset = circumference - (Math.min(percentage, 100) / 100) * circumference;

    const modifiers = [is_latest ? 'mw-dcircles__circle--latest' : '', is_highest ? 'mw-dcircles__circle--highest' : '']
        .filter(Boolean)
        .join(' ');

    return (
        <div className={`mw-dcircles__circle ${modifiers}`}>
            <svg viewBox='0 0 64 64' className='mw-dcircles__circle-svg'>
                <circle cx='32' cy='32' r={radius} className='mw-dcircles__circle-track' />
                <circle
                    cx='32'
                    cy='32'
                    r={radius}
                    className='mw-dcircles__circle-fill'
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    transform='rotate(-90 32 32)'
                />
                <text x='32' y='30' textAnchor='middle' className='mw-dcircles__circle-digit'>
                    {digit}
                </text>
                <text x='32' y='43' textAnchor='middle' className='mw-dcircles__circle-pct'>
                    {percentage.toFixed(2)}%
                </text>
            </svg>
            {is_latest && <span className='mw-dcircles__circle-marker'>▲</span>}
        </div>
    );
};

const Dcircles = observer(() => {
    const { feed, isConnected, latencyMs } = usePublicMarketFeed();
    const { dashboard, quick_strategy } = useStore() ?? {};
    const { localize } = useTranslations();
    const navigate = useNavigate();

    const [symbols, setSymbols] = useState<TActiveSymbol[]>([]);
    const [selected_symbol, setSelectedSymbol] = useState(DEFAULT_SYMBOL);
    const [tick_window, setTickWindow] = useState(DEFAULT_TICK_WINDOW);
    const [digits, setDigits] = useState<number[]>([]);
    const [last_tick, setLastTick] = useState<TTick | null>(null);
    const [is_wide_eye, setIsWideEye] = useState(false);
    const [is_ai_open, setIsAiOpen] = useState(false);
    const [is_info_open, setIsInfoOpen] = useState(false);

    useEffect(() => {
        if (!isConnected) return;
        feed.getActiveSymbols()
            .then(list => {
                const by_name = new Map(list.map(item => [item.underlying_symbol_name, item]));
                const preferred = PREFERRED_MARKETS.map(name => by_name.get(name)).filter(
                    (item): item is TActiveSymbol => !!item
                );
                // Falls back to every synthetic Deriv offers rather than to a
                // hardcoded list, so a renamed market degrades to "more
                // choice" instead of "no choice".
                const synthetics = list.filter(item => item.market === 'synthetic_index');
                setSymbols(preferred.length ? preferred : synthetics.length ? synthetics : list);
            })
            .catch(() => {
                // Non-fatal: the selector stays on the default symbol.
            });
    }, [isConnected, feed]);

    const selected_symbol_info = symbols.find(item => item.underlying_symbol === selected_symbol);
    const decimals = toDecimalPlaces(last_tick?.pip_size) ?? toDecimalPlaces(selected_symbol_info?.pip_size) ?? 2;

    // Re-subscribes whenever the market changes: the previous subscription is
    // dropped by the cleanup, so switching market immediately re-points the
    // analysis rather than blending two markets' ticks together.
    useEffect(() => {
        if (!isConnected) return undefined;
        setDigits([]);
        setLastTick(null);

        const unsubscribe = feed.subscribeTicks(selected_symbol, tick => {
            setLastTick(tick);
            const tick_decimals = toDecimalPlaces(tick.pip_size) ?? 2;
            setDigits(prev => [getLastDigit(tick.quote, tick_decimals), ...prev].slice(0, MAX_TICK_WINDOW));
        });

        return () => unsubscribe();
    }, [isConnected, feed, selected_symbol]);

    const sample = useMemo(() => digits.slice(0, tick_window), [digits, tick_window]);
    const distribution = useMemo(() => getDigitDistribution(sample), [sample]);
    const highest = useMemo(() => Math.max(...distribution), [distribution]);
    const latest_digit = digits[0] ?? null;

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
                <button type='button' className='mw-dcircles__action' onClick={openTradingConfiguration}>
                    {localize('Trading Configuration')}
                </button>
                <button
                    type='button'
                    className={`mw-dcircles__action ${is_wide_eye ? 'mw-dcircles__action--on' : ''}`}
                    onClick={() => setIsWideEye(prev => !prev)}
                    aria-pressed={is_wide_eye}
                >
                    {localize('Wide Eye')}
                </button>
                <button type='button' className='mw-dcircles__action' onClick={() => setIsAiOpen(prev => !prev)}>
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
                        'Every figure here is counted from live ticks on the selected market - the last digit of each quote, taken at that market’s own precision, over the most recent {{count}} ticks. Nothing is simulated, and the sample starts empty each time you switch market.',
                        { count: tick_window }
                    )}
                </p>
            )}

            {is_ai_open && (
                <p className='mw-dcircles__note mw-dcircles__note--warn'>
                    {localize(
                        'No analysis backend is connected to this build, so there is nothing for Launch AI to run yet. The control is here and wired up; what is missing is the service behind it. It shows this rather than inventing a reading.'
                    )}
                </p>
            )}

            <div className='mw-dcircles__controls'>
                <label className='mw-dcircles__field'>
                    <span>{localize('Market')}</span>
                    <select value={selected_symbol} onChange={event => setSelectedSymbol(event.target.value)}>
                        {symbols.length === 0 && <option value={selected_symbol}>{selected_symbol}</option>}
                        {symbols.map(item => (
                            <option key={item.underlying_symbol} value={item.underlying_symbol}>
                                {item.underlying_symbol_name}
                            </option>
                        ))}
                    </select>
                </label>
                <label className='mw-dcircles__field'>
                    <span>{localize('Tick window')}</span>
                    <input
                        type='number'
                        value={tick_window}
                        min={MIN_TICK_WINDOW}
                        max={MAX_TICK_WINDOW}
                        step={10}
                        onChange={event =>
                            setTickWindow(
                                Math.min(MAX_TICK_WINDOW, Math.max(MIN_TICK_WINDOW, Number(event.target.value) || 0))
                            )
                        }
                    />
                </label>
            </div>

            <div className='mw-dcircles__readout'>
                <div className='mw-dcircles__quote'>
                    <span className='mw-dcircles__quote-label'>{localize('Current value')}</span>
                    <span className='mw-dcircles__quote-value'>
                        {last_tick ? last_tick.quote.toFixed(decimals) : '—'}
                    </span>
                </div>
                <div className='mw-dcircles__quote'>
                    <span className='mw-dcircles__quote-label'>{localize('Last digit')}</span>
                    <span className='mw-dcircles__quote-value mw-dcircles__quote-value--digit'>
                        {latest_digit ?? '—'}
                    </span>
                </div>
                <div className='mw-dcircles__meta'>
                    <span className={`mw-dcircles__dot ${isConnected ? 'mw-dcircles__dot--live' : ''}`} />
                    {isConnected ? localize('Live') : localize('Connecting…')}
                    {' · '}
                    {localize('{{collected}}/{{window}} ticks', { collected: sample.length, window: tick_window })}
                    {latencyMs != null && ` · ${latencyMs}ms`}
                </div>
            </div>

            <div className={`mw-dcircles__grid ${is_wide_eye ? 'mw-dcircles__grid--wide' : ''}`}>
                {distribution.map((percentage, digit) => (
                    <DigitCircle
                        key={digit}
                        digit={digit}
                        percentage={percentage}
                        is_latest={digit === latest_digit}
                        is_highest={sample.length > 0 && percentage === highest}
                    />
                ))}
            </div>

            {is_wide_eye && (
                <div className='mw-dcircles__wide'>
                    <div className='mw-dcircles__wide-row'>
                        <span>{localize('Even')}</span>
                        <strong>
                            {sample.length
                                ? `${((sample.filter(d => d % 2 === 0).length / sample.length) * 100).toFixed(2)}%`
                                : '—'}
                        </strong>
                    </div>
                    <div className='mw-dcircles__wide-row'>
                        <span>{localize('Odd')}</span>
                        <strong>
                            {sample.length
                                ? `${((sample.filter(d => d % 2 !== 0).length / sample.length) * 100).toFixed(2)}%`
                                : '—'}
                        </strong>
                    </div>
                    <div className='mw-dcircles__wide-strip'>
                        {digits.slice(0, 24).map((digit, index) => (
                            <span
                                key={index}
                                className={`mw-dcircles__wide-chip ${digit % 2 === 0 ? 'mw-dcircles__wide-chip--even' : 'mw-dcircles__wide-chip--odd'}`}
                            >
                                {digit}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
});

export default Dcircles;
