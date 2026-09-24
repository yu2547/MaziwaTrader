import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import RiskDisclaimer from '@/components/layout/footer/RiskDisclaimer';
import { redirectToLogin } from '@/components/shared';
import { TradeTypeIcon } from '@/components/trade-type/trade-type-icon';
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
import DTraderLoader from './dtrader-loader';
import { ArrowUpIcon, ChevronRightIcon, InfoIcon, MinusIcon, PlusIcon } from './icons';
import MarketSelect from './market-select';
import PositionsPanel, { TPosition } from './positions-panel';
import PriceChart from './price-chart';
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
const TICK_PRESETS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const DIGITS = Array.from({ length: 10 }, (_, digit) => digit);

const DTrader = observer(() => {
    const { feed, isConnected } = usePublicMarketFeed();
    const { client, oauth_session } = useStore() ?? {};
    const { localize } = useTranslations();
    const trade = useManualTrade();

    const [symbols, setSymbols] = useState<TActiveSymbol[]>([]);
    const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
    const [contracts_for, setContractsFor] = useState<TContractForSymbol[]>([]);
    // Accumulators, as the reference opens on - and on the market it opens on,
    // Volatility 100 (1s). A market that cannot trade them moves the ticket to
    // one it can (the effect below), so this is a starting point, not a lock.
    const [type_id, setTypeId] = useState('accumulators');
    const [params, setParams] = useState<TTradeParams>(DEFAULT_PARAMS);

    const [prices, setPrices] = useState<number[]>([]);
    const [epochs, setEpochs] = useState<number[]>([]);
    const [decimals, setDecimals] = useState(2);
    const [positions, setPositions] = useState<TPosition[]>([]);
    const [is_positions_collapsed, setIsPositionsCollapsed] = useState(false);
    const [bought, setBought] = useState<string | null>(null);
    /**
     * The contract this page has open, as Deriv last reported it. Null whenever
     * there is not one - which is what decides between the ticket and the
     * reference's running state, so the page is never showing a Sell for a
     * contract that has already closed.
     */
    const [open_contract, setOpenContract] = useState<Record<string, unknown> | null>(null);
    const [is_types_open, setIsTypesOpen] = useState(false);
    const [is_learn_open, setIsLearnOpen] = useState(false);
    /** Which of the ticket's marks is open, when one is. */
    const [info, setInfo] = useState<'growth' | 'take_profit' | null>(null);
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

    /**
     * Contracts that pay as they run rather than to a payout fixed at
     * purchase - an accumulator grows the stake per tick, a multiplier tracks
     * the market - so there is no payout figure to put on the button, and the
     * reference's button says only "Buy".
     */
    const has_running_payout = type.fields.includes('growth_rate') || type.fields.includes('multiplier');
    const quote_up = useTradeProposal({ currency, is_connected: isConnected, params, side_index: 0, symbol, type });
    const quote_down = useTradeProposal({
        currency,
        enabled: has_two_sides,
        is_connected: isConnected,
        params,
        side_index: 1,
        symbol,
        type,
    });
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

            // The contract as it stands, kept whole rather than reduced to the
            // positions row: the chart draws its entry, its band and what it is
            // making from these fields, and the button sells at the price in
            // them. A sold one is dropped, which is what puts the ticket back.
            setOpenContract(current => {
                if (contract.is_sold) return current?.contract_id === contract_id ? null : current;
                return { ...contract, contract_id };
            });

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

    /**
     * The band this contract stays inside, as Deriv priced it - the two lines
     * the reference draws out from the spot. Both come off the quote, so they
     * move with the market and with the ticket; a contract without a band (a
     * rise/fall, a digit) has none and the chart draws none.
     */
    /**
     * A band Deriv states as two price levels - a barrier that stays where it
     * was set, whatever the market does after. Drawn as given.
     */
    const barriers = useMemo(() => {
        const high = Number(details?.high_barrier);
        const low = Number(details?.low_barrier);
        if (Number.isFinite(high) && Number.isFinite(low)) return { high, low };

        const spot_distance = Number(details?.barrier_spot_distance);
        const quoted_spot = Number(proposal?.spot);
        if (Number.isFinite(spot_distance) && spot_distance > 0 && Number.isFinite(quoted_spot)) {
            return { high: quoted_spot + spot_distance, low: quoted_spot - spot_distance };
        }

        return null;
    }, [details?.barrier_spot_distance, details?.high_barrier, details?.low_barrier, proposal?.spot]);

    /**
     * An accumulator's band is not a fixed pair of prices: it is a share of
     * the spot, "± 0.03797%", measured afresh against each tick - which is why
     * the reference's two lines travel with the market rather than sitting
     * where the last quote left them. Only the distance is worked out here;
     * the chart hangs it on the tick it is drawing, so the band is centred on
     * the market rather than on a five-second-old price. It takes precedence
     * over the fixed levels above for the same reason.
     */
    /**
     * The contract as the chart and the button need it. Everything here is
     * Deriv's own figure for the contract that is actually open: the tick it
     * was entered on, the band it is currently inside - which the open-contract
     * stream restates on every tick, unlike the quote's, which is priced once -
     * what it is making, and what it would be sold for now.
     */
    const running = useMemo(() => {
        if (!open_contract) return null;
        const entry_epoch = Number(open_contract.entry_tick_time ?? open_contract.date_start);
        const entry_price = Number(open_contract.entry_tick ?? open_contract.entry_spot);
        const high = Number(open_contract.high_barrier);
        const low = Number(open_contract.low_barrier);
        const profit = Number(open_contract.profit);
        const bid = Number(open_contract.bid_price);

        return {
            barriers: Number.isFinite(high) && Number.isFinite(low) ? { high, low } : null,
            bid: Number.isFinite(bid) ? bid : null,
            contract_id: Number(open_contract.contract_id),
            currency: (open_contract.currency as string) || currency,
            entry:
                Number.isFinite(entry_epoch) && Number.isFinite(entry_price)
                    ? { epoch: entry_epoch, price: entry_price }
                    : null,
            // Deriv says when a contract cannot be closed right now - between
            // ticks, or on one that has already knocked out - and the button
            // holds rather than sending a sale that can only be refused.
            is_sellable: open_contract.is_valid_to_sell !== 0,
            profit: Number.isFinite(profit) ? profit : null,
        };
    }, [currency, open_contract]);

    const is_running = running !== null;

    /** Closes the open contract at the market, through the same socket the buy went out on. */
    const sell = async () => {
        if (!running || !Number.isFinite(running.contract_id)) return;
        setBought(null);
        await trade.sellContract(running.contract_id);
    };

    const band_distance = useMemo(() => {
        const percent = Number(String(details?.tick_size_barrier_percentage ?? '').replace('%', ''));
        if (!Number.isFinite(percent) || percent <= 0 || price === null) return null;
        return (price * percent) / 100;
    }, [details?.tick_size_barrier_percentage, price]);

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

    // The bot's run panel and execution bar are not mounted on this route (see
    // components/layout/index.tsx), so the page has the width to itself and no
    // longer gives up 37rem of it to a drawer.
    return (
        <div className='mw-dt'>
            {/* What the recording shows for the whole of the wait, and the
                same artwork the route puts up while this page's chunk is on
                its way (App.tsx) - so the tap leads to one picture rather than
                to a spinner, then a second loader, then the market. It stands
                until the first ticks are in: it is the page waiting for real
                data, not a timer. */}
            {prices.length === 0 && <DTraderLoader is_cover />}

            <div className={`mw-dt__body${positions.length ? ' mw-dt__body--positions' : ''}`}>
                {/* There is nothing to show until something has been bought,
                    and an empty panel would hold 26rem of the page open for a
                    picture of an empty box. It appears with the first contract
                    and the chart gives the width back. */}
                {positions.length > 0 && (
                    <PositionsPanel
                        is_collapsed={is_positions_collapsed}
                        onDismiss={dismiss}
                        onToggle={() => setIsPositionsCollapsed(current => !current)}
                        positions={positions}
                    />
                )}

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
                            <PriceChart
                                band_distance={is_running ? null : band_distance}
                                barriers={barriers}
                                contract={running}
                                decimals={decimals}
                                epochs={epochs}
                                prices={prices}
                            />
                        </div>

                        {type.shows_digit_stats && (
                            <div className='mw-dt__stage-digits'>
                                {/* The count is the window actually held, not
                                    the one asked for - it reads 1000 once the
                                    history is in, and says less until then. */}
                                {digits.length > 0 && (
                                    <p className='mw-dt__digit-banner'>
                                        {localize('Last digit stats for latest {{count}} ticks for {{market}}', {
                                            count: digits.length,
                                            market:
                                                symbols.find(item => item.underlying_symbol === symbol)
                                                    ?.underlying_symbol_name ?? symbol,
                                        })}
                                    </p>
                                )}
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
                                <ChevronRightIcon />
                            </button>
                        )}
                        <button
                            type='button'
                            className='mw-dt__pager mw-dt__pager--next'
                            aria-label={localize('Trade types')}
                            onClick={() => setIsTypesOpen(true)}
                        >
                            <ChevronRightIcon />
                        </button>
                    </div>
                    {/* Deriv's own record for an accumulator: how many ticks
                        each of the last runs stayed inside the band, newest
                        first. The reference carries it on its own row under
                        the chart rather than at the foot of the ticket. */}
                    {details?.ticks_stayed_in && (
                        <div className='mw-dt__stats'>
                            <InfoIcon className='mw-dt__stats-mark' />
                            <b className='mw-dt__stats-title'>{localize('Stats')}</b>
                            <div className='mw-dt__stats-list'>
                                {details.ticks_stayed_in.slice(0, 8).map((count, index) => (
                                    // eslint-disable-next-line react/no-array-index-key
                                    <b key={`${count}-${index}`}>{count}</b>
                                ))}
                            </div>
                            <ArrowUpIcon className='mw-dt__stats-more' />
                        </div>
                    )}
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

                    {/* Deriv's own terms for the contract as it stands: the
                        rate off the ticket, the band off the quote. */}
                    {info === 'growth' && (
                        <p className='mw-dt__info'>
                            {localize(
                                'Your stake will grow at {{rate}}% per tick as long as the current spot price remains within {{barrier}} from the previous spot price.',
                                {
                                    barrier: details?.tick_size_barrier_percentage
                                        ? `±${details.tick_size_barrier_percentage}`
                                        : localize('the band above'),
                                    rate: (params.growth_rate * 100).toFixed(0),
                                }
                            )}
                        </p>
                    )}

                    {info === 'take_profit' && (
                        <p className='mw-dt__info'>
                            {localize('The contract closes itself once its profit reaches the amount you set.')}
                        </p>
                    )}

                    {/* Everything that sets up a trade, inside one disabled
                        group while a contract is running - which is what the
                        recording shows: the whole ticket greys out and only the
                        Sell stays live. A fieldset rather than a class, so the
                        controls are genuinely out of reach - not reachable by
                        keyboard, not submittable - rather than dimmed and still
                        working underneath. */}
                    <fieldset className='mw-dt__controls' disabled={is_running}>
                        {/* The trade type, and beside it the rate it grows at -
                            the pair the reference puts on one line. The rates also
                            have their own row below for the wide layout; the
                            stylesheet shows one or the other, never both. */}
                        <div className='mw-dt__type-row'>
                            <button type='button' className='mw-dt__type-head' onClick={() => setIsTypesOpen(true)}>
                                <span className='mw-dt__types-icons'>
                                    {type.sides.map(side => (
                                        <TradeTypeIcon key={side.contract_type} type={side.contract_type} size='sm' />
                                    ))}
                                </span>
                                <b>{localize(type.label)}</b>
                                <ChevronRightIcon className='mw-dt__type-go' />
                            </button>

                            {type.fields.includes('growth_rate') && (
                                <div className='mw-dt__growth'>
                                    <label>
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
                                    <button
                                        type='button'
                                        className='mw-dt__mark'
                                        aria-label={localize('About the growth rate')}
                                        aria-expanded={info === 'growth'}
                                        onClick={() => setInfo(current => (current === 'growth' ? null : 'growth'))}
                                    >
                                        <InfoIcon />
                                    </button>
                                </div>
                            )}
                        </div>

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
                                <span className='mw-dt__pred-label' aria-hidden='true'>
                                    {localize('Last Digit Prediction')}
                                </span>
                                {/* Named on the group itself, so the grid still says
                                what it is on a phone, where the visible label
                                above is dropped to match the reference. */}
                                <div
                                    className='mw-dt__pred-grid'
                                    role='group'
                                    aria-label={localize('Last Digit Prediction')}
                                >
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
                            <div className='mw-dt__field mw-dt__field--block mw-dt__field--growth'>
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
                                <select
                                    value={params.strike}
                                    onChange={event => update({ strike: event.target.value })}
                                >
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

                        {/* The phone's version of duration and stake: the one line
                        the reference gives them - duration on the left, the
                        stake bold in the middle, its label on the right. The
                        stacked tabs, slider and stepper above and below are the
                        wide layout's; the stylesheet shows one or the other,
                        never both, so each value has exactly one control on
                        screen. Duration opens the same pad the minutes picker
                        uses, with ticks and minutes on it. */}
                        <div
                            className={`mw-dt__compact${
                                type.fields.includes('duration') ? '' : ' mw-dt__compact--no-duration'
                            }`}
                        >
                            {type.fields.includes('duration') && (
                                <ValuePicker
                                    display={durationLabel(params.duration, params.duration_unit)}
                                    label={localize('Duration')}
                                    max={duration_bounds.max}
                                    min={duration_bounds.min}
                                    onChange={duration => update({ duration })}
                                    onUnitChange={value => {
                                        // Taken from the contract's own list rather
                                        // than cast: a unit it does not offer is
                                        // ignored, not sent to be refused.
                                        const unit = bounds.units.find(item => item === value);
                                        if (!unit) return;
                                        const limit = unit === 'm' ? bounds.minutes : bounds.ticks;
                                        update({ duration: limit?.min ?? 1, duration_unit: unit });
                                    }}
                                    presetLabel={preset => durationLabel(preset, params.duration_unit)}
                                    presets={params.duration_unit === 'm' ? MINUTE_PRESETS : TICK_PRESETS}
                                    unit={params.duration_unit}
                                    units={bounds.units.map(unit => ({
                                        label: unit === 'm' ? localize('Minutes') : localize('Ticks'),
                                        value: unit,
                                    }))}
                                    value={params.duration}
                                />
                            )}
                            {/* The reference sets the stake between a minus and a
                            plus on the contracts that have no duration beside
                            it - an accumulator, a multiplier - and those are
                            the only ones with the room for them. */}
                            {!type.fields.includes('duration') && (
                                <button
                                    type='button'
                                    className='mw-dt__compact-step'
                                    aria-label={localize('Less')}
                                    onClick={() => stepStake(-1)}
                                >
                                    <MinusIcon />
                                </button>
                            )}
                            <label className='mw-dt__compact-stake'>
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
                            </label>
                            {!type.fields.includes('duration') && (
                                <button
                                    type='button'
                                    className='mw-dt__compact-step'
                                    aria-label={localize('More')}
                                    onClick={() => stepStake(1)}
                                >
                                    <PlusIcon />
                                </button>
                            )}
                            <span className='mw-dt__compact-label' aria-hidden='true'>
                                {localize('Stake')}
                            </span>
                        </div>

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
                                    <MinusIcon />
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
                                    <PlusIcon />
                                </button>
                            </div>
                        </div>

                        {/* Take profit is off until it is ticked, as the reference
                        has it: unticked it is left out of the contract
                        altogether rather than sent as an empty amount, and the
                        amount only appears once there is one to set. */}
                        {type.fields.includes('take_profit') && (
                            <div className='mw-dt__tp'>
                                <div className='mw-dt__tp-head'>
                                    <label>
                                        <input
                                            type='checkbox'
                                            checked={params.take_profit !== ''}
                                            onChange={event =>
                                                update({ take_profit: event.target.checked ? '10' : '' })
                                            }
                                        />
                                        <span>{localize('Take profit')}</span>
                                    </label>
                                    <button
                                        type='button'
                                        className='mw-dt__mark'
                                        aria-label={localize('About take profit')}
                                        aria-expanded={info === 'take_profit'}
                                        onClick={() =>
                                            setInfo(current => (current === 'take_profit' ? null : 'take_profit'))
                                        }
                                    >
                                        <InfoIcon />
                                    </button>
                                </div>

                                {params.take_profit !== '' && (
                                    <label className='mw-dt__field mw-dt__tp-amount'>
                                        <span>{localize('Amount')}</span>
                                        <input
                                            type='number'
                                            min={0}
                                            step={0.01}
                                            value={params.take_profit}
                                            onChange={event => update({ take_profit: event.target.value })}
                                        />
                                        <i>{currency}</i>
                                    </label>
                                )}
                            </div>
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
                    </fieldset>

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

                    {/* With a contract open, the recording's ticket has one
                        action and it is this: close it, at what Deriv would pay
                        for it now. The figure is Deriv's own bid, restated on
                        every tick, and it is what the sale goes out at - the
                        note under it is the reference's, and it is true: the
                        bid moves between this button being drawn and the request
                        landing. */}
                    {is_running ? (
                        <div className='mw-dt__running'>
                            <button
                                type='button'
                                className='mw-dt__sell'
                                disabled={trade.is_selling || !running.is_sellable || running.bid === null}
                                onClick={sell}
                            >
                                {trade.is_selling
                                    ? localize('Selling...')
                                    : localize('Sell {{amount}} {{currency}}', {
                                          amount: running.bid === null ? '-' : running.bid.toFixed(2),
                                          currency,
                                      })}
                            </button>
                            <p className='mw-dt__sell-note'>
                                <b>{localize('Note:')}</b>{' '}
                                {localize('You can close your trade anytime. Be aware of slippage risk.')}
                            </p>
                        </div>
                    ) : (
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
                                            <TradeTypeIcon type={side.contract_type} size='sm' />
                                            <span>
                                                {trade.is_placing && !digit_error
                                                    ? localize('Buying...')
                                                    : has_session
                                                      ? localize(side.label)
                                                      : localize('Log in')}
                                            </span>
                                            {/* A contract that pays as it runs has
                                            no payout to state up front, so its
                                            button carries the side alone - the
                                            reference's plain "Buy". */}
                                            {percent && !digit_error && !has_running_payout && <b>{percent}</b>}
                                            {/* The phone carries the payout inside
                                            the button, on its own line under the
                                            side, as the reference does; the line
                                            above the button is the wide
                                            layout's. Same figure either way. */}
                                            {!has_running_payout && (
                                                <em className='mw-dt__action-in-payout'>
                                                    <span>{localize('Payout')}</span>
                                                    <span>{payout > 0 ? `${payout.toFixed(2)} ${currency}` : '-'}</span>
                                                </em>
                                            )}
                                        </button>
                                        {message && <p className='mw-dt__action-error'>{message}</p>}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* The execution bar that carries the Risk Disclaimer on
                        other routes is not mounted here, and the footer only
                        draws from 1280px up - so below that this page had none
                        at all. It closes the ticket, where the reference puts
                        it; hidden in dtrader.scss wherever the footer has one. */}
                    {/* The recording keeps this on screen through the whole
                        wait, at the foot of the page rather than at the foot of
                        a ticket nobody can see yet - so while the loader is up
                        it stands over it, where the reference has it. */}
                    <div className={`mw-dt__disclaimer${prices.length === 0 ? ' mw-dt__disclaimer--waiting' : ''}`}>
                        <RiskDisclaimer />
                    </div>
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
