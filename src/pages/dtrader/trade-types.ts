/**
 * The ten contract families Deriv's own DTrader offers, and what each one
 * needs to be priced.
 *
 * Every request shape below was confirmed live against Deriv's public pricing
 * endpoint rather than read off documentation, because several of them are not
 * what you would guess:
 *
 *   - Higher/Lower is NOT CALL/PUT with a barrier. CALL with a barrier is
 *     rejected ("Invalid barrier"); the contract types are HIGHER and LOWER,
 *     in their own `higherlower` category.
 *   - Turbos will not price from a barrier of your choosing - a wrong one comes
 *     back as "Barriers available are -2.43, -4.28, ..." - but will price from
 *     `payout_per_point`, and then reports the barrier it chose.
 *   - Accumulators and Multipliers take no duration at all.
 *   - Vanillas return their own `barrier_choices`, so the strike is picked from
 *     Deriv's list rather than typed.
 */

export type TDurationUnit = 't' | 'm';

export type TTradeParams = {
    allow_equals: boolean;
    barrier_offset: string;
    digit: number;
    duration: number;
    duration_unit: TDurationUnit;
    growth_rate: number;
    multiplier: number;
    payout_per_point: string;
    stake: number;
    strike: string;
    take_profit: string;
};

export type TTradeType = {
    /** Deriv marks these with a flame in its own tab row. */
    hot?: boolean;
    id: string;
    label: string;
    /** The two sides, or one entry when the contract has no direction. */
    sides: { contract_type: string; label: string }[];
    /** Which controls the ticket shows. */
    fields: (
        | 'allow_equals'
        | 'barrier'
        | 'digit'
        | 'duration'
        | 'growth_rate'
        | 'multiplier'
        | 'payout_per_point'
        | 'stake'
        | 'strike'
        | 'take_profit'
    )[];
    /** Ticks only, minutes only, or the trader's choice. */
    duration_units: TDurationUnit[];
    /** Deriv's own bounds, from contracts_for: 5t-10t here, 2m upwards there. */
    min_ticks?: number;
    max_ticks?: number;
    min_minutes?: number;
    max_minutes?: number;
    /** Which contracts_for category tells us a symbol supports this. */
    category: string;
    /** The 0-9 distribution belongs under the chart for the digit contracts. */
    shows_digit_stats?: boolean;
};

