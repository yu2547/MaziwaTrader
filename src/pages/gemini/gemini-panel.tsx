import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { observer as globalObserver } from '@/external/bot-skeleton';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { useStore } from '@/hooks/useStore';
import useManualTrade from '@/pages/bulk-trader/use-manual-trade';
import { getLastDigit, toDecimalPlaces } from '@/utils/market-data/last-digit';
import { TActiveSymbol } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';
import {
    chooseMarket,
    GEMINI_FAMILIES,
    isDigitFamily,
    rankMarkets,
    readWindow,
    TGeminiCandidate,
    TGeminiFamily,
    TGeminiWindow,
} from './gemini-engine';
import './gemini.scss';

/**
 * Gemini: a trading assistant that reads every volatility market at once,
 * says which one it is on, and buys there on its own until it is stopped.
 *
 * It is not a second trading engine. Entries go through the same
 * placeTrades() the Manual, Bulk Trader and Pro AI pages use, so a contract
 * opened here uses the app's own connection, lands in the app's own
 * Transactions and Journal, and is subject to the same account checks. The
 * market data is the public feed the rest of the app already holds open - the
 * same one the Analysis Tool reads - and nothing on this panel is simulated.
 *
 * Launching it spends real money without asking again. That is what the
 * control says on its face, and the panel says it in words next to the button.
 */

/** Volatility indices only - the digit families are meaningless on the rest. */
const VOLATILITY_SYMBOL = /^(R_\d+|1HZ\d+V)$/;

/** Ticks held per market. Comfortably past signal-quality's MIN_SAMPLE of 500. */
const WINDOW = 1000;

/** Digits shown in the Live Market Data strip. */
const STRIP = 9;

/** Gap between each market's history request, so a dozen do not fire together. */
const STAGGER_MS = 180;

/** Contracts are one tick: the window describes the ticks that just printed. */
const DURATION_TICKS = 1;

/** The least time between two spoken lines, however fast the leader changes. */
const SPEAK_GAP_MS = 10000;

/** How many settled contracts the panel keeps on screen. */
const HISTORY_LIMIT = 12;

/** How long Gemini waits after a refused buy before it reads the markets again. */
const REFUSAL_WAIT_MS = 5000;

/** Refused buys in a row that stop Gemini outright. */
const MAX_REFUSALS = 3;

const MIN_STAKE = 0.35;

type TMarketWindow = TGeminiWindow & {
    decimals: number;
    name: string;
    symbol: string;
};

type TSettled = {
    entry: string;
    id: number;
    market: string;
    profit: number;
    time: string;
};

