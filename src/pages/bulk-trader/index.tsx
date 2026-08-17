import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { useStore } from '@/hooks/useStore';
import { TActiveSymbol, TTick } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';
import useManualTrade from './use-manual-trade';
import './bulk-trader.scss';

const DEFAULT_SYMBOL = 'R_100';
const MAX_TICK_HISTORY = 1000;

/**
 * Each trade type is two opposing contracts, which is exactly the pair of
 * buttons at the bottom of the page. `barrier` marks the types Deriv needs a
 * prediction digit for.
 */
const TRADE_TYPES = {
    'Even/Odd': { left: 'DIGITEVEN', right: 'DIGITODD', left_label: 'Even', right_label: 'Odd', barrier: false },
    'Over/Under': { left: 'DIGITOVER', right: 'DIGITUNDER', left_label: 'Over', right_label: 'Under', barrier: true },
    'Matches/Differs': {
        left: 'DIGITMATCH',
        right: 'DIGITDIFF',
        left_label: 'Matches',
        right_label: 'Differs',
        barrier: true,
    },
    'Rise/Fall': { left: 'CALL', right: 'PUT', left_label: 'Rise', right_label: 'Fall', barrier: false },
} as const;

type TTradeType = keyof typeof TRADE_TYPES;

/**
 * `pip_size` means two different things on this API and the difference is
 * silent: a `tick` reports it as a count of decimal places (R_100 -> 2),
 * while an `active_symbols` entry reports it as the pip's value (R_100 ->
 * 0.01). Feeding the second straight into toFixed() rounds the argument to 0,
 * which formatted every quote as a bare integer and made the "last digit" the
 * units digit - so the whole distribution collapsed onto one digit.
 */
const toDecimalPlaces = (pip_size: number | undefined): number | undefined => {
    if (pip_size === undefined || pip_size === null || Number.isNaN(pip_size)) return undefined;
    if (pip_size >= 1) return Math.round(pip_size);
    if (pip_size <= 0) return undefined;
    return Math.round(-Math.log10(pip_size));
};

// Matches Deriv's own definition of "last digit": the final character of the
// quote once it's formatted to the symbol's real precision, not a rounded
// float - e.g. 640.72 at 2 decimals has last digit 2, not floor(0.72*100)%10
// which can disagree after floating point error.
const getLastDigit = (quote: number, decimals: number): number => {
    const fixed = quote.toFixed(decimals);
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
                    {percentage.toFixed(2)}%
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
    min = 0,
    max,
    step = 1,
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
}) => (
    <label className='mw-bulk-trader__field'>
        <span className='mw-bulk-trader__field-label'>{label}</span>
        <input
            className='mw-bulk-trader__field-input'
            type='number'
            value={Number.isFinite(value) ? value : ''}
            onChange={event => onChange(event.target.value === '' ? 0 : Number(event.target.value))}
            min={min}
            max={max}
            step={step}
        />
    </label>
);

