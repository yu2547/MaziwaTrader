import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { observer as globalObserver } from '@/external/bot-skeleton';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { useStore } from '@/hooks/useStore';
import { getLastDigit, toDecimalPlaces } from '@/utils/market-data/last-digit';
import { TActiveSymbol } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';
import useManualTrade from '../bulk-trader/use-manual-trade';
import './dual-edge.scss';

/** Deriv's own grouping for the volatility, jump, boom/crash and step indices. */
const RANDOM_INDEX = 'random_index';

/** Digits kept per market. The recovery rule reads seven, the strip shows two. */
const WINDOW = 12;

/** Ticks seeded per market so a rule can be read the moment the page opens. */
const SEED_TICKS = 40;

/** Gap between each market's first history request, so eighteen do not fire together. */
const STAGGER_MS = 150;

/** Every entry is one tick: these rules describe the ticks that just printed. */
const DURATION_TICKS = 1;

/** The initial rule reads the last two digits, the recovery rule the last seven. */
const INITIAL_DIGITS = 2;
const RECOVERY_DIGITS = 7;

const OVER_BARRIER = 1;
const UNDER_BARRIER = 8;

/** Trade lines kept on screen. */
const HISTORY_LIMIT = 30;

type TRow = {
    decimals: number;
    digits: number[];
    name: string;
    price: number | null;
    symbol: string;
};

type TEntry = {
    barrier: number;
    contract_type: 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD';
    kind: 'initial' | 'recovery';
};

type TTrade = {
    contract_type: string;
    id: string;
    market: string;
    profit: number | null;
    stake: number;
    time: string;
};

/**
 * The initial rule: two digits at or below 1 enters Over 1, two at or above 8
 * enters Under 8. Nothing here forecasts the next digit - it is a description
 * of the ticks that have already printed, and that is all it claims to be.
 */
const initialEntry = (digits: number[]): TEntry | null => {
    if (digits.length < INITIAL_DIGITS) return null;
    const tail = digits.slice(-INITIAL_DIGITS);
    if (tail.every(digit => digit <= OVER_BARRIER))
        return { barrier: OVER_BARRIER, contract_type: 'DIGITOVER', kind: 'initial' };
    if (tail.every(digit => digit >= UNDER_BARRIER))
        return { barrier: UNDER_BARRIER, contract_type: 'DIGITUNDER', kind: 'initial' };
    return null;
};

/**
 * The recovery rule: seven digits of one parity in a row enters that parity.
 * Written out here rather than left to the label, because it decides what gets
 * bought with real money and a reader should not have to guess at it.
 */
const recoveryEntry = (digits: number[]): TEntry | null => {
    if (digits.length < RECOVERY_DIGITS) return null;
    const tail = digits.slice(-RECOVERY_DIGITS);
    if (tail.every(digit => digit % 2 === 0)) return { barrier: 0, contract_type: 'DIGITEVEN', kind: 'recovery' };
    if (tail.every(digit => digit % 2 === 1)) return { barrier: 0, contract_type: 'DIGITODD', kind: 'recovery' };
    return null;
};

/**
 * Nexus AI: four run-length rules and no recovery leg. Each one waits for a
 * run of digits on one side of a barrier and enters that side - a longer run
 * for a barrier closer to the middle, which is the whole shape of the set.
 *
 * The hints are the labels the page prints, kept beside the rule they describe
 * so the two cannot drift apart.
 */
const NEXUS_RULES: {
    barrier: number;
    contract_type: 'DIGITOVER' | 'DIGITUNDER';
    count: number;
    hint: string;
    label: string;
    test: (digit: number) => boolean;
}[] = [
    { barrier: 1, contract_type: 'DIGITOVER', count: 3, hint: '3≤1', label: 'O1', test: digit => digit <= 1 },
    { barrier: 2, contract_type: 'DIGITOVER', count: 4, hint: '4≤2', label: 'O2', test: digit => digit <= 2 },
    { barrier: 7, contract_type: 'DIGITUNDER', count: 4, hint: '4>7', label: 'U7', test: digit => digit > 7 },
    { barrier: 8, contract_type: 'DIGITUNDER', count: 3, hint: '3>8', label: 'U8', test: digit => digit > 8 },
];

const NEXUS_SUMMARY = NEXUS_RULES.map(rule => `${rule.label} (${rule.hint})`).join(' · ');

