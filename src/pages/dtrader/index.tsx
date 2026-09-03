import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
    DEFAULT_PARAMS,
    durationBounds,
    findTradeType,
    GROWTH_RATES,
    MULTIPLIERS,
    TRADE_TYPES,
    TTradeParams,
} from './trade-types';
import useTradeProposal from './use-trade-proposal';
import './dtrader.scss';

// The app's own chart, lazy for the same reason the Charts tab loads it lazily.
const ChartWrapper = lazy(() => import('../chart/chart-wrapper'));

const DEFAULT_SYMBOL = '1HZ100V';
const DIGIT_WINDOW = 1000;

const DTrader = observer(() => {
    const { feed, isConnected } = usePublicMarketFeed();
    const { chart_store, client, oauth_session, run_panel } = useStore() ?? {};
    const { localize } = useTranslations();
    const trade = useManualTrade();

    const [symbols, setSymbols] = useState<TActiveSymbol[]>([]);
    const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
    const [contracts_for, setContractsFor] = useState<TContractForSymbol[]>([]);
    const [type_id, setTypeId] = useState('rise_fall');
    const [side_index, setSideIndex] = useState(0);
    const [params, setParams] = useState<TTradeParams>(DEFAULT_PARAMS);

    const [prices, setPrices] = useState<number[]>([]);
    const [decimals, setDecimals] = useState(2);
    const [positions, setPositions] = useState<TPosition[]>([]);
    const [is_positions_collapsed, setIsPositionsCollapsed] = useState(false);
    const [bought, setBought] = useState<string | null>(null);

    const type = findTradeType(type_id);
    const is_logged_in = Boolean(oauth_session?.is_authenticated || client?.is_logged_in);
    const has_session = is_logged_in || Boolean(getStoredAccessToken() || V2GetActiveToken());
    const currency = oauth_session?.currency || (is_logged_in && (client?.currency as string)) || 'USD';

    const {
        error: price_error,
        offered_payouts_per_point,
        proposal,
        request,
    } = useTradeProposal({
        currency,
        params,
        side_index,
        symbol,
        type,
    });

    const update = useCallback((patch: Partial<TTradeParams>) => setParams(current => ({ ...current, ...patch })), []);

    // Turbos have to be priced from one of the payouts per point Deriv offers,
    // and it only names them when it turns one down - so the first quote comes
    // back as a refusal carrying the list, and the ticket settles on the
    // middle of it rather than leaving the trader with an error to read.
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
    // which tabs are offered here rather than a list of our own.
    useEffect(() => {
        if (!isConnected) return;
        setContractsFor([]);
        feed.getContractsFor(symbol)
            .then(setContractsFor)
            .catch(() => {
                // Leaving it empty offers every tab; a wrong one is refused at
                // pricing, with Deriv's reason on screen.
            });
    }, [isConnected, feed, symbol]);

    // Price history and the live stream, on the feed the app already holds
    // open. One window serves the spot, the change and the digit strip.
    const request_id = useRef(0);
    useEffect(() => {
        if (!isConnected) return undefined;
        const id = ++request_id.current;
        setPrices([]);

        feed.getTickHistory(symbol, DIGIT_WINDOW)
            .then(({ pip_size, prices: history }) => {
                if (id !== request_id.current) return;
                setDecimals(toDecimalPlaces(pip_size) ?? 2);
                setPrices(history);
            })
            .catch(() => {
                // Non-fatal: the live stream fills the window on its own.
            });

        return feed.subscribeTicks(symbol, tick => {
            if (id !== request_id.current) return;
            setDecimals(toDecimalPlaces(tick.pip_size) ?? 2);
            setPrices(current => [...current, tick.quote].slice(-DIGIT_WINDOW));
        });
    }, [isConnected, feed, symbol]);

    // The chart follows the market picked here rather than keeping its own.
    useEffect(() => {
        chart_store?.onSymbolChange?.(symbol);
    }, [chart_store, symbol]);

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

    const payout = proposal?.payout ?? 0;
    const details = proposal?.contract_details;
    const limits = proposal?.validation_params;

    /** Buys exactly what was quoted - the priced request, sent to be bought. */
    const buy = async () => {
        setBought(null);
        if (!has_session) {
            redirectToLogin(false);
            return;
        }

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

    // The run panel opens as a drawer over the right edge - which is exactly
    // where this page's ticket is (measured: drawer from 914px, ticket
    // 964-1264px, so the whole ticket sat underneath it). The page gives way
    // rather than the trader having to close the panel to place a trade.
    return (
        <div className={`mw-dt${run_panel?.is_drawer_open ? ' mw-dt--drawer' : ''}`}>
            <nav className='mw-dt__types' aria-label={localize('Trade types')}>
                {TRADE_TYPES.map(item => {
                    const unavailable = supported !== null && !supported.has(item.category);
                    return (
                        <button
                            key={item.id}
                            type='button'
                            className={`mw-dt__type${item.id === type_id ? ' mw-dt__type--on' : ''}`}
                            aria-pressed={item.id === type_id}
                            disabled={unavailable}
                            title={unavailable ? localize('Not offered on this market.') : undefined}
                            onClick={() => {
                                setTypeId(item.id);
                                setSideIndex(0);
                                // Each family has its own duration bounds, so
                                // the ticket lands on a duration that prices
                                // instead of one the last tab allowed.
                                const unit = item.duration_units[0] ?? 't';
                                update({
                                    duration: unit === 'm' ? (item.min_minutes ?? 1) : (item.min_ticks ?? 1) + 4,
                                    duration_unit: unit,
                                });
                            }}
                        >
                            {localize(item.label)}
                            {item.hot && <span aria-hidden='true'> 🔥</span>}
                        </button>
                    );
                })}
            </nav>

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

                    <div className='mw-dt__chart'>
                        <p className='mw-dt__chart-waiting'>{localize('Starting the chart...')}</p>
                        <Suspense fallback={null}>
                            <ChartWrapper show_digits_stats={false} />
                        </Suspense>
                    </div>

                    {type.shows_digit_stats && <DigitCircles distribution={distribution} latest={latest_digit} />}
                </section>

                <aside className='mw-dt__ticket'>
                    <p className='mw-dt__how'>{localize('How to trade {{label}}?', { label: localize(type.label) })}</p>

                    {type.sides.length > 1 && (
                        <div className='mw-dt__sides'>
                            {type.sides.map((item, index) => (
                                <button
                                    key={item.contract_type}
                                    type='button'
                                    className={`mw-dt__side${index === side_index ? ' mw-dt__side--on' : ''}`}
                                    onClick={() => setSideIndex(index)}
                                >
                                    {localize(item.label)}
                                </button>
                            ))}
                        </div>
                    )}

                    {type.fields.includes('digit') && (
                        <div className='mw-dt__field mw-dt__field--block'>
                            <span>{localize('Last digit prediction')}</span>
                            <DigitCircles
                                distribution={distribution}
                                latest={latest_digit}
                                onSelect={digit => update({ digit })}
                                selected={params.digit}
                            />
                        </div>
                    )}

                    {type.fields.includes('growth_rate') && (
                        <label className='mw-dt__field'>
                            <span>{localize('Growth rate')}</span>
                            <select
                                value={params.growth_rate}
                                onChange={event => update({ growth_rate: Number(event.target.value) })}
                            >
                                {GROWTH_RATES.map(rate => (
                                    <option key={rate} value={rate}>
                                        {`${(rate * 100).toFixed(0)}%`}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}

                    {type.fields.includes('multiplier') && (
                        <label className='mw-dt__field'>
                            <span>{localize('Multiplier')}</span>
                            <select
                                value={params.multiplier}
                                onChange={event => update({ multiplier: Number(event.target.value) })}
                            >
                                {MULTIPLIERS.map(value => (
                                    <option key={value} value={value}>
                                        {`x${value}`}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}

                    {type.fields.includes('duration') && (
                        <div className='mw-dt__field'>
                            <span>{localize('Duration')}</span>
                            <input
                                type='number'
                                min={duration_bounds.min}
                                max={duration_bounds.max}
                                value={params.duration}
                                aria-label={localize('Duration')}
                                onChange={event =>
                                    update({
                                        duration: Math.min(
                                            duration_bounds.max,
                                            Math.max(
                                                duration_bounds.min,
                                                Number(event.target.value) || duration_bounds.min
                                            )
                                        ),
                                    })
                                }
                            />
                            {bounds.units.length > 1 ? (
                                <select
                                    value={params.duration_unit}
                                    aria-label={localize('Duration unit')}
                                    onChange={event => {
                                        const unit = event.target.value as 't' | 'm';
                                        const limit = unit === 'm' ? bounds.minutes : bounds.ticks;
                                        update({ duration: limit?.min ?? 1, duration_unit: unit });
                                    }}
                                >
                                    {bounds.units.map(unit => (
                                        <option key={unit} value={unit}>
                                            {unit === 'm' ? localize('minutes') : localize('ticks')}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <i>{params.duration_unit === 'm' ? localize('minutes') : localize('ticks')}</i>
                            )}
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

                    <label className='mw-dt__field'>
                        <span>{localize('Stake')}</span>
                        <input
                            type='number'
                            min={0.35}
                            step={0.01}
                            value={params.stake}
                            onChange={event => update({ stake: Math.max(0.35, Number(event.target.value) || 0.35) })}
                        />
                        <i>{currency}</i>
                    </label>

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
                                <dt>{localize('Max. duration')}</dt>
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
                        {proposal?.display_number_of_contracts && (
                            <div>
                                <dt>{localize('Payout per point')}</dt>
                                <dd>{`${proposal.display_number_of_contracts} ${currency}`}</dd>
                            </div>
                        )}
                    </dl>

                    {price_error && <p className='mw-dt__error'>{price_error}</p>}
                    {trade.error_message && <p className='mw-dt__error'>{trade.error_message}</p>}
                    {bought && !trade.error_message && <p className='mw-dt__ok'>{bought}</p>}

                    <button type='button' className='mw-dt__buy' onClick={buy} disabled={trade.is_placing}>
                        <b>
                            {trade.is_placing
                                ? localize('Buying...')
                                : has_session
                                  ? localize('Buy')
                                  : localize('Log in to buy')}
                        </b>
                        {payout > 0 && (
                            <i>{localize('Payout {{payout}} {{currency}}', { currency, payout: payout.toFixed(2) })}</i>
                        )}
                    </button>

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
        </div>
    );
});

export default DTrader;
