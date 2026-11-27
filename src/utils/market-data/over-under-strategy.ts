/**
 * MaziwaTrader — user-supplied digit Over/Under scan conditions.
 *
 * All statistics use real tick last digits in NEWEST-first order.
 * A qualifying historical pattern is NOT a current entry confirmation.
 * Bar colours here are derived scanner indicators, not colours supplied by
 * Deriv's tick-history API or sampled from a separate chart.
 * This module never places trades.
 */
export type TSide = 'OVER' | 'UNDER';
export type TBarColor = 'red' | 'yellow' | 'blue' | 'green' | 'neutral';
export type TPrediction = 0 | 1 | 2 | 3 | 6 | 7 | 8 | 9;

export interface TStrategyMatch {
    side: TSide;
    prediction: TPrediction;
    eligible: boolean;
    /** Historical last-two-digit pattern only; never a live buy instruction. */
    entryReady: boolean;
    percentages: number[];
    counts: number[];
    barColors: TBarColor[];
    leastTriggerDigits: number[];
    triggerDigit: number | null;
    confirmationDigit: number | null;
    lowDigits: number[];
    strongDigits: number[];
    trendDecreasing: boolean;
    reason: string;
}

export interface TMarketSymbol {
    underlying_symbol: string;
    underlying_symbol_name: string;
    market: string;
    exchange_is_open: 0 | 1;
    is_trading_suspended: 0 | 1;
}

type TSideConfig = { side: TSide; prediction: TPrediction; low: number[]; strong: number[] };
const OVER_STRONG = [4, 5, 6, 7, 8, 9];
const UNDER_STRONG = [0, 1, 2, 3, 4, 5];

// The smaller prediction options are allowed only when THEIR own low-digit
// groups meet the rules. The menu does not silently lower a prediction.
const SIDE_CONFIGS: TSideConfig[] = [
    { side: 'OVER', prediction: 3, low: [0, 1, 2, 3], strong: OVER_STRONG },
    { side: 'OVER', prediction: 2, low: [0, 1, 2], strong: OVER_STRONG },
    { side: 'OVER', prediction: 1, low: [0, 1], strong: OVER_STRONG },
    { side: 'OVER', prediction: 0, low: [0], strong: OVER_STRONG },
    { side: 'UNDER', prediction: 6, low: [6, 7, 8, 9], strong: UNDER_STRONG },
    { side: 'UNDER', prediction: 7, low: [7, 8, 9], strong: UNDER_STRONG },
    { side: 'UNDER', prediction: 8, low: [8, 9], strong: UNDER_STRONG },
    { side: 'UNDER', prediction: 9, low: [9], strong: UNDER_STRONG },
];

const TREND_WINDOW = 200;

/** Scanner colours: red/yellow for below-10% lows; green/blue for >=11% highs. */
export function displayBarColors(percentages: number[], low: number[], strong: number[]): TBarColor[] {
    const colors: TBarColor[] = Array<TBarColor>(10).fill('neutral');
    const lowest = [...low].sort((a, b) => percentages[a] - percentages[b] || a - b)[0];
    for (const digit of low) {
        if (percentages[digit] < 10) colors[digit] = digit === lowest ? 'red' : 'yellow';
    }
    const high = strong.filter(digit => percentages[digit] >= 11)
        .sort((a, b) => percentages[b] - percentages[a] || a - b);
    high.forEach((digit, index) => { colors[digit] = index === 0 ? 'green' : 'blue'; });
    return colors;
}

/**
 * "Decreasing" is measured as non-increasing occurrence percentage for
 * EACH low-frequency digit in the latest window versus the preceding equally
 * sized window (up to 200 ticks each). It is not assumed to mean the
 * numerical order 0 > 1 > 2 > 3 or 9 > 8 > 7 > 6.
 */
const lowFrequencyDecreasing = (digits: number[], low: number[]): boolean => {
    const size = Math.min(TREND_WINDOW, Math.floor(digits.length / 2));
    if (size === 0) return false;
    const latest = digits.slice(0, size);
    const previous = digits.slice(size, size * 2);
    return low.every(digit =>
        latest.filter(value => value === digit).length <= previous.filter(value => value === digit).length
    );
};