export const TRADE_TYPES: TTradeType[] = [
    {
        category: 'digits',
        duration_units: ['t'],
        fields: ['duration', 'stake'],
        hot: true,
        id: 'even_odd',
        label: 'Even/Odd',
        max_ticks: 10,
        min_ticks: 1,
        shows_digit_stats: true,
        sides: [
            { contract_type: 'DIGITEVEN', label: 'Even' },
            { contract_type: 'DIGITODD', label: 'Odd' },
        ],
    },
    {
        category: 'digits',
        duration_units: ['t'],
        fields: ['digit', 'duration', 'stake'],
        id: 'over_under',
        label: 'Over/Under',
        max_ticks: 10,
        min_ticks: 1,
        shows_digit_stats: true,
        sides: [
            { contract_type: 'DIGITOVER', label: 'Over' },
            { contract_type: 'DIGITUNDER', label: 'Under' },
        ],
    },
    {
        category: 'digits',
        duration_units: ['t'],
        fields: ['digit', 'duration', 'stake'],
        id: 'matches_differs',
        label: 'Matches/Differs',
        max_ticks: 10,
        min_ticks: 1,
        shows_digit_stats: true,
        sides: [
            { contract_type: 'DIGITMATCH', label: 'Matches' },
            { contract_type: 'DIGITDIFF', label: 'Differs' },
        ],
    },
    {
        category: 'callput',
        duration_units: ['t', 'm'],
        fields: ['duration', 'stake', 'allow_equals'],
        hot: true,
        id: 'rise_fall',
        label: 'Rise/Fall',
        max_minutes: 1440,
        max_ticks: 10,
        min_minutes: 1,
        min_ticks: 1,
        sides: [
            { contract_type: 'CALL', label: 'Rise' },
            { contract_type: 'PUT', label: 'Fall' },
        ],
    },
    {
        category: 'accumulator',
        duration_units: [],
        fields: ['growth_rate', 'stake', 'take_profit'],
        hot: true,
        id: 'accumulators',
        label: 'Accumulators',
        sides: [{ contract_type: 'ACCU', label: 'Buy' }],
    },
    {
        category: 'multiplier',
        duration_units: [],
        fields: ['multiplier', 'stake', 'take_profit'],
        id: 'multipliers',
        label: 'Multipliers',
        sides: [
            { contract_type: 'MULTUP', label: 'Up' },
            { contract_type: 'MULTDOWN', label: 'Down' },
        ],
    },
    {
        category: 'turbos',
        duration_units: ['t', 'm'],
        fields: ['duration', 'stake', 'payout_per_point', 'take_profit'],
        id: 'turbos',
        label: 'Turbos',
        max_minutes: 1440,
        max_ticks: 10,
        min_minutes: 1,
        min_ticks: 1,
        sides: [
            { contract_type: 'TURBOSLONG', label: 'Up' },
            { contract_type: 'TURBOSSHORT', label: 'Down' },
        ],
    },
    {
        category: 'vanilla',
        duration_units: ['m'],
        fields: ['duration', 'strike', 'stake'],
        id: 'vanillas',
        label: 'Vanillas',
        max_minutes: 1440,
        min_minutes: 1,
        sides: [
            { contract_type: 'VANILLALONGCALL', label: 'Call' },
            { contract_type: 'VANILLALONGPUT', label: 'Put' },
        ],
    },
    {
        category: 'higherlower',
        duration_units: ['t', 'm'],
        fields: ['duration', 'barrier', 'stake'],
        id: 'higher_lower',
        label: 'Higher/Lower',
        max_minutes: 1440,
        max_ticks: 10,
        // contracts_for: higherlower starts at 5 ticks, not 1.
        min_minutes: 1,
        min_ticks: 5,
        sides: [
            { contract_type: 'HIGHER', label: 'Higher' },
            { contract_type: 'LOWER', label: 'Lower' },
        ],
    },
    {
        category: 'touchnotouch',
        duration_units: ['t', 'm'],
        fields: ['duration', 'barrier', 'stake'],
        id: 'touch_no_touch',
        label: 'Touch/No Touch',
        max_minutes: 1440,
        max_ticks: 10,
        // contracts_for: intraday touch/no touch does not price under 2 minutes.
        min_minutes: 2,
        min_ticks: 5,
        sides: [
            { contract_type: 'ONETOUCH', label: 'Touch' },
            { contract_type: 'NOTOUCH', label: 'No Touch' },
        ],
    },
];

export const DEFAULT_PARAMS: TTradeParams = {
    allow_equals: false,
    barrier_offset: '+0.45',
    digit: 3,
    duration: 5,
    duration_unit: 't',
    growth_rate: 0.03,
    multiplier: 40,
    payout_per_point: '',
    stake: 1,
    strike: '+0.00',
    take_profit: '',
};

export const GROWTH_RATES = [0.01, 0.02, 0.03, 0.04, 0.05];
export const MULTIPLIERS = [30, 40, 50, 100, 200, 400];

export const findTradeType = (id: string) => TRADE_TYPES.find(type => type.id === id) ?? TRADE_TYPES[0];

/** "15s", "2m", "1d", "10t" - Deriv's own way of writing a contract's limits. */
const toSeconds = (value: string) => {
    const amount = parseFloat(value);
    if (Number.isNaN(amount)) return 0;
    const unit = value.replace(/[\d.]/g, '');
    if (unit === 's') return amount;
    if (unit === 'm') return amount * 60;
    if (unit === 'h') return amount * 3600;
    if (unit === 'd') return amount * 86400;
    return amount;
};

export type TDurationBounds = {
    minutes: { max: number; min: number } | null;
    ticks: { max: number; min: number } | null;
    units: TDurationUnit[];
};

/**
 * How long this contract may run *on this market*, from Deriv's own
 * contracts_for rather than from a range of ours.
 *
 * It matters more than it looks: the durations that price on a volatility
 * index do not price on EUR/USD, where Rise/Fall has no tick contracts at all
 * and the shortest intraday one is minutes long. Offering the synthetic
 * ranges everywhere produced a ticket that could only answer "Trading is not
 * offered for this duration."
 */