const BulkTraderPage = observer(() => {
    const { feed, isConnected } = usePublicMarketFeed();
    const { oauth_session, client } = useStore() ?? {};
    const { localize } = useTranslations();
    const trade = useManualTrade();

    const [symbols, setSymbols] = useState<TActiveSymbol[]>([]);
    const [selected_symbol, setSelectedSymbol] = useState(DEFAULT_SYMBOL);
    const [trade_type, setTradeType] = useState<TTradeType>('Even/Odd');
    const [sample_size, setSampleSize] = useState(1000);
    const [barrier, setBarrier] = useState(5);
    const [digits, setDigits] = useState<number[]>([]);
    const [last_tick, setLastTick] = useState<TTick | null>(null);

    const [stake, setStake] = useState(0.5);
    const [duration_ticks, setDurationTicks] = useState(1);
    const [trades_per_click, setTradesPerClick] = useState(1);
    // What the last click asked for versus what actually opened. Only
    // interesting when they disagree.
    const [last_batch, setLastBatch] = useState<{ requested: number; opened: number } | null>(null);

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
    // The tick is the more trustworthy source - it is the message the quote
    // itself arrived on - so it wins over the symbol list.
    const decimals = toDecimalPlaces(last_tick?.pip_size) ?? toDecimalPlaces(selected_symbol_info?.pip_size) ?? 2;

    useEffect(() => {
        if (!isConnected) return undefined;
        setDigits([]);
        setLastTick(null);

        const unsubscribe = feed.subscribeTicks(selected_symbol, tick => {
            setLastTick(tick);
            const tick_decimals =
                toDecimalPlaces(tick.pip_size) ?? toDecimalPlaces(selected_symbol_info?.pip_size) ?? 2;
            const digit = getLastDigit(tick.quote, tick_decimals);
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

    // The percentage printed inside each action button: how often that side
    // has won over the current sample. Rise/Fall is measured tick-over-tick,
    // the rest straight off the digit distribution.
    const side_percentages = useMemo(() => {
        const total = sample.length || 1;
        switch (trade_type) {
            case 'Even/Odd': {
                const even = sample.filter(digit => digit % 2 === 0).length;
                return { left: (even / total) * 100, right: ((sample.length - even) / total) * 100 };
            }
            case 'Over/Under': {
                const over = sample.filter(digit => digit > barrier).length;
                const under = sample.filter(digit => digit < barrier).length;
                return { left: (over / total) * 100, right: (under / total) * 100 };
            }
            case 'Matches/Differs': {
                const matches = sample.filter(digit => digit === barrier).length;
                return { left: (matches / total) * 100, right: ((sample.length - matches) / total) * 100 };
            }
            case 'Rise/Fall':
            default:
                return { left: rise_fall_stats.rise_pct, right: rise_fall_stats.fall_pct };
        }
    }, [sample, trade_type, barrier, rise_fall_stats]);

    const recent_digits = digits.slice(0, 8);
    const config = TRADE_TYPES[trade_type];
    const is_logged_in = Boolean(oauth_session?.is_authenticated || client?.is_logged_in);
    const total_risk = stake * trades_per_click;

    // Every contract in the batch goes out together, so all of them price off
    // the same moment in the market. Placing them one after another meant the
    // last contract of a 20-trade batch opened many ticks after the first,
    // which is not one signal traded 20 times.
    //
    // The count is whatever was typed - there is no ceiling on it here. What
    // actually opened is reported back rather than assumed, because a batch
    // large enough to be throttled will land short and the difference matters.
    const placeSide = async (contract_type: string) => {
        const requested = trades_per_click;
        const opened = await trade.placeTrades(
            {
                contract_type,
                symbol: selected_symbol,
                stake,
                duration: duration_ticks,
                ...(config.barrier ? { barrier } : {}),
            },
            requested
        );
        setLastBatch({ requested, opened });
    };

    // The OAuth account is the one that actually gets debited, so its currency
    // wins. ClientStore.currency is only consulted for classic sessions, and
    // is deliberately last - it holds a leftover value when nobody is logged
    // in, which would otherwise label the risk line in a currency this session
    // has nothing to do with.
    const currency = oauth_session?.currency || (is_logged_in && (client?.currency as string)) || 'USD';

    return (
        <div className='mw-bulk-trader'>
            <div className='mw-bulk-trader__main'>
                <div className='mw-bulk-trader__row'>
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
                            {Object.keys(TRADE_TYPES).map(type => (
                                <option key={type} value={type}>
                                    {type}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>

                <div className='mw-bulk-trader__row mw-bulk-trader__row--single'>
                    <NumberField
                        label={localize('Number of ticks')}
                        value={sample_size}
                        onChange={value => setSampleSize(Math.min(MAX_TICK_HISTORY, Math.max(10, value)))}
                        min={10}
                        max={MAX_TICK_HISTORY}
                        step={10}
                    />
                    {config.barrier && (
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
                        {last_tick ? last_tick.quote.toFixed(decimals) : '—'}
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

                <div className='mw-bulk-trader__row mw-bulk-trader__row--three'>
                    <NumberField
                        label={localize('Ticks')}
                        value={duration_ticks}
                        onChange={value => setDurationTicks(Math.min(10, Math.max(1, value)))}
                        min={1}
                        max={10}
                    />
                    <NumberField label={localize('Stake')} value={stake} onChange={setStake} min={0.35} step={0.1} />
                    <NumberField
                        label={localize('Trades per click')}
                        value={trades_per_click}
                        onChange={value => setTradesPerClick(Math.max(1, value))}
                        min={1}
                    />
                </div>

                <div className='mw-bulk-trader__actions'>
                    <button
                        type='button'
                        className='mw-bulk-trader__action mw-bulk-trader__action--left'
                        onClick={() => placeSide(config.left)}
                        disabled={!is_logged_in || trade.is_placing}
                    >
                        <span className='mw-bulk-trader__action-label'>{localize(config.left_label)}</span>
                        <span className='mw-bulk-trader__action-pct'>{side_percentages.left.toFixed(2)}%</span>
                    </button>
                    <button
                        type='button'
                        className='mw-bulk-trader__action mw-bulk-trader__action--right'
                        onClick={() => placeSide(config.right)}
                        disabled={!is_logged_in || trade.is_placing}
                    >
                        <span className='mw-bulk-trader__action-label'>{localize(config.right_label)}</span>
                        <span className='mw-bulk-trader__action-pct'>{side_percentages.right.toFixed(2)}%</span>
                    </button>
                </div>

                <div className='mw-bulk-trader__risk'>
                    {is_logged_in
                        ? localize('Each click stakes {{total}} {{currency}} in total ({{count}} × {{stake}}).', {
                              total: total_risk.toFixed(2),
                              currency,
                              count: trades_per_click,
                              stake: stake.toFixed(2),
                          })
                        : localize('Log in to place trades. The statistics above are live either way.')}
                    {trade.pending_count > 0 &&
                        ` ${localize('{{count}} still running.', { count: trade.pending_count })}`}
                    {last_batch && last_batch.opened < last_batch.requested && (
                        <span className='mw-bulk-trader__shortfall'>
                            {` ${localize('Last click: {{opened}} of {{requested}} opened.', {
                                opened: last_batch.opened,
                                requested: last_batch.requested,
                            })}`}
                        </span>
                    )}
                </div>

                {trade.error_message && <div className='mw-bulk-trader__error'>{trade.error_message}</div>}
            </div>
        </div>
    );
});

export default BulkTraderPage;