export function evaluateOverUnder(digitsNewestFirst: number[], minSample = 100): TStrategyMatch[] {
    if (digitsNewestFirst.some(d => !Number.isInteger(d) || d < 0 || d > 9)) {
        throw new Error('Expected last digits 0–9 in newest-first order.');
    }
    const counts = Array<number>(10).fill(0);
    for (const digit of digitsNewestFirst) counts[digit]++;
    const percentages = counts.map(count =>
        digitsNewestFirst.length ? (100 * count) / digitsNewestFirst.length : 0
    );

    return SIDE_CONFIGS.map(config => {
        const lowEnough = config.low.every(d => percentages[d] < 10);
        const high = config.strong.filter(d => percentages[d] >= 11);
        const trendDecreasing = lowFrequencyDecreasing(digitsNewestFirst, config.low);
        const barColors = displayBarColors(percentages, config.low, config.strong);
        const lowBar = config.low.some(d => barColors[d] === 'red' || barColors[d] === 'yellow');
        const highBars = config.strong.some(d => barColors[d] === 'green') &&
            config.strong.some(d => barColors[d] === 'blue');
        const sufficientData = digitsNewestFirst.length >= minSample;
        const eligible = sufficientData && lowEnough && trendDecreasing &&
            high.length >= 2 && lowBar && highBars;

        // Live entry patterns: Over follows the supplied 1/2/3 -> 4..9 rule.
        // Under uses its mirrored low-frequency sequence (6/7/8 -> 0..5),
        // consistent with the supplied Under frequency groups. The reference
        // video demonstrates a launched bot but does not expose its XML.
        // This is an explicit scanner implementation choice, not a claim that
        // the reference bot's private entry code was recovered.
        const triggerDigits = config.side === 'OVER' ? [1, 2, 3] : [6, 7, 8];
        const least = Math.min(...triggerDigits.map(d => counts[d]));
        const leastTriggerDigits = triggerDigits.filter(d => counts[d] === least);
        const triggerDigit = digitsNewestFirst.length > 1 ? digitsNewestFirst[1] : null;
        const confirmationDigit = digitsNewestFirst.length ? digitsNewestFirst[0] : null;
        const confirmed = triggerDigit !== null && confirmationDigit !== null &&
            leastTriggerDigits.includes(triggerDigit) &&
            (config.side === 'OVER'
                ? confirmationDigit >= 4 && confirmationDigit <= 9
                : confirmationDigit >= 0 && confirmationDigit <= 4);

        let reason: string;
        if (!sufficientData) reason = `Need at least ${minSample} historical ticks.`;
        else if (!lowEnough) reason = `Digits ${config.low.join(', ')} must all be below 10%.`;
        else if (!trendDecreasing) reason = `Digits ${config.low.join(', ')} are not all decreasing across the last two tick windows.`;
        else if (high.length < 2 || !highBars) reason = `Need two ${config.strong.join(', ')} digits at 11% or higher (blue and green scanner bars).`;
        else if (!lowBar) reason = 'Missing a red or yellow low-frequency scanner bar.';
        else if (confirmed) reason = 'Historical two-tick pattern observed. This does not confirm a live entry.';
        else reason = config.side === 'OVER'
            ? 'Over frequency filters met. Waiting for least digit 1/2/3, then 4–9 on the following live tick.'
            : 'Under frequency filters met. Waiting for least digit 6/7/8, then 0–4 on the following live tick.';

        return {
            side: config.side,
            prediction: config.prediction,
            eligible,
            entryReady: eligible && confirmed,
            counts: [...counts],
            percentages: [...percentages],
            barColors,
            leastTriggerDigits,
            triggerDigit,
            confirmationDigit,
            lowDigits: [...config.low],
            strongDigits: [...config.strong],
            trendDecreasing,
            reason,
        };
    });
}

/**
 * Include every currently open synthetic index returned by the API. This
 * dynamically includes Jump markets and new synthetic indices if available.
 * Before offering a trade, check contracts_for for DIGITOVER / DIGITUNDER.
 */
export function discoverSyntheticMarkets(symbols: TMarketSymbol[]): TMarketSymbol[] {
    const unique = new Set<string>();
    return symbols.filter(item => {
        if (item.market !== 'synthetic_index' || item.exchange_is_open !== 1 ||
            item.is_trading_suspended === 1 || !item.underlying_symbol || unique.has(item.underlying_symbol)) return false;
        unique.add(item.underlying_symbol);
        return true;
    });
}

/** Contract availability differs across symbols; do not infer it by name. */
export function allowsSide(
    contracts: { contract_type: string }[], side: TSide
): boolean {
    return contracts.some(c => c.contract_type === (side === 'OVER' ? 'DIGITOVER' : 'DIGITUNDER'));
}