/** The first rule whose run has completed, in the order they are listed. */
const nexusEntry = (digits: number[]): TEntry | null => {
    for (const rule of NEXUS_RULES) {
        if (digits.length < rule.count) continue;
        if (digits.slice(-rule.count).every(rule.test))
            return { barrier: rule.barrier, contract_type: rule.contract_type, kind: 'initial' };
    }
    return null;
};

/** OVER / UNDER / EVEN / ODD - the side a completed rule would enter. */
const sideLabel = (entry: TEntry) => entry.contract_type.replace('DIGIT', '');

type TMode = 'recovery' | 'nexus';

/**
 * Which rules a mode trades. Recovery Type falls back to the even/odd leg when
 * the initial one has not fired; Nexus AI has no recovery leg at all, which is
 * what "(no recovery)" in its own label means.
 */
const entryFor = (mode: TMode, digits: number[]): TEntry | null =>
    mode === 'nexus' ? nexusEntry(digits) : (initialEntry(digits) ?? recoveryEntry(digits));

const DualEdge = observer(({ initial_mode = 'recovery' }: { initial_mode?: TMode }) => {
    const { feed, isConnected } = usePublicMarketFeed();
    const { client, oauth_session } = useStore() ?? {};
    const { localize } = useTranslations();
    const trade = useManualTrade();

    const [mode, setMode] = useState<TMode>(initial_mode);
    const [symbols, setSymbols] = useState<TActiveSymbol[]>([]);
    const [rows, setRows] = useState<Record<string, TRow>>({});
    const [filter, setFilter] = useState('');

    const [running, setRunning] = useState(false);
    const [won, setWon] = useState(0);
    const [lost, setLost] = useState(0);
    const [session_pl, setSessionPl] = useState(0);
    const [current_stake, setCurrentStake] = useState(0.5);
    const [history, setHistory] = useState<TTrade[]>([]);
    const [notice, setNotice] = useState<string | null>(null);

    const [stake, setStake] = useState(0.5);
    const [take_profit, setTakeProfit] = useState(5);
    const [stop_loss, setStopLoss] = useState(30);
    const [martingale_on, setMartingaleOn] = useState(false);
    const [martingale, setMartingale] = useState(2);

    const is_logged_in = Boolean(oauth_session?.is_authenticated || client?.is_logged_in);

    // Read by the tick handlers, which are registered once per run and would
    // otherwise hold whatever these were when the subscription was taken.
    const rows_ref = useRef<Record<string, TRow>>({});
    const running_ref = useRef(false);
    const stake_ref = useRef(0.5);
    const firing_ref = useRef<Set<string>>(new Set());
    const fire_ref = useRef<(symbol: string, entry: TEntry) => void>(() => {});
    /** Contract ids this page opened, so it counts its own trades and no others. */
    const mine_ref = useRef<Map<number, { market: string; stake: number }>>(new Map());

    // Same reason as the others: the tick handlers are registered once, and the
    // rule set they judge against has to be the one selected now.
    const mode_ref = useRef<TMode>(initial_mode);

    running_ref.current = running;
    stake_ref.current = current_stake;
    mode_ref.current = mode;

    useEffect(() => {
        if (!isConnected) return;
        feed.getActiveSymbols()
            .then(list => setSymbols(list.filter(item => item.submarket === RANDOM_INDEX)))
            .catch(() => {
                // Non-fatal: the market list simply stays empty and says so.
            });
    }, [isConnected, feed]);

    /**
     * Every market streams all the time, running or not - the table is a
     * reading of the markets, not a side effect of trading. Both the seed and
     * the stream come off the feed the rest of the app already holds open.
     */
    useEffect(() => {
        if (!isConnected || !symbols.length) return undefined;

        let cancelled = false;
        const timers: ReturnType<typeof setTimeout>[] = [];
        const unsubscribes: (() => void)[] = [];

        const write = (symbol: string, row: TRow) => {
            rows_ref.current = { ...rows_ref.current, [symbol]: row };
            setRows(rows_ref.current);
        };

        symbols.forEach((item, index) => {
            const symbol = item.underlying_symbol;
            const name = item.underlying_symbol_name;

            timers.push(
                setTimeout(() => {
                    if (cancelled) return;

                    feed.getTickHistory(symbol, SEED_TICKS)
                        .then(({ pip_size, prices }) => {
                            if (cancelled) return;
                            const decimals = toDecimalPlaces(pip_size) ?? 2;
                            write(symbol, {
                                decimals,
                                digits: prices.map(price => getLastDigit(price, decimals)).slice(-WINDOW),
                                name,
                                price: prices[prices.length - 1] ?? null,
                                symbol,
                            });
                        })
                        .catch(() => {
                            // Non-fatal: the live stream fills the window instead.
                        });

                    unsubscribes.push(
                        feed.subscribeTicks(symbol, tick => {
                            if (cancelled) return;
                            const decimals = toDecimalPlaces(tick.pip_size) ?? 2;
                            const previous = rows_ref.current[symbol];
                            const digits = [...(previous?.digits ?? []), getLastDigit(tick.quote, decimals)].slice(
                                -WINDOW
                            );
                            write(symbol, { decimals, digits, name, price: tick.quote, symbol });

                            // The entry is decided on the tick that completes the
                            // rule, which is the only moment the rule describes.
                            if (!running_ref.current) return;
                            const entry = entryFor(mode_ref.current, digits);
                            if (entry) fire_ref.current(symbol, entry);
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
    }, [isConnected, feed, symbols]);

    /**
     * Buys one contract on the market whose rule just completed.
     *
     * Goes through the same placeTrades() the Manual and Bulk Trader pages use,
     * so an entry from here opens the trading connection the same way and lands
     * in the app's own Transactions and Journal. There is no second trading
     * engine behind this page.
     */
    const fire = useCallback(
        async (symbol: string, entry: TEntry) => {
            if (firing_ref.current.has(symbol)) return;
            firing_ref.current.add(symbol);
            const row = rows_ref.current[symbol];
            const size = stake_ref.current;
            try {
                await trade.placeTrades(
                    {
                        ...(entry.contract_type === 'DIGITOVER' || entry.contract_type === 'DIGITUNDER'
                            ? { barrier: entry.barrier }
                            : {}),
                        contract_type: entry.contract_type,
                        duration: DURATION_TICKS,
                        stake: size,
                        symbol,
                    },
                    1,
                    contract_id => mine_ref.current.set(contract_id, { market: row?.name ?? symbol, stake: size })
                );
            } finally {
                firing_ref.current.delete(symbol);
            }
        },
        [trade]
    );

    useEffect(() => {
        fire_ref.current = fire;
    });

    /**
     * Results come off the same bot.contract stream the run panel reads, which
     * carries every contract the app has open - so only the ids this page
     * opened are counted. Take profit and stop loss are checked here, on a
     * settled contract, because that is when the session total actually moves.
     */
    useEffect(() => {
        const onContract = (contract: Record<string, unknown>) => {
            const id = Number(contract?.contract_id);
            const own = mine_ref.current.get(id);
            if (!own || !contract?.is_sold) return;
            mine_ref.current.delete(id);

            const profit = Number(contract.profit ?? 0);
            const is_win = profit >= 0;

            if (is_win) setWon(count => count + 1);
            else setLost(count => count + 1);

            // Martingale steps the next stake up after a loss and returns to the
            // configured stake after a win. Off by default, and it only ever
            // changes the size of the next trade.
            setCurrentStake(previous =>
                is_win || !martingale_on ? stake : Number((previous * martingale).toFixed(2))
            );

            setHistory(previous =>
                [
                    {
                        contract_type: String(contract.contract_type ?? ''),
                        id: String(id),
                        market: own.market,
                        profit,
                        stake: own.stake,
                        time: new Date().toLocaleTimeString(),
                    },
                    ...previous,
                ].slice(0, HISTORY_LIMIT)
            );

            setSessionPl(previous => {
                const total = Number((previous + profit).toFixed(2));
                if (total >= take_profit) {
                    setRunning(false);
                    setNotice(localize('Take profit reached at {{total}}. The bot stopped.', { total }));
                } else if (total <= -Math.abs(stop_loss)) {
                    setRunning(false);
                    setNotice(localize('Stop loss reached at {{total}}. The bot stopped.', { total }));
                }
                return total;
            });
        };

        globalObserver.register('bot.contract', onContract);
        return () => globalObserver.unregister('bot.contract', onContract);
    }, [localize, martingale, martingale_on, stake, stop_loss, take_profit]);

    const start = () => {
        if (!is_logged_in) {
            setNotice(localize('Log in to a Deriv account to run this.'));
            return;
        }
        setNotice(null);
        setCurrentStake(stake);
        setRunning(true);
    };

    const stop = () => {
        setRunning(false);
        setNotice(null);
    };

    const list = useMemo(() => {
        const needle = filter.trim().toLowerCase();
        const all = Object.values(rows).sort((a, b) => a.name.localeCompare(b.name));
        if (!needle) return all;
        return all.filter(row => row.name.toLowerCase().includes(needle) || row.symbol.toLowerCase().includes(needle));
    }, [rows, filter]);

    const is_nexus = mode === 'nexus';
    const ready_count = list.filter(row => (is_nexus ? nexusEntry(row.digits) : initialEntry(row.digits))).length;
    const recovery_count = is_nexus ? 0 : list.filter(row => recoveryEntry(row.digits)).length;

    return (
        <div className='mw-dual'>
            <ModePills mode={mode} setMode={setMode} localize={localize} />

            <div className='mw-dual__card mw-dual__head'>
                <div>
                    <h2>{localize('Dual Edge')}</h2>
                    <p>
                        {is_nexus
                            ? `${localize('Strategy')}: ${localize('Nexus AI')} · O1, O2, U7, U8 ${localize('(no recovery)')}`
                            : localize(
                                  'Initial: Over 1 / Under 8 (last 2 digits) · Recovery: Even/Odd pattern (last 7)'
                              )}
                    </p>
                </div>
                <div className='mw-dual__chips'>
                    <span className={`mw-dual__chip${running ? ' mw-dual__chip--on' : ''}`}>
                        {running ? localize('Running') : localize('Stopped')}
                    </span>
                    <span className={`mw-dual__chip${isConnected ? ' mw-dual__chip--ok' : ''}`}>
                        {isConnected ? localize('API Connected') : localize('API Offline')}
                    </span>
                    <span className={`mw-dual__chip${symbols.length ? ' mw-dual__chip--ok' : ''}`}>
                        {symbols.length ? localize('Markets Ready') : localize('Loading Markets')}
                    </span>
                </div>
            </div>

            <div className='mw-dual__card mw-dual__stats'>
                <div>
                    <span>{localize('Won Trades')}</span>
                    <b className='mw-dual__win'>{won}</b>
                </div>
                <div>
                    <span>{localize('Lost Trades')}</span>
                    <b className='mw-dual__loss'>{lost}</b>
                </div>
                <div>
                    <span>{localize('Session P/L')}</span>
                    <b className={session_pl < 0 ? 'mw-dual__loss' : 'mw-dual__win'}>{session_pl.toFixed(2)}</b>
                </div>
                <div>
                    <span>{localize('Current Stake')}</span>
                    <b>{current_stake.toFixed(2)}</b>
                </div>
            </div>

            {/* Locked while the bot runs, so a rule can never change underneath
                a trade it is in the middle of deciding. */}
            <div className='mw-dual__card mw-dual__settings'>
                <label>
                    <span>{localize('Initial Trade Type')}</span>
                    <input readOnly value={localize('Over 1 / Under 8 (last 2 digits)')} />
                </label>
                <label>
                    <span>{is_nexus ? localize('Nexus AI') : localize('Recovery Type')}</span>
                    <input readOnly value={is_nexus ? NEXUS_SUMMARY : localize('Even/Odd pattern (last 7)')} />
                </label>
                <label>
                    <span>{localize('Stake')}</span>
                    <input
                        type='number'
                        min={0.35}
                        step={0.01}
                        value={stake}
                        disabled={running}
                        onChange={event => setStake(Math.max(0.35, Number(event.target.value) || 0.35))}
                    />
                </label>
                <label>
                    <span>{localize('TP')}</span>
                    <input
                        type='number'
                        min={0}
                        step={0.1}
                        value={take_profit}
                        disabled={running}
                        onChange={event => setTakeProfit(Math.max(0, Number(event.target.value) || 0))}
                    />
                </label>
                <label>
                    <span>{localize('SL')}</span>
                    <input
                        type='number'
                        min={0}
                        step={0.1}
                        value={stop_loss}
                        disabled={running}
                        onChange={event => setStopLoss(Math.max(0, Number(event.target.value) || 0))}
                    />
                </label>
                <label className='mw-dual__check'>
                    <span>{localize('Enable Martingale')}</span>
                    <input
                        type='checkbox'
                        checked={martingale_on}
                        disabled={running}
                        onChange={event => setMartingaleOn(event.target.checked)}
                    />
                </label>
                <label>
                    <span>{localize('Martingale')}</span>
                    <input
                        type='number'
                        min={1}
                        step={0.1}
                        value={martingale}
                        disabled={running || !martingale_on}
                        onChange={event => setMartingale(Math.max(1, Number(event.target.value) || 1))}
                    />
                </label>
            </div>

            <button
                type='button'
                className={`mw-dual__run${running ? ' mw-dual__run--stop' : ''}`}
                onClick={running ? stop : start}
                disabled={!isConnected || (!running && !symbols.length)}
            >
                {running ? localize('Stop Bot') : localize('Start Bot')}
            </button>

            {notice && <p className='mw-dual__notice'>{notice}</p>}
            {trade.error_message && <p className='mw-dual__notice mw-dual__notice--bad'>{trade.error_message}</p>}

            <section className='mw-dual__how'>
                <h3>{localize('How it works')}</h3>
                <ul>
                    <li>{localize('Monitors all volatility markets (random_index)')}</li>
                    <li>{localize('Duration: 1 tick for all trades')}</li>
                    <li>{localize('Tick-triggered execution across all active markets')}</li>
                    <li>
                        {localize(
                            'Once started it buys on its own, on every market whose rule completes, until you press Stop Bot or take profit / stop loss is reached.'
                        )}
                    </li>
                </ul>
            </section>

            {history.length > 0 && (
                <section className='mw-dual__card mw-dual__history'>
                    <h3>
                        {localize('Trade History')} ({history.length})
                    </h3>
                    <ul>
                        {history.map(item => (
                            <li key={item.id}>
                                <span>{item.time}</span>
                                <span>{item.market}</span>
                                <span>{item.contract_type}</span>
                                <span>{item.stake.toFixed(2)}</span>
                                <b className={(item.profit ?? 0) < 0 ? 'mw-dual__loss' : 'mw-dual__win'}>
                                    {(item.profit ?? 0) >= 0 ? '+' : ''}
                                    {(item.profit ?? 0).toFixed(2)}
                                </b>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <section className='mw-dual__card mw-dual__markets'>
                <header>
                    <div>
                        <h3>
                            {localize('Active Markets')} ({list.length}/{symbols.length})
                        </h3>
                        <p>
                            {is_nexus
                                ? localize('Ready: {{ready}}', { ready: ready_count })
                                : localize('Ready: {{ready}} · Recovery pattern: {{recovery}}', {
                                      ready: ready_count,
                                      recovery: recovery_count,
                                  })}
                        </p>
                    </div>
                    <input
                        type='text'
                        placeholder={localize('Filter by market or symbol')}
                        value={filter}
                        onChange={event => setFilter(event.target.value)}
                        aria-label={localize('Filter markets')}
                    />
                </header>

                {list.length === 0 ? (
                    <p className='mw-dual__waiting'>{localize('Waiting for market data...')}</p>
                ) : (
                    <ul className='mw-dual__rows'>
                        {list.map(row => {
                            const entry = entryFor(mode, row.digits);
                            return (
                                <li key={row.symbol} className={entry ? 'mw-dual__row--hit' : undefined}>
                                    <span className='mw-dual__row-name'>{row.name}</span>
                                    <span className='mw-dual__row-price'>
                                        {row.price === null ? '--' : row.price.toFixed(row.decimals)}
                                    </span>
                                    <span className='mw-dual__row-digits'>
                                        {row.digits.slice(-INITIAL_DIGITS).join('') || '--'}
                                    </span>
                                    <span className={`mw-dual__row-state${entry ? ' mw-dual__win' : ''}`}>
                                        {entry ? sideLabel(entry) : '—'}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>
        </div>
    );
});

const ModePills = ({
    localize,
    mode,
    setMode,
}: {
    localize: (text: string) => string;
    mode: TMode;
    setMode: (mode: TMode) => void;
}) => (
    <div className='mw-dual__pills'>
        <button
            type='button'
            className={`mw-dual__pill${mode === 'recovery' ? ' mw-dual__pill--on' : ''}`}
            onClick={() => setMode('recovery')}
        >
            {localize('Recovery Type')}
        </button>
        <button
            type='button'
            className={`mw-dual__pill${mode === 'nexus' ? ' mw-dual__pill--on' : ''}`}
            onClick={() => setMode('nexus')}
        >
            {localize('Nexus AI')}
        </button>
    </div>
);

export default DualEdge;