const GeminiPanel = observer(({ onClose }: { onClose: () => void }) => {
    const { feed, isConnected } = usePublicMarketFeed();
    const { client, oauth_session } = useStore() ?? {};
    const { localize } = useTranslations();
    const trade = useManualTrade();

    const [symbols, setSymbols] = useState<TActiveSymbol[]>([]);
    const [windows, setWindows] = useState<Record<string, TMarketWindow>>({});

    const [family, setFamily] = useState<TGeminiFamily>('digits_over');
    // 'auto' is the behaviour the panel is built around: read them all, take
    // the best. A named market pins it there instead.
    const [choice, setChoice] = useState<string>('auto');
    const [stake, setStake] = useState(MIN_STAKE);

    const [running, setRunning] = useState(false);
    // Already in the reader's language when it is put here, rather than being
    // translated on the way out: the lines carry measured numbers, so each one
    // is built by localize() at the point the numbers are known.
    const [status, setStatus] = useState<{ kind: 'idle' | 'working' | 'entry' | 'error'; text: string } | null>(null);
    const [active, setActive] = useState<TGeminiCandidate | null>(null);
    const [won, setWon] = useState(0);
    const [lost, setLost] = useState(0);
    const [ticks, setTicks] = useState(0);
    const [history, setHistory] = useState<TSettled[]>([]);
    const [speaking, setSpeaking] = useState(false);

    // The tick handlers are registered once per run and have to see the
    // windows as they are now, not as they were when the subscription was taken.
    const windows_ref = useRef<Record<string, TMarketWindow>>({});
    // Contracts this panel opened, so the shared bot.contract stream - which
    // carries every contract the app has open - is only counted for its own.
    const mine_ref = useRef<Map<number, { entry: string; market: string }>>(new Map());
    // One contract at a time. Several ticks arriving in the same instant would
    // otherwise each fire their own.
    const in_flight_ref = useRef(false);
    // Read by the tick handlers for the same reason as windows_ref, and this is
    // the one that matters: stopping has to take effect on the very next tick,
    // not when the run happens to be rebuilt.
    const running_ref = useRef(false);
    running_ref.current = running;
    const decide_ref = useRef<() => void>(() => {});
    const spoken_ref = useRef<{ at: number; key: string }>({ at: 0, key: '' });
    // Refused buys in a row, and when the wait after the last one ends.
    const refusals_ref = useRef(0);
    const cooldown_until_ref = useRef(0);

    const is_logged_in = Boolean(oauth_session?.is_authenticated || client?.is_logged_in);
    const currency = oauth_session?.currency || (is_logged_in && (client?.currency as string)) || 'USD';

    useEffect(() => {
        if (!isConnected) return;
        feed.getActiveSymbols()
            .then(list => setSymbols(list.filter(item => VOLATILITY_SYMBOL.test(item.underlying_symbol))))
            .catch(() => {
                // Non-fatal: the panel stays on its waiting line.
            });
    }, [isConnected, feed]);

    /**
     * Every market, seeded from history and then kept current from the live
     * stream. Both come off the feed the rest of the app already holds open -
     * no second socket, and no market data that was not measured.
     *
     * This runs whether or not Gemini is trading, so the Live Market Data card
     * is populated before anyone launches it and the first decision is made on
     * a full window rather than on the handful of ticks since the press.
     */
    useEffect(() => {
        if (!isConnected || !symbols.length) return undefined;

        let cancelled = false;
        const timers: ReturnType<typeof setTimeout>[] = [];
        const unsubscribes: (() => void)[] = [];

        const write = (symbol: string, market: TMarketWindow) => {
            windows_ref.current = { ...windows_ref.current, [symbol]: market };
            setWindows(windows_ref.current);
        };

        symbols.forEach((item, index) => {
            const symbol = item.underlying_symbol;
            const name = item.underlying_symbol_name;

            timers.push(
                setTimeout(() => {
                    if (cancelled) return;

                    feed.getTickHistory(symbol, WINDOW)
                        .then(({ pip_size, prices }) => {
                            if (cancelled) return;
                            const decimals = toDecimalPlaces(pip_size) ?? 2;
                            write(symbol, {
                                decimals,
                                digits: prices.map(price => getLastDigit(price, decimals)),
                                name,
                                prices,
                                symbol,
                            });
                        })
                        .catch(() => {
                            // Non-fatal: this market simply has nothing to read
                            // yet, and ranks nowhere until it does.
                        });

                    unsubscribes.push(
                        feed.subscribeTicks(symbol, tick => {
                            if (cancelled) return;
                            const previous = windows_ref.current[symbol];
                            if (!previous) return;
                            const decimals = toDecimalPlaces(tick.pip_size) ?? previous.decimals;
                            write(symbol, {
                                ...previous,
                                decimals,
                                digits: [...previous.digits, getLastDigit(tick.quote, decimals)].slice(-WINDOW),
                                prices: [...previous.prices, tick.quote].slice(-WINDOW),
                            });
                            if (running_ref.current) {
                                setTicks(count => count + 1);
                                decide_ref.current();
                            }
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

    const list = useMemo(() => Object.values(windows).sort((a, b) => a.name.localeCompare(b.name)), [windows]);

    /**
     * The market the strip and the counters describe.
     *
     * The one Gemini is on, or the one that was picked by hand - and before
     * either exists, whichever market currently reads strongest. That last case
     * is what fills the card in before anyone launches anything: on Auto with
     * nothing running there is no chosen market, and leaving it blank made the
     * live panel look broken while the feed was in fact streaming.
     */
    const leader = useMemo(
        () =>
            rankMarkets(
                family,
                list.map(item => ({ name: item.name, symbol: item.symbol, window: item }))
            )[0] ?? null,
        [family, list]
    );
    const shown = active?.symbol ?? (choice === 'auto' ? (leader?.symbol ?? null) : choice);
    const shown_window = shown ? windows[shown] : null;
    const shown_reading = shown_window ? readWindow(family, shown_window) : null;

    /**
     * Says which market Gemini has moved to, out loud.
     *
     * Only on a change of market or of entry, and never more often than
     * SPEAK_GAP_MS however fast those change - a leader that swaps every few
     * ticks would otherwise talk over itself. The speaking flag is driven by
     * the utterance's own start and end rather than by a timer guessing at them.
     */
    const announce = useCallback(
        (candidate: TGeminiCandidate) => {
            const synth = window.speechSynthesis;
            if (!synth) return;
            const key = `${candidate.symbol}|${candidate.reading.entry}`;
            const now = Date.now();
            if (key === spoken_ref.current.key || now - spoken_ref.current.at < SPEAK_GAP_MS) return;
            spoken_ref.current = { at: now, key };

            const utterance = new SpeechSynthesisUtterance(
                localize('Best market: {{market}}. Entry {{entry}}, at {{pct}} percent of the last {{n}} ticks.', {
                    entry: candidate.reading.entry,
                    market: candidate.name,
                    n: candidate.reading.n,
                    pct: candidate.reading.pct.toFixed(1),
                })
            );
            utterance.rate = 0.98;
            utterance.onstart = () => setSpeaking(true);
            utterance.onend = () => setSpeaking(false);
            utterance.onerror = () => setSpeaking(false);
            synth.speak(utterance);
        },
        [localize]
    );

    /**
     * A buy that Deriv refused, or that never got an answer.
     *
     * Nothing is open afterwards, so the loop has to be freed - but not straight
     * back into the next tick. With every volatility market streaming, that is
     * many refused requests a second, and a refusal like insufficient balance
     * would repeat forever. It waits REFUSAL_WAIT_MS instead, and a run of
     * MAX_REFUSALS in a row stops Gemini outright: at that point the cause is
     * not a passing price move, and carrying on would only hide it. Deriv's own
     * reason stays on screen either way (the error line under the status).
     */
    const onRefused = useCallback(() => {
        in_flight_ref.current = false;
        refusals_ref.current += 1;
        if (refusals_ref.current >= MAX_REFUSALS) {
            setRunning(false);
            setActive(null);
            window.speechSynthesis?.cancel();
            setStatus({
                kind: 'error',
                text: localize('Gemini stopped after {{count}} refused trades in a row.', { count: MAX_REFUSALS }),
            });
            return;
        }
        cooldown_until_ref.current = Date.now() + REFUSAL_WAIT_MS;
        setStatus({
            kind: 'error',
            text: localize('Trade refused. Gemini waits {{seconds}} seconds, then reads the markets again.', {
                seconds: REFUSAL_WAIT_MS / 1000,
            }),
        });
    }, [localize]);

    /**
     * One pass of the loop, run on every tick while Gemini is on: rank the
     * markets, decide which one to be on, and buy there if its window still
     * reads the way it did when it was picked.
     *
     * Held in a ref and rebuilt every render because the tick subscriptions are
     * registered once per run and would otherwise keep whichever version of
     * this function existed at that moment - including a stale stake.
     */
    const decide = useCallback(() => {
        if (!running_ref.current || in_flight_ref.current) return;
        // Still waiting out a refusal - see onRefused.
        if (Date.now() < cooldown_until_ref.current) return;

        const pool =
            choice === 'auto'
                ? Object.values(windows_ref.current)
                : Object.values(windows_ref.current).filter(item => item.symbol === choice);
        const ranked = rankMarkets(
            family,
            pool.map(item => ({ name: item.name, symbol: item.symbol, window: item }))
        );
        const picked = chooseMarket(ranked, active?.symbol ?? null);

        if (!picked) {
            setActive(null);
            setStatus({
                kind: 'working',
                text: localize('Analysing every market. No window is clear of uniform yet.'),
            });
            return;
        }

        setActive(picked);
        announce(picked);
        setStatus({
            kind: 'entry',
            text: localize('{{market}}: {{entry}} at {{pct}}% of the last {{n}} ticks. Buying.', {
                entry: picked.reading.entry,
                market: picked.name,
                n: picked.reading.n,
                pct: picked.reading.pct.toFixed(1),
            }),
        });

        in_flight_ref.current = true;
        trade
            .placeTrades(
                {
                    ...(picked.reading.barrier === undefined ? {} : { barrier: picked.reading.barrier }),
                    contract_type: picked.reading.contract_type,
                    duration: DURATION_TICKS,
                    stake,
                    symbol: picked.symbol,
                },
                1,
                contract_id => mine_ref.current.set(contract_id, { entry: picked.reading.entry, market: picked.name })
            )
            .then(opened => {
                if (opened === 0) {
                    onRefused();
                    return;
                }
                refusals_ref.current = 0;
            })
            .catch(onRefused);
    }, [active, announce, choice, family, localize, onRefused, stake, trade]);

    useEffect(() => {
        decide_ref.current = decide;
    });

    /**
     * Results come off the same bot.contract stream the run panel reads, which
     * carries every contract the app has open - so only the ids this panel
     * opened are counted.
     */
    useEffect(() => {
        const onContract = (contract: Record<string, unknown>) => {
            const id = Number(contract?.contract_id);
            const own = mine_ref.current.get(id);
            if (!own || !contract?.is_sold) return;
            mine_ref.current.delete(id);
            in_flight_ref.current = false;

            const profit = Number(contract.profit ?? 0);
            if (profit >= 0) setWon(count => count + 1);
            else setLost(count => count + 1);

            setHistory(previous =>
                [
                    {
                        entry: own.entry,
                        id,
                        market: own.market,
                        profit,
                        time: new Date().toLocaleTimeString(),
                    },
                    ...previous,
                ].slice(0, HISTORY_LIMIT)
            );
        };

        globalObserver.register('bot.contract', onContract);
        return () => globalObserver.unregister('bot.contract', onContract);
    }, []);

    // Stops mid-sentence when the panel closes, rather than talking over a page
    // the trader has already left.
    useEffect(
        () => () => {
            window.speechSynthesis?.cancel();
        },
        []
    );

    const launch = () => {
        if (!is_logged_in) {
            setStatus({ kind: 'error', text: localize('Log in to a Deriv account before launching Gemini.') });
            return;
        }
        mine_ref.current.clear();
        in_flight_ref.current = false;
        spoken_ref.current = { at: 0, key: '' };
        refusals_ref.current = 0;
        cooldown_until_ref.current = 0;
        setWon(0);
        setLost(0);
        setTicks(0);
        setHistory([]);
        setActive(null);
        setStatus({ kind: 'working', text: localize('Analysing every market.') });
        setRunning(true);
    };

    // Stopping takes the permission away at once - running_ref is read by the
    // tick handlers on the very next tick - but it cannot unwind a contract
    // that is already open, and does not pretend to.
    const stop = () => {
        setRunning(false);
        setActive(null);
        window.speechSynthesis?.cancel();
        setStatus({ kind: 'idle', text: localize('Gemini stopped. Contracts already open are left to settle.') });
    };

    const family_label = GEMINI_FAMILIES.find(item => item.id === family)?.label ?? '';
    const strip = shown_window ? shown_window.digits.slice(-STRIP) : [];
    const last_digit = strip.length ? strip[strip.length - 1] : null;

    return (
        <div className='mw-gem' role='dialog' aria-modal='true' aria-label={localize('Gemini')}>
            <button type='button' className='mw-gem__backdrop' onClick={onClose} aria-label={localize('Close')} />
            <section className='mw-gem__sheet'>
                <header className='mw-gem__head'>
                    <span className={`mw-gem__mark${speaking ? ' mw-gem__mark--speaking' : ''}`} aria-hidden='true' />
                    <span className='mw-gem__title'>
                        <b>{localize('Gemini')}</b>
                        <i>{localize('AI TRADING ASSISTANT')}</i>
                    </span>
                    <button type='button' className='mw-gem__close' onClick={onClose} aria-label={localize('Close')}>
                        &times;
                    </button>
                </header>

                <div className='mw-gem__body'>
                    <div className='mw-gem__card'>
                        <h3 className='mw-gem__card-title'>{localize('Trading Configuration')}</h3>

                        <label className='mw-gem__field'>
                            <span>{localize('SYMBOL')}</span>
                            <select value={choice} disabled={running} onChange={event => setChoice(event.target.value)}>
                                <option value='auto'>
                                    {localize('Auto - scan every market ({{count}})', { count: list.length })}
                                </option>
                                {list.map(item => (
                                    <option key={item.symbol} value={item.symbol}>
                                        {item.name}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className='mw-gem__field'>
                            <span>{localize('TRADE TYPE')}</span>
                            <select
                                value={family}
                                disabled={running}
                                onChange={event => setFamily(event.target.value as TGeminiFamily)}
                            >
                                {GEMINI_FAMILIES.map(item => (
                                    <option key={item.id} value={item.id}>
                                        {localize(item.label)}
                                    </option>
                                ))}
                            </select>
                        </label>

                        {/* What the barrier will be is read off the window, not
                            chosen here - so it is reported rather than offered. */}
                        <p className='mw-gem__auto'>
                            {isDigitFamily(family) && (family === 'digits_over' || family === 'digits_under')
                                ? localize('Gemini picks the barrier: currently {{entry}}.', {
                                      entry: shown_reading?.entry ?? '--',
                                  })
                                : localize('Fixed entry: {{entry}}.', { entry: shown_reading?.entry ?? family_label })}
                        </p>

                        <label className='mw-gem__field'>
                            <span>{localize('STAKE')}</span>
                            <input
                                type='number'
                                min={MIN_STAKE}
                                step={0.01}
                                value={stake}
                                disabled={running}
                                onChange={event =>
                                    setStake(Math.max(MIN_STAKE, Number(event.target.value) || MIN_STAKE))
                                }
                            />
                        </label>

                        <button
                            type='button'
                            className={`mw-gem__launch${running ? ' mw-gem__launch--stop' : ''}`}
                            onClick={running ? stop : launch}
                            disabled={!isConnected || (!running && !list.length)}
                        >
                            {running ? localize('STOP GEMINI') : localize('LAUNCH GEMINI')}
                        </button>

                        {/* Said plainly rather than left to be discovered. */}
                        <p className='mw-gem__warn'>
                            {running
                                ? localize(
                                      'Running. Every entry buys {{stake}} {{currency}} on the market Gemini has picked, without asking again.',
                                      { currency, stake: stake.toFixed(2) }
                                  )
                                : localize(
                                      'Launching buys real contracts on your account on its own, one at a time, until you press stop. Nothing here predicts the next tick.'
                                  )}
                        </p>

                        <p className={`mw-gem__status mw-gem__status--${status?.kind ?? 'idle'}`}>
                            {status?.text ?? localize('Ready - choose a trade type and launch Gemini.')}
                        </p>

                        {/* Deriv's own reason for the last refusal, in its words
                            rather than a summary of them - on a line of its own
                            so Gemini's status above can say what it is doing
                            about it without replacing it. Cleared by the trade
                            hook when the next buy goes out. */}
                        {trade.error_message && (
                            <p className='mw-gem__status mw-gem__status--error'>{trade.error_message}</p>
                        )}
                    </div>

                    <div className='mw-gem__card'>
                        <h3 className='mw-gem__card-title'>
                            {localize('Live Market Data')}
                            <span className={`mw-gem__live${isConnected ? ' mw-gem__live--on' : ''}`}>
                                {localize('LIVE')}
                            </span>
                        </h3>

                        <p className='mw-gem__market'>
                            {shown_window
                                ? shown_window.name
                                : localize('No market selected yet - Gemini picks one as it reads them.')}
                        </p>

                        <div className='mw-gem__strip'>
                            {strip.length === 0 ? (
                                <span className='mw-gem__strip-empty'>{localize('Waiting for ticks...')}</span>
                            ) : (
                                strip.map((digit, index) => (
                                    <span
                                        key={`${shown ?? 'none'}-${index}`}
                                        className={`mw-gem__digit${digit % 2 === 0 ? ' mw-gem__digit--even' : ''}${
                                            index === strip.length - 1 ? ' mw-gem__digit--last' : ''
                                        }`}
                                    >
                                        {digit}
                                    </span>
                                ))
                            )}
                        </div>

                        <div className='mw-gem__counters'>
                            <div>
                                <span>{localize('LAST DIGIT')}</span>
                                <b>{last_digit === null ? '--' : last_digit}</b>
                            </div>
                            <div>
                                <span>{localize('WINS')}</span>
                                <b>{won}</b>
                            </div>
                            <div>
                                <span>{localize('LOSSES')}</span>
                                <b>{lost}</b>
                            </div>
                            <div>
                                <span>{localize('TICKS PROCESSED')}</span>
                                <b>{ticks}</b>
                            </div>
                        </div>
                    </div>

                    <div className='mw-gem__card'>
                        <h3 className='mw-gem__card-title'>{localize('Recent Contracts')}</h3>
                        {history.length === 0 ? (
                            <div className='mw-gem__empty'>
                                <b>{localize('No contracts yet')}</b>
                                <p>{localize('Launch Gemini to see its contracts here.')}</p>
                            </div>
                        ) : (
                            <ul className='mw-gem__rows'>
                                {history.map(item => (
                                    <li key={item.id} className='mw-gem__row'>
                                        <span className='mw-gem__row-market'>{item.market}</span>
                                        <span className='mw-gem__row-entry'>{item.entry}</span>
                                        <span className='mw-gem__row-time'>{item.time}</span>
                                        <b className={item.profit < 0 ? 'mw-gem__loss' : 'mw-gem__win'}>
                                            {item.profit >= 0 ? '+' : ''}
                                            {item.profit.toFixed(2)}
                                        </b>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </section>
        </div>
    );
});

export default GeminiPanel;
