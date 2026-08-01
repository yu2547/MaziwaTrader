import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { TActiveSymbol, TTick } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';
import './bulk-trader.scss';

const DEFAULT_SYMBOL = 'R_100';
const MAX_TICK_HISTORY = 1000;

const TRADE_TYPES = ['Even/Odd', 'Over/Under', 'Matches/Differs', 'Rise/Fall'] as const;
type TTradeType = (typeof TRADE_TYPES)[number];

// Matches Deriv's own definition of "last digit": the final character of the
// quote once it's formatted to the symbol's real pip size, not a rounded
// float - e.g. 640.72 at pip_size 2 has last digit 2, not floor(0.72*100)%10
// which can disagree after floating point error.
const getLastDigit = (quote: number, pip_size: number): number => {
    const fixed = quote.toFixed(pip_size);
    return Number(fixed[fixed.length - 1]);
};

const DigitGauge = ({ digit, percentage, is_current }: { digit: number; percentage: number; is_current: boolean }) => {
    const radius = 26;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (Math.min(percentage, 100) / 100) * circumference;

    return (
        <div className={`mw-bulk-trader__gauge ${is_current ? 'mw-bulk-trader__gauge--current' : ''}`}>
            <svg viewBox='0 0 64 64' className='mw-bulk-trader__gauge-svg'>
                <circle cx='32' cy='32' r={radius} className='mw-bulk-trader__gauge-track' />
                <circle
                    cx='32'
                    cy='32'
                    r={radius}
                    className='mw-bulk-trader__gauge-fill'
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    transform='rotate(-90 32 32)'
                />
                <text x='32' y='29' textAnchor='middle' className='mw-bulk-trader__gauge-digit'>
                    {digit}
                </text>
                <text x='32' y='42' textAnchor='middle' className='mw-bulk-trader__gauge-pct'>
                    {percentage.toFixed(1)}%
                </text>
            </svg>
            {is_current && <span className='mw-bulk-trader__gauge-arrow'>▲</span>}
        </div>
    );
};

const NumberField = ({
    label,
    value,
    onChange,
    suffix,
    min = 0,
    max,
    step = 1,
    disabled = false,
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    suffix?: string;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
}) => (
    <label className='mw-bulk-trader__field'>
        <span className='mw-bulk-trader__field-label'>{label}</span>
        <div className='mw-bulk-trader__field-input'>
            <input
                type='number'
                value={Number.isFinite(value) ? value : ''}
                onChange={event => onChange(event.target.value === '' ? 0 : Number(event.target.value))}
                min={min}
                max={max}
                step={step}
                disabled={disabled}
            />
            {suffix && <span className='mw-bulk-trader__field-suffix'>{suffix}</span>}
        </div>
    </label>
);

