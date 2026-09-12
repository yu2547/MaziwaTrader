import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { redirectToLogin } from '@/components/shared';
import { observer as globalObserver } from '@/external/bot-skeleton';
import { V2GetActiveToken } from '@/external/bot-skeleton/services/api/appId';
import usePublicMarketFeed from '@/hooks/usePublicMarketFeed';
import { useStore } from '@/hooks/useStore';
import { getStoredAccessToken } from '@/utils/auth/deriv-oauth';
import { getLastDigit, toDecimalPlaces } from '@/utils/market-data/last-digit';
import { TActiveSymbol, TContractForSymbol } from '@/utils/market-data/public-market-feed';
import { useTranslations } from '@deriv-com/translations';
import useManualTrade from '../bulk-trader/use-manual-trade';
import DigitCircles from './digit-circles';
import MarketSelect from './market-select';
import PositionsPanel, { TPosition } from './positions-panel';
import PriceChart from './price-chart';
import TradeIcon from './trade-icon';
import {
    DEFAULT_PARAMS,
    digitBounds,
    durationBounds,
    findTradeType,
    GROWTH_RATES,
    MULTIPLIERS,
    TRADE_DESCRIPTIONS,
    TRADE_TYPES,
    TTradeParams,
} from './trade-types';
import TradeTypesPanel from './trade-types-panel';
import useTradeProposal from './use-trade-proposal';
import ValuePicker from './value-picker';
import './dtrader.scss';

const DEFAULT_SYMBOL = '1HZ100V';
const DIGIT_WINDOW = 1000;

// The values Deriv puts on its own pads. Anything outside what the contract
// allows is dropped from the pad rather than offered and then refused.
const MINUTE_PRESETS = [1, 2, 3, 5, 10, 15, 30, 60];

const DIGITS = Array.from({ length: 10 }, (_, digit) => digit);

