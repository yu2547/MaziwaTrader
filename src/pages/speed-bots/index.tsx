import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { LogTypes, observer as globalObserver } from '@/external/bot-skeleton';
import { getDigitDistribution, getLastDigit, toDecimalPlaces } from '@/utils/market-data/last-digit';
import { public_market_feed } from '@/utils/market-data/public-market-feed';
import { localize } from '@deriv-com/translations';
import useManualTrade from '../bulk-trader/use-manual-trade';
import './speed-bots.scss';

/**
 * SpeedBots > Matches.
 *
 * The digit distribution is real: tick history plus the live tick stream from
 * public_market_feed, the same feed the rest of the app reads. Nothing here
 * simulates a quote or a result.
 *
 * Trades go through useManualTrade - the existing proposal -> buy -> settle
 * path - as DIGITMATCH with the digit as the barrier. Trade once places one
 * round. Auto trading repeats it and is the only thing that trades without a
 * further click, which is why it stops itself on take profit, on stop loss,
 * and on any failed round.
 */

const MARKETS: Array<{ symbol: string; label: string }> = [
    { symbol: '1HZ100V', label: 'Volatility 100 (1s) Index' },
    { symbol: '1HZ75V', label: 'Volatility 75 (1s) Index' },
    { symbol: '1HZ50V', label: 'Volatility 50 (1s) Index' },
    { symbol: '1HZ25V', label: 'Volatility 25 (1s) Index' },
    { symbol: '1HZ10V', label: 'Volatility 10 (1s) Index' },
    { symbol: 'R_100', label: 'Volatility 100 Index' },
    { symbol: 'R_75', label: 'Volatility 75 Index' },
    { symbol: 'R_50', label: 'Volatility 50 Index' },
];

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const SUB_TABS = ['Matches', 'Diffbot', 'Hyperbot', 'SpeedBot'] as const;
type TSubTab = (typeof SUB_TABS)[number];

/** Digits sharing the highest (or lowest) count in the window. */
const extremeDigits = (shares: number[], want: 'most' | 'least'): number[] => {
    if (!shares.length) return [];
    const target = want === 'most' ? Math.max(...shares) : Math.min(...shares);
    return DIGITS.filter(digit => shares[digit] === target);
};