export const durationBounds = (
    contracts: {
        contract_category: string;
        expiry_type: string;
        max_contract_duration: string;
        min_contract_duration: string;
    }[],
    type: TTradeType
): TDurationBounds => {
    const mine = contracts.filter(contract => contract.contract_category === type.category);
    const ticks = mine.filter(contract => contract.expiry_type === 'tick');
    const intraday = mine.filter(contract => contract.expiry_type === 'intraday');

    const fallback: TDurationBounds = {
        minutes: type.duration_units.includes('m') ? { max: type.max_minutes ?? 60, min: type.min_minutes ?? 1 } : null,
        ticks: type.duration_units.includes('t') ? { max: type.max_ticks ?? 10, min: type.min_ticks ?? 1 } : null,
        units: type.duration_units,
    };
    if (!mine.length) return fallback;

    const tick_bounds = ticks.length
        ? {
              max: Math.max(...ticks.map(contract => toSeconds(contract.max_contract_duration))),
              min: Math.min(...ticks.map(contract => toSeconds(contract.min_contract_duration))),
          }
        : null;
    const minute_bounds = intraday.length
        ? {
              max: Math.min(1440, Math.floor(Math.max(...intraday.map(c => toSeconds(c.max_contract_duration))) / 60)),
              min: Math.max(1, Math.ceil(Math.min(...intraday.map(c => toSeconds(c.min_contract_duration))) / 60)),
          }
        : null;

    const units = type.duration_units.filter(unit => (unit === 't' ? tick_bounds : minute_bounds));
    return {
        minutes: type.duration_units.includes('m') ? minute_bounds : null,
        ticks: type.duration_units.includes('t') ? tick_bounds : null,
        units,
    };
};

/**
 * The contract type actually sent. Rise/Fall is the one place where a control
 * changes it: "Allow equals" is Deriv's rise-or-equal pair, where a tick
 * landing exactly on the entry spot wins instead of losing.
 */
export const contractTypeFor = (type: TTradeType, side_index: number, params: TTradeParams) => {
    const contract_type = type.sides[side_index]?.contract_type ?? type.sides[0].contract_type;
    if (type.id !== 'rise_fall' || !params.allow_equals) return contract_type;
    return contract_type === 'CALL' ? 'CALLE' : 'PUTE';
};

/**
 * Builds the request that prices this ticket - and the one that buys it, so a
 * payout on screen is a payout for the contract the button sends and not an
 * approximation of it.
 *
 * The instrument is left to the caller: the pricing endpoint names it
 * `underlying_symbol` and the classic socket names it `symbol`.
 */
export const buildTradeRequest = (
    type: TTradeType,
    side_index: number,
    params: TTradeParams,
    currency: string
): Record<string, unknown> => {
    const request: Record<string, unknown> = {
        amount: params.stake,
        basis: 'stake',
        contract_type: contractTypeFor(type, side_index, params),
        currency,
    };

    if (type.duration_units.length) {
        request.duration = params.duration;
        request.duration_unit = params.duration_unit;
    }
    if (type.fields.includes('digit')) request.barrier = String(params.digit);
    if (type.fields.includes('barrier')) request.barrier = params.barrier_offset;
    if (type.fields.includes('strike')) request.barrier = params.strike;
    if (type.fields.includes('growth_rate')) request.growth_rate = params.growth_rate;
    if (type.fields.includes('multiplier')) request.multiplier = params.multiplier;
    if (type.fields.includes('payout_per_point')) {
        // '0' rather than nothing when none has been chosen yet: omitting it
        // is refused with "Missing required contract parameters", which names
        // no values, while a value Deriv does not offer is refused with the
        // list of the ones it does - and that list is what fills the control.
        request.payout_per_point = params.payout_per_point || '0';
    }

    // Deriv carries take profit as a limit order on the contract, not as a
    // parameter of its own.
    const take_profit = Number(params.take_profit);
    if (type.fields.includes('take_profit') && params.take_profit !== '' && !Number.isNaN(take_profit)) {
        request.limit_order = { take_profit };
    }

    return request;
};