const DTrader = observer(() => {
    const { feed, isConnected } = usePublicMarketFeed();
    const { client, oauth_session, run_panel } = useStore() ?? {};
    const { localize } = useTranslations();
    const trade = useManualTrade();

    const [symbols, setSymbols] = useState<TActiveSymbol[]>([]);
    const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
    const [contracts_for, setContractsFor] = useState<TContractForSymbol[]>([]);
    const [type_id, setTypeId] = useState('rise_fall');
    const [params, setParams] = useState<TTradeParams>(DEFAULT_PARAMS);

    const [prices, setPrices] = useState<number[]>([]);
    const [epochs, setEpochs] = useState<number[]>([]);
    const [decimals, setDecimals] = useState(2);
    const [positions, setPositions] = useState<TPosition[]>([]);
    const [is_positions_collapsed, setIsPositionsCollapsed] = useState(false);
    const [bought, setBought] = useState<string | null>(null);
    const [is_types_open, setIsTypesOpen] = useState(false);
    const [is_learn_open, setIsLearnOpen] = useState(false);
    /** Phone only: the chart and the digit rings share one slot, as on Deriv. */
    const [stage, setStage] = useState<'chart' | 'digits'>('digits');

    const type = findTradeType(type_id);
    const is_logged_in = Boolean(oauth_session?.is_authenticated || client?.is_logged_in);
    const has_session = is_logged_in || Boolean(getStoredAccessToken() || V2GetActiveToken());
    const currency = oauth_session?.currency || (is_logged_in && (client?.currency as string)) || 'USD';

    /**
     * Both sides, priced at once and re-priced on their own, because both are
     * on screen and both are buyable - the way Deriv's own ticket works. A
     * contract with one side (an accumulator) leaves the second off rather
     * than pricing the same thing twice.
     */
    const has_two_sides = type.sides.length > 1;
    const quote_up = useTradeProposal({ currency, params, side_index: 0, symbol, type });
    const quote_down = useTradeProposal({ currency, enabled: has_two_sides, params, side_index: 1, symbol, type });
    const quotes = useMemo(() => [quote_up, quote_down], [quote_up, quote_down]);

    const update = useCallback((patch: Partial<TTradeParams>) => setParams(current => ({ ...current, ...patch })), []);

    // Turbos have to be priced from one of the payouts per point Deriv offers,
    // and it only names them when it turns one down - so the first quote comes
    // back as a refusal carrying the list, and the ticket settles on the
    // middle of it rather than leaving the trader with an error to read.
    const offered_payouts_per_point = quote_up.offered_payouts_per_point;
    useEffect(() => {
        if (!offered_payouts_per_point.length) return;
        setParams(current =>
            offered_payouts_per_point.includes(current.payout_per_point)
                ? current
                : {
                      ...current,
                      payout_per_point: offered_payouts_per_point[Math.floor(offered_payouts_per_point.length / 2)],
                  }
        );
    }, [offered_payouts_per_point]);

    useEffect(() => {
        if (!isConnected) return;
        feed.getActiveSymbols()
            .then(list => setSymbols(list.filter(item => item.is_trading_suspended === 0)))
            .catch(() => {
                // Non-fatal: the selector keeps the market it is on.
            });
    }, [isConnected, feed]);

    // What this market can be traded as, straight from Deriv - it decides
    // which types are offered here rather than a list of our own.
    useEffect(() => {
        if (!isConnected) return;
        setContractsFor([]);
        feed.getContractsFor(symbol)
            .then(setContractsFor)
            .catch(() => {
                // Leaving it empty offers every type; a wrong one is refused at
                // pricing, with Deriv's reason on screen.
            });
    }, [isConnected, feed, symbol]);

    // Price history and the live stream, on the feed the app already holds
    // open. One window serves the spot, the change and the digit rings.
    const request_id = useRef(0);
    useEffect(() => {
        if (!isConnected) return undefined;
        const id = ++request_id.current;
        setPrices([]);
        setEpochs([]);

        feed.getTickHistory(symbol, DIGIT_WINDOW)
            .then(({ pip_size, prices: history, times }) => {
                if (id !== request_id.current) return;
                setDecimals(toDecimalPlaces(pip_size) ?? 2);
                setPrices(history);
                setEpochs(times);
            })
            .catch(() => {
                // Non-fatal: the live stream fills the window on its own.
            });

        return feed.subscribeTicks(symbol, tick => {
            if (id !== request_id.current) return;
            setDecimals(toDecimalPlaces(tick.pip_size) ?? 2);
            setPrices(current => [...current, tick.quote].slice(-DIGIT_WINDOW));
            setEpochs(current => [...current, tick.epoch].slice(-DIGIT_WINDOW));
        });
    }, [isConnected, feed, symbol]);

    /**
     * Contracts bought from this page, followed on the same stream the rest of
     * the app reads. Registered once and reading its own id set from a ref,
     * so a bot running elsewhere cannot end up in this panel.
     */
    const own_contracts = useRef(new Set<number>());
    useEffect(() => {
        const onContract = (contract: Record<string, unknown>) => {
            const contract_id = Number(contract.contract_id);
            if (!own_contracts.current.has(contract_id)) return;
            setPositions(current =>
                current.map(position =>
                    position.contract_id === contract_id
                        ? {
                              ...position,
                              buy_price: Number(contract.buy_price ?? position.buy_price ?? 0),
                              currency: (contract.currency as string) ?? position.currency,
                              display_name: (contract.display_name as string) ?? position.display_name,
                              is_sold: Boolean(contract.is_sold),
                              profit: Number(contract.profit ?? position.profit ?? 0),
                          }
                        : position
                )
            );
        };
        globalObserver.register('bot.contract', onContract);
        return () => globalObserver.unregister('bot.contract', onContract);
    }, []);

    const digits = useMemo(() => prices.map(price => getLastDigit(price, decimals)), [prices, decimals]);
    const distribution = useMemo(() => {
        const counts = Array.from({ length: 10 }, () => 0);
        digits.forEach(digit => {
            counts[digit] += 1;
        });
        const total = digits.length || 1;
        return counts.map(count => (count / total) * 100);
    }, [digits]);

    const price = prices.length ? prices[prices.length - 1] : null;
    const change = prices.length > 1 ? prices[prices.length - 1] - prices[prices.length - 2] : null;
    const latest_digit = digits.length ? digits[digits.length - 1] : null;

    const supported = useMemo(() => {
        if (!contracts_for.length) return null;
        return new Set(contracts_for.map(contract => contract.contract_category));
    }, [contracts_for]);

    // Markets do not all offer the same contracts - Deriv sells only
    // accumulators and multipliers on the Boom indices, for instance - so
    // moving to one that cannot trade the type you are on lands on a type it
    // can trade, rather than on a ticket whose only possible answer is a
    // refusal.
    useEffect(() => {
        if (!supported || supported.has(type.category)) return;
        const next = TRADE_TYPES.find(item => supported.has(item.category));
        if (next) setTypeId(next.id);
    }, [supported, type.category]);

    const proposal = quote_up.proposal;
    const details = proposal?.contract_details;
    const limits = proposal?.validation_params;

    // Deriv's own stake limits for the contract as it currently stands, which
    // differ by family - 0.35 on a digit, 1.00 on an accumulator, and a
    // ceiling that moves with the market.
    const stake_limits = {
        max: limits?.stake?.max ? Number(limits.stake.max) : undefined,
        min: limits?.stake?.min ? Number(limits.stake.min) : 0.35,
    };

    const durationLabel = (amount: number, unit: string) => {
        if (unit === 'm') return amount === 1 ? localize('1 minute') : localize('{{count}} minutes', { count: amount });
        return amount === 1 ? localize('1 tick') : localize('{{count}} ticks', { count: amount });
    };

    const bounds = useMemo(() => durationBounds(contracts_for, type), [contracts_for, type]);
    const duration_bounds = (params.duration_unit === 'm' ? bounds.minutes : bounds.ticks) ?? { max: 10, min: 1 };

    // A duration carried over from another market or another contract may not
    // be one this one offers, and the only answer Deriv can give then is
    // "Trading is not offered for this duration." This snaps it into range
    // instead, so changing market leaves a ticket that prices.
    useEffect(() => {
        setParams(current => {
            const unit = bounds.units.includes(current.duration_unit) ? current.duration_unit : bounds.units[0];
            const limit = unit === 'm' ? bounds.minutes : bounds.ticks;
            if (!unit || !limit) return current;
            const duration = Math.min(limit.max, Math.max(limit.min, current.duration));
            if (unit === current.duration_unit && duration === current.duration) return current;
            return { ...current, duration, duration_unit: unit };
        });
    }, [bounds]);

    /**
     * The digit this side will not take. Deriv refuses DIGITOVER 9 and
     * DIGITUNDER 0 outright, so the button says so and stays out rather than
     * sending a contract that can only come back refused - and the other side
     * remains buyable while it does.
     */
    const digitError = (side_index: number) => {
        const range = digitBounds(type, side_index);
        if (!range || (params.digit >= range.min && params.digit <= range.max)) return null;
        return localize('Digit must be in the range of {{min}} to {{max}}.', { max: range.max, min: range.min });
    };

    /** Deriv's payout on its own stake, which is what its own buttons carry. */
    const profitPercent = (payout?: number) => {
        if (!payout || !params.stake) return null;
        return `${(((payout - params.stake) / params.stake) * 100).toFixed(2)}%`;
    };

    const stepStake = (delta: number) => {
        const next = Math.round((params.stake + delta) * 100) / 100;
        update({
            stake: Math.min(stake_limits.max ?? Number.MAX_SAFE_INTEGER, Math.max(stake_limits.min, next)),
        });
    };

    /** Buys exactly what was quoted on that side - the priced request, sent to be bought. */
    const buy = async (side_index: number) => {
        setBought(null);
        if (!has_session) {
            redirectToLogin(false);
            return;
        }

        const { request } = quotes[side_index];
        const opened = await trade.placeTrades(
            {
                barrier: request.barrier as string | undefined,
                contract_type: request.contract_type as string,
                duration: request.duration as number | undefined,
                duration_unit: request.duration_unit as string | undefined,
                growth_rate: request.growth_rate as number | undefined,
                limit_order: request.limit_order as Record<string, number> | undefined,
                multiplier: request.multiplier as number | undefined,
                payout_per_point: request.payout_per_point as string | undefined,
                stake: params.stake,
                symbol,
            },
            1,
            contract_id => {
                own_contracts.current.add(contract_id);
                setPositions(current => [
                    {
                        contract_id,
                        currency,
                        display_name: symbols.find(item => item.underlying_symbol === symbol)?.underlying_symbol_name,
                        trade_label: `${localize(type.label)} · ${localize(type.sides[side_index].label)}`,
                    },
                    ...current,
                ]);
            }
        );
        if (opened) setBought(localize('Contract bought.'));
    };

    const dismiss = (contract_id: number) => {
        own_contracts.current.delete(contract_id);
        setPositions(current => current.filter(position => position.contract_id !== contract_id));
    };

    // Only the digit contracts have a second view to page to.
    const shown_stage = type.shows_digit_stats ? stage : 'chart';

    // The run panel opens as a drawer over the right edge - which is exactly
    // where this page's ticket is (measured: drawer from 914px, ticket
    // 964-1264px, so the whole ticket sat underneath it). The page gives way
    // rather than the trader having to close the panel to place a trade.
    return (
        <div className={`mw-dt${run_panel?.is_drawer_open ? ' mw-dt--drawer' : ''}`}>
            <div className='mw-dt__body'>
                <PositionsPanel
                    is_collapsed={is_positions_collapsed}
                    onDismiss={dismiss}
                    onToggle={() => setIsPositionsCollapsed(current => !current)}
                    positions={positions}
                />

                <section className='mw-dt__chart-side'>
                    <MarketSelect
                        change={change}
                        decimals={decimals}
                        onChange={setSymbol}
                        price={price}
                        symbol={symbol}
                        symbols={symbols}
                    />

                    <div className={`mw-dt__stage mw-dt__stage--${shown_stage}`}>
                        <div className='mw-dt__stage-chart'>
                            <PriceChart decimals={decimals} epochs={epochs} prices={prices} />
                        </div>

                        {type.shows_digit_stats && (
                            <div className='mw-dt__stage-digits'>
                                <DigitCircles
                                    distribution={distribution}
                                    latest={latest_digit}
                                    selected={type.fields.includes('digit') ? params.digit : undefined}
                                />
                            </div>
                        )}

                        {/* The pair Deriv puts either side of this slot on a
                            phone: back to the chart, and on to the trade
                            types. Both are off the desktop layout, where the
                            chart and the rings are on screen together. */}
                        {type.shows_digit_stats && (
                            <button
                                type='button'
                                className='mw-dt__pager mw-dt__pager--prev'
                                aria-label={shown_stage === 'chart' ? localize('Show digits') : localize('Show chart')}
                                onClick={() => setStage(current => (current === 'chart' ? 'digits' : 'chart'))}
                            >
                                «
                            </button>
                        )}
                        <button
                            type='button'
                            className='mw-dt__pager mw-dt__pager--next'
                            aria-label={localize('Trade types')}
                            onClick={() => setIsTypesOpen(true)}
                        >
                            »
                        </button>
                    </div>
                </section>

                <aside className='mw-dt__ticket'>
                    <button
                        type='button'
                        className='mw-dt__learn'
                        aria-expanded={is_learn_open}
                        onClick={() => setIsLearnOpen(current => !current)}
                    >
                        {localize('Learn about this trade type')}
                    </button>
                    {is_learn_open && (
                        <p className='mw-dt__learn-text'>{localize(TRADE_DESCRIPTIONS[type.id] ?? '')}</p>
                    )}

                    <button type='button' className='mw-dt__type-head' onClick={() => setIsTypesOpen(true)}>
                        <TradeIcon id={type.id} />
                        <b>{localize(type.label)}</b>
                        <span aria-hidden='true'>›</span>
                    </button>

                    {type.fields.includes('duration') && (
                        <div className='mw-dt__duration'>
                            {bounds.units.length > 1 && (
                                <div className='mw-dt__units'>
                                    {bounds.units.map(unit => (
                                        <button
                                            key={unit}
                                            type='button'
                                            className={`mw-dt__unit${
                                                unit === params.duration_unit ? ' mw-dt__unit--on' : ''
                                            }`}
                                            aria-pressed={unit === params.duration_unit}
                                            onClick={() => {
                                                const limit = unit === 'm' ? bounds.minutes : bounds.ticks;
                                                update({ duration: limit?.min ?? 1, duration_unit: unit });
                                            }}
                                        >
                                            {unit === 'm' ? localize('Minutes') : localize('Ticks')}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {params.duration_unit === 't' ? (
                                <div className='mw-dt__slider'>
                                    <span>{localize('Ticks')}</span>
                                    <input
                                        type='range'
                                        min={duration_bounds.min}
                                        max={duration_bounds.max}
                                        step={1}
                                        value={params.duration}
                                        aria-label={localize('Ticks')}
                                        onChange={event => update({ duration: Number(event.target.value) })}
                                    />
                                    <b>{durationLabel(params.duration, 't')}</b>
                                </div>
                            ) : (
                                <ValuePicker
                                    display={durationLabel(params.duration, params.duration_unit)}
                                    label={localize('Duration')}
                                    max={duration_bounds.max}
                                    min={duration_bounds.min}
                                    onChange={duration => update({ duration })}
                                    presetLabel={preset => durationLabel(preset, params.duration_unit)}
                                    presets={MINUTE_PRESETS}
                                    value={params.duration}
                                />
                            )}
                        </div>
                    )}

                    {type.fields.includes('digit') && (
                        <div className='mw-dt__pred'>
                            <span className='mw-dt__pred-label'>{localize('Last Digit Prediction')}</span>
                            <div className='mw-dt__pred-grid'>
                                {DIGITS.map(digit => (
                                    <button
                                        key={digit}
                                        type='button'
                                        className={`mw-dt__pred-digit${
                                            digit === params.digit ? ' mw-dt__pred-digit--on' : ''
                                        }`}
                                        aria-pressed={digit === params.digit}
                                        onClick={() => update({ digit })}
                                    >
                                        {digit}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {type.fields.includes('growth_rate') && (
                        <div className='mw-dt__field mw-dt__field--block'>
                            <span>{localize('Growth rate')}</span>
                            <div className='mw-dt__chips'>
                                {GROWTH_RATES.map(rate => (
                                    <button
                                        key={rate}
                                        type='button'
                                        className={`mw-dt__chip${
                                            rate === params.growth_rate ? ' mw-dt__chip--on' : ''
                                        }`}
                                        aria-pressed={rate === params.growth_rate}
                                        onClick={() => update({ growth_rate: rate })}
                                    >
                                        {`${(rate * 100).toFixed(0)}%`}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {type.fields.includes('multiplier') && (
                        <div className='mw-dt__field mw-dt__field--block'>
                            <span>{localize('Multiplier')}</span>
                            <div className='mw-dt__chips'>
                                {MULTIPLIERS.map(value => (
                                    <button
                                        key={value}
                                        type='button'
                                        className={`mw-dt__chip${value === params.multiplier ? ' mw-dt__chip--on' : ''}`}
                                        aria-pressed={value === params.multiplier}
                                        onClick={() => update({ multiplier: value })}
                                    >
                                        {`x${value}`}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {type.fields.includes('barrier') && (
                        <label className='mw-dt__field'>
                            <span>{localize('Barrier')}</span>
                            <input
                                type='text'
                                value={params.barrier_offset}
                                onChange={event => update({ barrier_offset: event.target.value })}
                            />
                        </label>
                    )}

                    {/* Vanillas price off Deriv's own strike list, which comes
                        back with the quote - so these are its values, not a
                        range of ours. */}
                    {type.fields.includes('strike') && (
                        <label className='mw-dt__field'>
                            <span>{localize('Strike price')}</span>
                            <select value={params.strike} onChange={event => update({ strike: event.target.value })}>
                                {(proposal?.barrier_choices ?? [params.strike]).map(choice => (
                                    <option key={choice} value={choice}>
                                        {choice}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}

                    {/* Turbos price from a payout per point, and Deriv offers
                        only a few - it names them when it refuses one, and
                        those are the options here. */}
                    {type.fields.includes('payout_per_point') && (
                        <label className='mw-dt__field'>
                            <span>{localize('Payout per point')}</span>
                            <select
                                value={params.payout_per_point}
                                onChange={event => update({ payout_per_point: event.target.value })}
                            >
                                <option value=''>{localize('Choose')}</option>
                                {offered_payouts_per_point.map(value => (
                                    <option key={value} value={value}>
                                        {value}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}

                    {/* Deriv states the stake it will accept for this exact
                        contract - a minute-long accumulator will not go below
                        1.00 - so the stepper holds to its limits rather than to
                        a rule of our own. */}
                    <div className='mw-dt__stake'>
                        <span className='mw-dt__stake-label'>{localize('Stake')}</span>
                        <div className='mw-dt__stake-row'>
                            <button
                                type='button'
                                className='mw-dt__stake-step'
                                aria-label={localize('Less')}
                                onClick={() => stepStake(-1)}
                            >
                                −
                            </button>
                            <input
                                type='number'
                                inputMode='decimal'
                                min={stake_limits.min}
                                max={stake_limits.max}
                                step={0.01}
                                value={params.stake}
                                aria-label={localize('Stake')}
                                onChange={event => update({ stake: Number(event.target.value) })}
                            />
                            <i>{currency}</i>
                            <button
                                type='button'
                                className='mw-dt__stake-step'
                                aria-label={localize('More')}
                                onClick={() => stepStake(1)}
                            >
                                +
                            </button>
                        </div>
                    </div>

                    {type.fields.includes('take_profit') && (
                        <label className='mw-dt__field'>
                            <span>{localize('Take profit')}</span>
                            <input
                                type='number'
                                min={0}
                                step={0.01}
                                placeholder='-'
                                value={params.take_profit}
                                onChange={event => update({ take_profit: event.target.value })}
                            />
                            <i>{currency}</i>
                        </label>
                    )}

                    {type.id === 'rise_fall' && (
                        <label className='mw-dt__toggle'>
                            <span>{localize('Allow equals')}</span>
                            <input
                                type='checkbox'
                                checked={params.allow_equals}
                                onChange={event => update({ allow_equals: event.target.checked })}
                            />
                        </label>
                    )}

                    {/* Everything below is Deriv's own answer for this exact
                        ticket. Nothing is shown that did not come back. */}
                    <dl className='mw-dt__quote'>
                        {limits?.max_payout && (
                            <div>
                                <dt>{localize('Max. payout')}</dt>
                                <dd>{`${limits.max_payout} ${currency}`}</dd>
                            </div>
                        )}
                        {details?.tick_size_barrier_percentage && (
                            <div>
                                <dt>{localize('Barrier')}</dt>
                                <dd>{`± ${details.tick_size_barrier_percentage}`}</dd>
                            </div>
                        )}
                        {details?.maximum_ticks && (
                            <div>
                                <dt>{localize('Max. ticks')}</dt>
                                <dd>{localize('{{count}} ticks', { count: details.maximum_ticks })}</dd>
                            </div>
                        )}
                        {/* An accumulator states its barrier as the percentage
                            band above, so its distance in points would be the
                            same fact twice. */}
                        {details?.barrier_spot_distance && !details?.tick_size_barrier_percentage && (
                            <div>
                                <dt>{localize('Barrier')}</dt>
                                <dd>{details.barrier_spot_distance}</dd>
                            </div>
                        )}
                        {/* The entry spot comes back as a barrier on every
                            contract; it is only worth a row on the ones that
                            actually have a barrier to show. */}
                        {!details?.barrier_spot_distance &&
                            details?.barrier &&
                            (type.fields.includes('barrier') || type.fields.includes('strike')) && (
                                <div>
                                    <dt>{localize('Barrier')}</dt>
                                    <dd>{details.barrier}</dd>
                                </div>
                            )}
                        {proposal?.limit_order?.stop_out?.display_order_amount && (
                            <div>
                                <dt>{localize('Stop out')}</dt>
                                <dd>{`${proposal.limit_order.stop_out.display_order_amount} ${currency}`}</dd>
                            </div>
                        )}
                        {proposal?.commission !== undefined && (
                            <div>
                                <dt>{localize('Commission')}</dt>
                                <dd>{`${proposal.commission.toFixed(2)} ${currency}`}</dd>
                            </div>
                        )}
                    </dl>

                    {trade.error_message && <p className='mw-dt__error'>{trade.error_message}</p>}
                    {bought && !trade.error_message && <p className='mw-dt__ok'>{bought}</p>}

                    {/* One button per side, each carrying Deriv's payout for
                        that side and what it makes on the stake - and buying
                        that side, which is the ticket's only action. */}
                    <div className={`mw-dt__actions${has_two_sides ? '' : ' mw-dt__actions--one'}`}>
                        {type.sides.map((side, index) => {
                            const quote = quotes[index];
                            const payout = quote.proposal?.payout ?? 0;
                            const percent = profitPercent(payout);
                            const digit_error = digitError(index);
                            const message = digit_error ?? quote.error;

                            return (
                                <div key={side.contract_type} className='mw-dt__action'>
                                    <p className='mw-dt__action-payout'>
                                        <span>{localize('Payout')}</span>
                                        <b>{payout > 0 ? `${payout.toFixed(2)} ${currency}` : '-'}</b>
                                    </p>
                                    <button
                                        type='button'
                                        className={`mw-dt__action-btn mw-dt__action-btn--${index === 0 ? 'up' : 'down'}`}
                                        disabled={trade.is_placing || Boolean(digit_error)}
                                        onClick={() => buy(index)}
                                    >
                                        <TradeIcon id={type.id} />
                                        <span>
                                            {trade.is_placing && !digit_error
                                                ? localize('Buying...')
                                                : has_session
                                                  ? localize(side.label)
                                                  : localize('Log in')}
                                        </span>
                                        {percent && !digit_error && <b>{percent}</b>}
                                    </button>
                                    {message && <p className='mw-dt__action-error'>{message}</p>}
                                </div>
                            );
                        })}
                    </div>

                    {/* The stats row Deriv shows for accumulators: how many
                        ticks each of the last runs stayed inside the barrier. */}
                    {details?.ticks_stayed_in && (
                        <div className='mw-dt__stats'>
                            <span>{localize('Stats')}</span>
                            <div>
                                {details.ticks_stayed_in.slice(0, 12).map((count, index) => (
                                    // eslint-disable-next-line react/no-array-index-key
                                    <b key={`${count}-${index}`}>{count}</b>
                                ))}
                            </div>
                        </div>
                    )}
                </aside>
            </div>

            <TradeTypesPanel
                is_open={is_types_open}
                onClose={() => setIsTypesOpen(false)}
                onSelect={id => {
                    const next = findTradeType(id);
                    setTypeId(id);
                    // Each family has its own duration bounds, so the ticket
                    // lands on a duration that prices instead of one the last
                    // type allowed.
                    const unit = next.duration_units[0] ?? 't';
                    update({
                        duration: unit === 'm' ? (next.min_minutes ?? 1) : (next.min_ticks ?? 1) + 4,
                        duration_unit: unit,
                    });
                }}
                supported={supported}
                type_id={type_id}
            />
        </div>
    );
});

export default DTrader;
