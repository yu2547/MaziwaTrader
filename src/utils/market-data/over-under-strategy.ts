/**
 * MaziwaTrader — strict, deterministic Over/Under scanner filters.
 * This module evaluates rules supplied by the user, not winning probabilities.
 * Input digits MUST be newest first, and use the market's actual pip precision.
 * No trade is placed by this module.
 */
export type TSide = 'OVER' | 'UNDER';
export type TBarColor = 'red' | 'yellow' | 'blue' | 'green' | 'neutral';
export type TPrediction = 1 | 2 | 3 | 6 | 7 | 8;

export interface TStrategyMatch {
    side: TSide;
    prediction: TPrediction;
    eligible: boolean;
    entryReady: boolean;
    percentages: number[];
    counts: number[];
    barColors: TBarColor[];
    leastTriggerDigits: number[];
    triggerDigit: number | null;
    confirmationDigit: number | null;
    lowDigits: number[];
    strongDigits: number[];
    reason: string;
}

export interface TMarketSymbol {
    underlying_symbol: string;
    underlying_symbol_name: string;
    market: string;
    exchange_is_open: 0 | 1;
    is_trading_suspended: 0 | 1;
}

const SIDE_CONFIGS: { side: TSide; prediction: TPrediction; low: number[]; strong: number[]; trigger: number[]; next: number[] }[] = [
    { side: 'OVER', prediction: 3, low: [0, 1, 2, 3], strong: [4, 5, 6, 7, 8, 9], trigger: [1, 2, 3], next: [4, 5, 6, 7, 8, 9] },
    { side: 'OVER', prediction: 2, low: [0, 1, 2], strong: [4, 5, 6, 7, 8, 9], trigger: [1, 2, 3], next: [4, 5, 6, 7, 8, 9] },
    { side: 'OVER', prediction: 1, low: [0, 1], strong: [4, 5, 6, 7, 8, 9], trigger: [1, 2, 3], next: [4, 5, 6, 7, 8, 9] },
    { side: 'UNDER', prediction: 6, low: [6, 7, 8, 9], strong: [0, 1, 2, 3, 4, 5], trigger: [8, 7, 6], next: [0, 1, 2, 3, 4] },
    { side: 'UNDER', prediction: 7, low: [7, 8, 9], strong: [0, 1, 2, 3, 4, 5], trigger: [8, 7, 6], next: [0, 1, 2, 3, 4] },
    { side: 'UNDER', prediction: 8, low: [8, 9], strong: [0, 1, 2, 3, 4, 5], trigger: [8, 7, 6], next: [0, 1, 2, 3, 4] },
];

/**
 * Assign scanner UI bars explicitly. Deriv tick history supplies numbers, NOT
 * red/yellow/green/blue bar colours. Red/yellow = under 10%; green = highest
 * within qualifying strong range, blue = other >=11% within that range.
 */
export function displayBarColors(percentages: number[], low: number[], strong: number[]): TBarColor[] {
    const colors: TBarColor[] = Array<TBarColor>(10).fill('neutral');
    const lowest = [...low].sort((a, b) => percentages[a] - percentages[b] || a - b)[0];
    for (const d of low) if (percentages[d] < 10) colors[d] = d === lowest ? 'red' : 'yellow';
    const high = strong.filter(d => percentages[d] >= 11).sort((a, b) => percentages[b] - percentages[a] || a - b);
    high.forEach((d, i) => { colors[d] = i === 0 ? 'green' : 'blue'; });
    return colors;
}

export function evaluateOverUnder(digitsNewestFirst: number[], minSample = 100): TStrategyMatch[] {
    if (digitsNewestFirst.some(d => !Number.isInteger(d) || d < 0 || d > 9)) {
        throw new Error('Expected last digits 0–9 in newest-first order.');
    }
    const counts = Array<number>(10).fill(0);
    for (const d of digitsNewestFirst) counts[d]++;
    const percentages = counts.map(count => digitsNewestFirst.length ? (100 * count) / digitsNewestFirst.length : 0);

    return SIDE_CONFIGS.map(config => {
        const lowEnough = config.low.every(d => percentages[d] < 10);
        const highs = config.strong.filter(d => percentages[d] >= 11);
        const sufficientData = digitsNewestFirst.length >= minSample;
        const least = Math.min(...config.trigger.map(d => counts[d]));
        // Ties are allowed; no fabricated 'unique least frequent digit'.
        const leastTriggerDigits = config.trigger.filter(d => counts[d] === least);
        const triggerDigit = digitsNewestFirst.length > 1 ? digitsNewestFirst[1] : null;
        const confirmationDigit = digitsNewestFirst.length ? digitsNewestFirst[0] : null;
        const eligible = sufficientData && lowEnough && highs.length >= 2;
        const confirmed = triggerDigit !== null && confirmationDigit !== null &&
            leastTriggerDigits.includes(triggerDigit) && config.next.includes(confirmationDigit);
        const entryReady = eligible && confirmed;

        let reason: string;
        if (!sufficientData) reason = `Need at least ${minSample} historical ticks.`;
        else if (!lowEnough) reason = `Low-frequency digits (${config.low.join(', ')}) are not all below 10%.`;
        else if (highs.length < 2) reason = `Need at least two digits (${config.strong.join(', ')}) at 11% or higher.`;
        else if (!confirmed) reason = 'Filters matched; waiting for the least-frequency trigger and its very next qualifying tick.';
        else reason = 'Historical last-two-tick confirmation matched. Recheck on live ticks before placing a trade.';

        return {
            side: config.side, prediction: config.prediction, eligible, entryReady,
            counts: [...counts], percentages: [...percentages],
            barColors: displayBarColors(percentages, config.low, config.strong),
            leastTriggerDigits, triggerDigit, confirmationDigit,
            lowDigits: [...config.low], strongDigits: [...config.strong], reason,
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