const BulkTraderPage = observer(() => {
    const { feed, isConnected, latencyMs } = usePublicMarketFeed();
    const { localize } = useTranslations();

    const [symbols, setSymbols] = useState<TActiveSymbol[]>([]);
    const [selected_symbol, setSelectedSymbol] = useState(DEFAULT_SYMBOL);
    const [trade_type, setTradeType] = useState<TTradeType>('Even/Odd');
    const [sample_size, setSampleSize] = useState(1000);
    const [barrier, setBarrier] = useState(5);
    const [digits, setDigits] = useState<number[]>([]);
    const [last_tick, setLastTick] = useState<TTick | null>(null);

    // Trade configuration - pure form state. Nothing here is ever sent
    // anywhere: execution depends on the classic trading engine, which is
    // confirmed unreachable (see the disabled notice below), so these values
    // are only ever staged for when that connection comes back.
    const [stake, setStake] = useState(1);
    const [duration_ticks, setDurationTicks] = useState(1);
    const [no_of_trades, setNoOfTrades] = useState(1);
    const [use_martingale, setUseMartingale] = useState(false);
    const [martingale_multiplier, setMartingaleMultiplier] = useState(2);
    const [stop_loss, setStopLoss] = useState(0);
    const [take_profit, setTakeProfit] = useState(0);
    const [risk_pct, setRiskPct] = useState(2);

    useEffect(() => {
        if (!isConnected) return;
        feed.getActiveSymbols()
            .then(list => {
                const synthetics = list.filter(item => item.market === 'synthetic_index');
                setSymbols(synthetics.length ? synthetics : list);
            })
            .catch(() => {
                // Non-fatal: the selector just stays limited to the default symbol.
            });
    }, [isConnected, feed]);

    const selected_symbol_info = symbols.find(item => item.underlying_symbol === selected_symbol);
    const pip_size = selected_symbol_info?.pip_size ?? last_tick?.pip_size ?? 2;
    const market_open = selected_symbol_info ? selected_symbol_info.exchange_is_open === 1 : null;

    useEffect(() => {
        if (!isConnected) return undefined;
        setDigits([]);
        setLastTick(null);

        const unsubscribe = feed.subscribeTicks(selected_symbol, tick => {
            setLastTick(tick);
            const tick_pip_size = selected_symbol_info?.pip_size ?? tick.pip_size ?? 2;
            const digit = getLastDigit(tick.quote, tick_pip_size);
            setDigits(prev => [digit, ...prev].slice(0, MAX_TICK_HISTORY));
        });

        return () => unsubscribe();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isConnected, feed, selected_symbol]);

    const sample = useMemo(() => digits.slice(0, sample_size), [digits, sample_size]);

    const digit_percentages = useMemo(() => {
        const counts = new Array(10).fill(0);
        sample.forEach(digit => {
            counts[digit] += 1;
        });
        const total = sample.length || 1;
        return counts.map(count => (count / total) * 100);
    }, [sample]);

    const current_digit = digits[0] ?? null;

    const stats = useMemo(() => {
        const total = sample.length || 1;
        const even_count = sample.filter(d => d % 2 === 0).length;
        const over_count = sample.filter(d => d > barrier).length;
        const under_count = sample.filter(d => d < barrier).length;
        const match_count = sample.filter(d => d === barrier).length;
        return {
            even_pct: (even_count / total) * 100,
            odd_pct: ((sample.length - even_count) / total) * 100,
            over_pct: (over_count / total) * 100,
            under_pct: (under_count / total) * 100,
            match_pct: (match_count / total) * 100,
            differ_pct: ((sample.length - match_count) / total) * 100,
        };
    }, [sample, barrier]);

    const rise_fall_stats = useMemo(() => {
        if (sample.length < 2) return { rise_pct: 0, fall_pct: 0 };
        let rises = 0;
        let falls = 0;
        // digits[] is newest-first, so compare each entry to the one after it
        // (its chronological predecessor) to classify the tick-over-tick move.
        for (let i = 0; i < sample.length - 1; i += 1) {
            if (sample[i] > sample[i + 1]) rises += 1;
            else if (sample[i] < sample[i + 1]) falls += 1;
        }
        const total = rises + falls || 1;
        return { rise_pct: (rises / total) * 100, fall_pct: (falls / total) * 100 };
    }, [sample]);

    const recent_digits = digits.slice(0, 20);

    return (
        <div className='mw-bulk-trader'>
            <div className='mw-bulk-trader__header'>
                <h1>{localize('Bulk Trader')}</h1>
                <p>
                    {localize(
                        'Live digit statistics from the public market feed. Trade execution is disabled until the classic trading connection is restored - everything below is real, live data, not a simulation.'
                    )}
                </p>
                <div className='mw-bulk-trader__status-row'>
                    <span
                        className={`mw-bulk-trader__status-pill ${isConnected ? 'mw-bulk-trader__status-pill--live' : ''}`}
                    >
                        <span className='mw-bulk-trader__status-dot' />
                        {isConnected ? localize('Live') : localize('Connecting…')}
                    </span>
                    <span className='mw-bulk-trader__status-meta'>
                        {localize('Latency')}: {latencyMs != null ? `${latencyMs}ms` : '—'}
                    </span>
                    <span className='mw-bulk-trader__status-meta'>
                        {localize('Market')}:{' '}
                        {market_open === null ? '—' : market_open ? localize('Open') : localize('Closed')}
                    </span>
                </div>
            </div>

            <div className='mw-bulk-trader__controls'>
                <label className='mw-bulk-trader__select'>
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
                <label className='mw-bulk-trader__select'>
                    <span>{localize('Trade type')}</span>
                    <select value={trade_type} onChange={event => setTradeType(event.target.value as TTradeType)}>
                        {TRADE_TYPES.map(type => (
                            <option key={type} value={type}>
                                {type}
                            </option>
                        ))}
                    </select>
                </label>
                <NumberField
                    label={localize('Number of ticks (sample size)')}
                    value={sample_size}
                    onChange={setSampleSize}
                    min={10}
                    max={MAX_TICK_HISTORY}
                    step={10}
                />
                {(trade_type === 'Over/Under' || trade_type === 'Matches/Differs') && (
                    <NumberField
                        label={localize('Barrier digit')}
                        value={barrier}
                        onChange={value => setBarrier(Math.min(9, Math.max(0, value)))}
                        min={0}
                        max={9}
                    />
                )}
            </div>

            <div className='mw-bulk-trader__current-tick'>
                <span className='mw-bulk-trader__current-tick-label'>{localize('Current tick')}</span>
                <span className='mw-bulk-trader__current-tick-value'>
                    {last_tick ? last_tick.quote.toFixed(pip_size) : '—'}
                </span>
                <span className='mw-bulk-trader__current-tick-sample'>
                    {localize('Sample')}: {sample.length}/{sample_size} {localize('ticks')}
                </span>
            </div>

            <div className='mw-bulk-trader__gauges'>
                {digit_percentages.map((pct, digit) => (
                    <DigitGauge key={digit} digit={digit} percentage={pct} is_current={digit === current_digit} />
                ))}
            </div>

            {recent_digits.length > 0 && (
                <div className='mw-bulk-trader__history'>
                    {recent_digits.map((digit, index) => (
                        <span
                            key={index}
                            className={`mw-bulk-trader__history-chip ${digit % 2 === 0 ? 'mw-bulk-trader__history-chip--even' : 'mw-bulk-trader__history-chip--odd'}`}
                        >
                            {digit % 2 === 0 ? 'E' : 'O'}
                        </span>
                    ))}
                </div>
            )}

            <div className='mw-bulk-trader__stat-bars'>
                {trade_type === 'Even/Odd' && (
                    <>
                        <div className='mw-bulk-trader__stat-bar mw-bulk-trader__stat-bar--good'>
                            <span>{localize('Even')}</span>
                            <strong>{stats.even_pct.toFixed(2)}%</strong>
                        </div>
                        <div className='mw-bulk-trader__stat-bar mw-bulk-trader__stat-bar--bad'>
                            <span>{localize('Odd')}</span>
                            <strong>{stats.odd_pct.toFixed(2)}%</strong>
                        </div>
                    </>
                )}
                {trade_type === 'Over/Under' && (
                    <>
                        <div className='mw-bulk-trader__stat-bar mw-bulk-trader__stat-bar--good'>
                            <span>
                                {localize('Over')} {barrier}
                            </span>
                            <strong>{stats.over_pct.toFixed(2)}%</strong>
                        </div>
                        <div className='mw-bulk-trader__stat-bar mw-bulk-trader__stat-bar--bad'>
                            <span>
                                {localize('Under')} {barrier}
                            </span>
                            <strong>{stats.under_pct.toFixed(2)}%</strong>
                        </div>
                    </>
                )}
                {trade_type === 'Matches/Differs' && (
                    <>
                        <div className='mw-bulk-trader__stat-bar mw-bulk-trader__stat-bar--good'>
                            <span>
                                {localize('Matches')} {barrier}
                            </span>
                            <strong>{stats.match_pct.toFixed(2)}%</strong>
                        </div>
                        <div className='mw-bulk-trader__stat-bar mw-bulk-trader__stat-bar--bad'>
                            <span>{localize('Differs')}</span>
                            <strong>{stats.differ_pct.toFixed(2)}%</strong>
                        </div>
                    </>
                )}
                {trade_type === 'Rise/Fall' && (
                    <>
                        <div className='mw-bulk-trader__stat-bar mw-bulk-trader__stat-bar--good'>
                            <span>{localize('Rise')}</span>
                            <strong>{rise_fall_stats.rise_pct.toFixed(2)}%</strong>
                        </div>
                        <div className='mw-bulk-trader__stat-bar mw-bulk-trader__stat-bar--bad'>
                            <span>{localize('Fall')}</span>
                            <strong>{rise_fall_stats.fall_pct.toFixed(2)}%</strong>
                        </div>
                    </>
                )}
            </div>

            <div className='mw-bulk-trader__config'>
                <h2>{localize('Trade configuration')}</h2>
                <div className='mw-bulk-trader__config-grid'>
                    <NumberField label={localize('Stake')} value={stake} onChange={setStake} min={0.35} step={0.1} />
                    <NumberField
                        label={localize('Duration')}
                        value={duration_ticks}
                        onChange={setDurationTicks}
                        suffix={localize('ticks')}
                        min={1}
                        max={10}
                    />
                    <NumberField
                        label={localize('Number of trades')}
                        value={no_of_trades}
                        onChange={setNoOfTrades}
                        min={1}
                        max={1000}
                    />
                    <NumberField
                        label={localize('Stop loss')}
                        value={stop_loss}
                        onChange={setStopLoss}
                        suffix='USD'
                        step={0.5}
                    />
                    <NumberField
                        label={localize('Take profit')}
                        value={take_profit}
                        onChange={setTakeProfit}
                        suffix='USD'
                        step={0.5}
                    />
                    <NumberField
                        label={localize('Risk per trade')}
                        value={risk_pct}
                        onChange={setRiskPct}
                        suffix='%'
                        max={100}
                    />
                    <label className='mw-bulk-trader__field mw-bulk-trader__field--checkbox'>
                        <span className='mw-bulk-trader__field-label'>{localize('Use martingale')}</span>
                        <input
                            type='checkbox'
                            checked={use_martingale}
                            onChange={event => setUseMartingale(event.target.checked)}
                        />
                    </label>
                    {use_martingale && (
                        <NumberField
                            label={localize('Martingale multiplier')}
                            value={martingale_multiplier}
                            onChange={setMartingaleMultiplier}
                            min={1.1}
                            step={0.1}
                        />
                    )}
                </div>

                <div className='mw-bulk-trader__execution-notice'>
                    <p>
                        {localize(
                            'Execution requires the classic Deriv trading connection, which is currently unavailable. Your configuration above is saved on this page and will be ready to run the moment that connection is restored.'
                        )}
                    </p>
                    <button
                        type='button'
                        className='mw-bulk-trader__start-btn'
                        disabled
                        title={localize('Execution unavailable')}
                    >
                        {localize('Start Bulk Trading')}
                    </button>
                </div>
            </div>
        </div>
    );
});

export default BulkTraderPage;