const MatchesPanel = observer(() => {
    const { placeTrades, is_placing, error_message } = useManualTrade();

    const [symbol, setSymbol] = useState('1HZ100V');
    const [tick_count, setTickCount] = useState(1000);
    const [digits, setDigits] = useState<number[]>([]);
    const [is_loading, setIsLoading] = useState(true);

    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [use_default_stake, setUseDefaultStake] = useState(true);
    const [default_stake, setDefaultStake] = useState('0.5');
    const [stakes, setStakes] = useState<Record<number, string>>({});

    const [alternating, setAlternating] = useState(false);
    const [alternating_side, setAlternatingSide] = useState<'most' | 'least'>('most');
    const [entry_enabled, setEntryEnabled] = useState(true);
    const [last_n, setLastN] = useState(5);
    const [what_to_trade, setWhatToTrade] = useState<'most' | 'least'>('most');

    const [take_profit, setTakeProfit] = useState('5');
    const [stop_loss, setStopLoss] = useState('10');

    const [auto_trading, setAutoTrading] = useState(false);
    const [session_profit, setSessionProfit] = useState(0);
    const [notice, setNotice] = useState<string | null>(null);

    // Refs so the auto-trading loop reads current values without being torn
    // down and restarted every time one of them changes mid-session.
    const auto_ref = useRef(false);
    const profit_ref = useRef(0);

    /**
     * Realised profit for the session, accumulated from the settlement events
     * the trade path already emits when a contract closes. Take profit and stop
     * loss are checked against this, so both are measured on money that has
     * actually settled rather than on an estimate.
     */
    useEffect(() => {
        const onSettled = (payload: unknown) => {
            const entry = payload as { log_type?: string; extra?: { profit?: number } };
            if (entry?.log_type !== LogTypes.PROFIT && entry?.log_type !== LogTypes.LOST) return;
            const profit = Number(entry.extra?.profit);
            if (!Number.isFinite(profit)) return;
            profit_ref.current += profit;
            setSessionProfit(profit_ref.current);
        };
        globalObserver.register('ui.log.success', onSettled);
        return () => globalObserver.unregister('ui.log.success', onSettled);
    }, []);

    /** History first, then every tick after it. Real quotes, no filler. */
    useEffect(() => {
        let cancelled = false;
        let unsubscribe: (() => void) | undefined;
        setIsLoading(true);
        setDigits([]);
        public_market_feed.acquire();

        (async () => {
            try {
                const history = await public_market_feed.getTickHistory(symbol, tick_count);
                if (cancelled) return;
                const decimals = toDecimalPlaces(history.pip_size) ?? 2;
                setDigits(history.prices.map(price => getLastDigit(price, decimals)));
                setIsLoading(false);
                unsubscribe = public_market_feed.subscribeTicks(symbol, tick => {
                    const digit = getLastDigit(tick.quote, toDecimalPlaces(tick.pip_size) ?? decimals);
                    setDigits(previous => [...previous, digit].slice(-tick_count));
                });
            } catch {
                if (!cancelled) setIsLoading(false);
            }
        })();

        return () => {
            cancelled = true;
            unsubscribe?.();
            public_market_feed.release();
        };
    }, [symbol, tick_count]);

    // getDigitDistribution returns each digit's share as a percentage, not a
    // tally - reading it as one and dividing by the window again put every
    // figure and every bar about ten times too low at a 1000-tick window.
    const shares = useMemo(() => getDigitDistribution(digits), [digits]);
    const total = digits.length;
    const most = useMemo(() => extremeDigits(shares, 'most'), [shares]);
    const least = useMemo(() => extremeDigits(shares, 'least'), [shares]);
    const last_digits = useMemo(() => digits.slice(-last_n), [digits, last_n]);

    // The entry condition, evaluated against the live window: every one of the
    // last N digits belongs to the side being watched.
    const side = alternating ? alternating_side : what_to_trade;
    const watch_set = side === 'most' ? most : least;
    const entry_met =
        last_digits.length === last_n && last_n > 0 && last_digits.every(digit => watch_set.includes(digit));

    const stakeFor = useCallback(
        (digit: number) => {
            const raw = use_default_stake ? default_stake : (stakes[digit] ?? default_stake);
            const value = Number(raw);
            return Number.isFinite(value) && value > 0 ? value : 0;
        },
        [use_default_stake, default_stake, stakes]
    );

    const total_stake = [...selected].reduce((sum, digit) => sum + stakeFor(digit), 0);

    const toggleDigit = (digit: number) =>
        setSelected(previous => {
            const next = new Set(previous);
            if (next.has(digit)) next.delete(digit);
            else next.add(digit);
            return next;
        });

    /** One round: a DIGITMATCH contract per selected digit, priced together. */
    const runRound = useCallback(async () => {
        const chosen = [...selected];
        if (!chosen.length) {
            setNotice(localize('Select at least one digit first.'));
            return false;
        }
        const results = await Promise.all(
            chosen.map(digit =>
                placeTrades(
                    { contract_type: 'DIGITMATCH', symbol, stake: stakeFor(digit), duration: 1, barrier: digit },
                    1
                )
            )
        );
        return results.some(placed => placed > 0);
    }, [selected, placeTrades, symbol, stakeFor]);

    const tradeOnce = async () => {
        setNotice(null);
        await runRound();
    };

    // Take profit and stop loss are read from realised profit, which arrives on
    // the same log events the trade path already emits when a contract settles.
    useEffect(() => {
        if (!auto_trading) return undefined;
        let cancelled = false;

        const loop = async () => {
            while (!cancelled && auto_ref.current) {
                if (entry_enabled && !entry_met) {
                    await new Promise(resolve => setTimeout(resolve, 400));
                    continue;
                }
                const placed = await runRound();
                if (!placed) {
                    setNotice(localize('Auto trading stopped: a round could not be placed.'));
                    break;
                }
                if (alternating) setAlternatingSide(current => (current === 'most' ? 'least' : 'most'));

                const target = Number(take_profit);
                const floor = Number(stop_loss);
                if (Number.isFinite(target) && target > 0 && profit_ref.current >= target) {
                    setNotice(localize('Auto trading stopped: take profit reached.'));
                    break;
                }
                if (Number.isFinite(floor) && floor > 0 && profit_ref.current <= -floor) {
                    setNotice(localize('Auto trading stopped: stop loss reached.'));
                    break;
                }
            }
            if (!cancelled) {
                auto_ref.current = false;
                setAutoTrading(false);
            }
        };

        auto_ref.current = true;
        loop();
        return () => {
            cancelled = true;
            auto_ref.current = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [auto_trading]);

    const percent = (digit: number) => (total ? shares[digit].toFixed(1) : '0.0');

    return (
        <div className='mw-speed__panel'>
            <h1 className='mw-speed__title'>{localize('Matches')}</h1>

            <div className='mw-speed__controls'>
                <label className='mw-speed__field'>
                    <span>{localize('Market:')}</span>
                    <select value={symbol} onChange={event => setSymbol(event.target.value)}>
                        {MARKETS.map(market => (
                            <option key={market.symbol} value={market.symbol}>
                                {market.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label className='mw-speed__field'>
                    <span>{localize('Ticks:')}</span>
                    <input
                        type='number'
                        min={10}
                        max={5000}
                        value={tick_count}
                        onChange={event => setTickCount(Math.max(10, Number(event.target.value) || 10))}
                    />
                </label>
                <span className='mw-speed__count'>{is_loading ? '--' : total}</span>
            </div>

            {/* The live window. Heights are the real share of each digit. */}
            <div className='mw-speed__chart'>
                {is_loading ? (
                    <p className='mw-speed__muted'>{localize('Loading ticks...')}</p>
                ) : (
                    DIGITS.map(digit => (
                        <div className='mw-speed__bar' key={digit}>
                            <span className='mw-speed__bar-value'>{percent(digit)}%</span>
                            <div
                                className={`mw-speed__bar-fill${most.includes(digit) ? ' mw-speed__bar-fill--most' : ''}${
                                    least.includes(digit) ? ' mw-speed__bar-fill--least' : ''
                                }`}
                                style={{ height: `${total ? Math.min(100, shares[digit] * 7) : 0}%` }}
                            />
                            <span className='mw-speed__bar-digit'>{digit}</span>
                        </div>
                    ))
                )}
            </div>

            <div className='mw-speed__match-row'>
                <button
                    type='button'
                    className='mw-speed__match mw-speed__match--most'
                    onClick={() => setSelected(new Set(most))}
                >
                    {localize('Match most appearing digits')}
                </button>
                <button
                    type='button'
                    className='mw-speed__match mw-speed__match--least'
                    onClick={() => setSelected(new Set(least))}
                >
                    {localize('Match least appearing digits')}
                </button>
            </div>

            <section className='mw-speed__predictions'>
                <h2 className='mw-speed__section-title'>
                    {localize('Predictions ({{active}}/10 Active)', { active: selected.size })}
                </h2>

                <div className='mw-speed__strip mw-speed__strip--violet'>
                    <label className='mw-speed__toggle'>
                        <span>{localize('Use Default Stake:')}</span>
                        <input
                            type='checkbox'
                            checked={use_default_stake}
                            onChange={event => setUseDefaultStake(event.target.checked)}
                        />
                    </label>
                    <label className='mw-speed__field mw-speed__field--right'>
                        <span>{localize('Default Stake:')}</span>
                        <input value={default_stake} onChange={event => setDefaultStake(event.target.value)} />
                    </label>
                </div>

                <div className='mw-speed__strip mw-speed__strip--green'>
                    <label className='mw-speed__toggle'>
                        <span>{localize('Alternating Mode:')}</span>
                        <input
                            type='checkbox'
                            checked={alternating}
                            onChange={event => setAlternating(event.target.checked)}
                        />
                        <em>
                            {localize('(Most ↔ Least)')}
                            {alternating && ` - ${localize('Current')}: ${alternating_side.toUpperCase()}`}
                        </em>
                    </label>
                    <label className='mw-speed__toggle mw-speed__toggle--right'>
                        <span>{localize('Enable Entry Point:')}</span>
                        <input
                            type='checkbox'
                            checked={entry_enabled}
                            onChange={event => setEntryEnabled(event.target.checked)}
                        />
                        <em>{localize('(Wait for condition before trading)')}</em>
                    </label>
                </div>

                <div className='mw-speed__entry'>
                    <h3 className='mw-speed__entry-title'>{localize('Entry Point Configuration')}</h3>
                    <div className='mw-speed__entry-row'>
                        <label className='mw-speed__field'>
                            <span>{localize('Last N Digits:')}</span>
                            <input
                                type='number'
                                min={1}
                                max={20}
                                value={last_n}
                                onChange={event => setLastN(Math.max(1, Number(event.target.value) || 1))}
                            />
                        </label>
                        <label className='mw-speed__field'>
                            <span>{localize('What to Trade:')}</span>
                            <select
                                value={what_to_trade}
                                onChange={event => setWhatToTrade(event.target.value as 'most' | 'least')}
                                disabled={alternating}
                            >
                                <option value='most'>{localize('Most Appearing')}</option>
                                <option value='least'>{localize('Least Appearing')}</option>
                            </select>
                        </label>
                        <em className='mw-speed__hint'>
                            {localize('(Will trade {{side}} appearing)', { side: side.toUpperCase() })}
                        </em>
                    </div>

                    <div className='mw-speed__entry-state'>
                        <strong>{localize('Last {{n}} digits:', { n: last_n })}</strong>
                        <code>{last_digits.length ? last_digits.join(' ') : localize('Collecting data...')}</code>
                        <span className={`mw-speed__flag${entry_met ? ' mw-speed__flag--ok' : ''}`}>
                            {entry_met
                                ? localize('Entry condition met')
                                : localize('Entry condition NOT met - Waiting...')}
                        </span>
                    </div>
                </div>

                <div className='mw-speed__strip mw-speed__strip--amber'>
                    <label className='mw-speed__field'>
                        <span>{localize('Take Profit:')}</span>
                        <input value={take_profit} onChange={event => setTakeProfit(event.target.value)} />
                    </label>
                    <label className='mw-speed__field'>
                        <span>{localize('Stop Loss:')}</span>
                        <input value={stop_loss} onChange={event => setStopLoss(event.target.value)} />
                    </label>
                </div>

                <div className='mw-speed__grid'>
                    {DIGITS.map(digit => (
                        <div
                            className={`mw-speed__cell${selected.has(digit) ? ' mw-speed__cell--on' : ''}`}
                            key={digit}
                        >
                            <input
                                type='checkbox'
                                checked={selected.has(digit)}
                                onChange={() => toggleDigit(digit)}
                                aria-label={localize('Trade digit {{digit}}', { digit })}
                            />
                            <span className='mw-speed__cell-digit'>{digit}</span>
                            <input
                                className='mw-speed__cell-stake'
                                value={use_default_stake ? default_stake : (stakes[digit] ?? default_stake)}
                                disabled={use_default_stake}
                                onChange={event =>
                                    setStakes(previous => ({ ...previous, [digit]: event.target.value }))
                                }
                            />
                        </div>
                    ))}
                </div>

                <p className='mw-speed__total'>
                    {localize('Total Stake:')} <strong>${total_stake.toFixed(2)}</strong>
                </p>
                <p className='mw-speed__muted mw-speed__muted--center'>
                    {localize('Adjust stakes by toggling off "Use Default Stake" and editing individual values')}
                </p>

                {(notice || error_message) && (
                    <p className='mw-speed__notice' role='alert'>
                        {notice ?? error_message}
                    </p>
                )}

                <div className='mw-speed__actions'>
                    <button
                        type='button'
                        className='mw-speed__go mw-speed__go--once'
                        onClick={tradeOnce}
                        disabled={is_placing || auto_trading || selected.size === 0}
                    >
                        {localize('Trade once')}
                    </button>
                    <button
                        type='button'
                        className={`mw-speed__go ${auto_trading ? 'mw-speed__go--stop' : 'mw-speed__go--auto'}`}
                        onClick={() => {
                            setNotice(null);
                            setSessionProfit(0);
                            profit_ref.current = 0;
                            setAutoTrading(running => !running);
                        }}
                        disabled={selected.size === 0}
                    >
                        {auto_trading ? localize('Stop auto trading') : localize('Start auto trading')}
                    </button>
                </div>

                {auto_trading && (
                    <p className='mw-speed__muted mw-speed__muted--center'>
                        {localize('Session profit: {{profit}}', { profit: session_profit.toFixed(2) })}
                    </p>
                )}
            </section>
        </div>
    );
});

const SpeedBots = observer(() => {
    const [tab, setTab] = useState<TSubTab>('Matches');

    return (
        <div className='mw-speed'>
            <nav className='mw-speed__tabs'>
                {SUB_TABS.map(name => (
                    <button
                        key={name}
                        type='button'
                        className={`mw-speed__tab${tab === name ? ' mw-speed__tab--active' : ''}`}
                        onClick={() => setTab(name)}
                    >
                        {name}
                    </button>
                ))}
            </nav>

            {tab === 'Matches' ? (
                <MatchesPanel />
            ) : (
                // Named rather than shown as an empty panel: these three are not
                // built yet, and a blank screen would read as a broken one.
                <p className='mw-speed__muted mw-speed__muted--center'>
                    {localize('{{name}} is not built yet.', { name: tab })}
                </p>
            )}
        </div>
    );
});

export default SpeedBots;
