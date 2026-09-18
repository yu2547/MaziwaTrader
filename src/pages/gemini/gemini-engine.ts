import {
    FAMILY_ALPHA,
    MIN_ENTROPY,
    MIN_SAMPLE,
    normalizedEntropy,
    sidakZ,
    standardError,
} from '@/pages/analysis-tool/signal-quality';

/**
 * How Gemini reads a market and decides which one to be on.
 *
 * Kept apart from the panel so it can be tested without a DOM, a feed or a
 * socket - the same split signal-quality.ts already uses, and the statistics
 * below are that module's, not a second set.
 *
 * What this file is NOT: a prediction of the next tick, a probability of
 * winning, or a measure of profitability. Every number here describes a window
 * of ticks that has already printed. A market ranking above another means its
 * window sat further from uniform, and nothing more.
 */

export type TGeminiFamily = 'digits_over' | 'digits_under' | 'digits_even' | 'digits_odd' | 'rise' | 'fall';

export const GEMINI_FAMILIES: { id: TGeminiFamily; label: string }[] = [
    { id: 'digits_over', label: 'Digits Over' },
    { id: 'digits_under', label: 'Digits Under' },
    { id: 'digits_even', label: 'Digits Even' },
    { id: 'digits_odd', label: 'Digits Odd' },
    { id: 'rise', label: 'Rise' },
    { id: 'fall', label: 'Fall' },
];

/**
 * How many readings the window was searched over before one was reported.
 *
 * Over and Under pick their barrier from the data - nine of them, 0-8 for OVER
 * and 1-9 for UNDER - so the naive p-value for "the best of nine" is not the
 * p-value for a barrier chosen in advance. Even, Odd, Rise and Fall are fixed
 * in advance and searched over nothing, so they stand on one look.
 */
const CANDIDATES: Record<TGeminiFamily, number> = {
    digits_even: 1,
    digits_odd: 1,
    digits_over: 9,
    digits_under: 9,
    fall: 1,
    rise: 1,
};

/** The evidence bar a family's reading has to clear, corrected for that search. */
export const requiredZ = (family: TGeminiFamily): number => sidakZ(FAMILY_ALPHA, CANDIDATES[family]);

export const isDigitFamily = (family: TGeminiFamily): boolean => family !== 'rise' && family !== 'fall';

export type TGeminiWindow = {
    /** Last digits over the window, oldest first. */
    digits: number[];
    /** The quotes those digits came from, oldest first - what Rise/Fall reads. */
    prices: number[];
};

export type TGeminiReading = {
    /** The barrier the contract carries, for the families that have one. */
    barrier?: number;
    /** Deriv's own contract code, which is what gets bought. */
    contract_type: string;
    /** Observed rate minus the family's baseline, in percentage points. */
    edge: number;
    /** The reading in the words the panel shows, e.g. "OVER 2". */
    entry: string;
    /** Normalised digit entropy of the window - a data-integrity guard. */
    entropy: number;
    /** How many observations the rate was counted over. */
    n: number;
    /** Observed rate over the window, in percent. */
    pct: number;
    /** True only when the sample, the entropy and the evidence all pass. */
    qualifies: boolean;
    /** Observed minus expected, in standard errors. Ranks markets against each other. */
    z: number;
};

const score = ({
    baseline,
    entropy,
    entry,
    family,
    hits,
    n,
    ...rest
}: {
    barrier?: number;
    baseline: number;
    contract_type: string;
    entropy: number;
    entry: string;
    family: TGeminiFamily;
    hits: number;
    n: number;
}): TGeminiReading => {
    const pct = n > 0 ? (hits / n) * 100 : 0;
    const se = standardError(baseline, n);
    const edge = pct - baseline;
    const z = se > 0 ? edge / se : 0;
    return {
        ...rest,
        edge,
        entropy,
        entry,
        n,
        pct,
        qualifies: n >= MIN_SAMPLE && entropy >= MIN_ENTROPY && z >= requiredZ(family),
        z,
    };
};

/**
 * The best barrier for an Over or an Under, chosen by evidence rather than by
 * the raw rate.
 *
 * Picking the highest percentage would always land on OVER 0 and UNDER 9,
 * because those are the widest bets - 90% of digits clear them. What matters is
 * how far the window sits from where a uniform market would put it, which is
 * what the z below measures, and that is comparable across barriers.
 */
const bestDigitBarrier = (digits: number[], family: 'digits_over' | 'digits_under'): TGeminiReading | null => {
    const n = digits.length;
    if (!n) return null;
    const entropy = normalizedEntropy(digits);
    const is_over = family === 'digits_over';
    const barriers = is_over ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [1, 2, 3, 4, 5, 6, 7, 8, 9];

    const readings = barriers.map(barrier => {
        const hits = digits.filter(digit => (is_over ? digit > barrier : digit < barrier)).length;
        // Ten equally likely digits: OVER b clears (9 - b) of them, UNDER b
        // clears b of them.
        const baseline = (is_over ? 9 - barrier : barrier) * 10;
        return score({
            barrier,
            baseline,
            contract_type: is_over ? 'DIGITOVER' : 'DIGITUNDER',
            entropy,
            entry: `${is_over ? 'OVER' : 'UNDER'} ${barrier}`,
            family,
            hits,
            n,
        });
    });
    return readings.reduce((best, reading) => (reading.z > best.z ? reading : best));
};

/**
 * Rise and Fall are not digit readings, so they are counted over the moves
 * between quotes rather than over the last digits.
 *
 * Flat ticks are dropped rather than counted as either side: a quote that did
 * not move is not a rise and not a fall, and folding it into one of them would
 * bias that side by however often the market happens to repeat a price. The
 * sample the evidence is judged on is therefore the number of ticks that
 * actually moved, which is what `n` reports.
 */
const riseFall = (prices: number[], family: 'rise' | 'fall'): TGeminiReading | null => {
    if (prices.length < 2) return null;
    let moves = 0;
    let hits = 0;
    for (let i = 1; i < prices.length; i++) {
        const delta = prices[i] - prices[i - 1];
        if (delta === 0) continue;
        moves += 1;
        if (family === 'rise' ? delta > 0 : delta < 0) hits += 1;
    }
    return score({
        baseline: 50,
        contract_type: family === 'rise' ? 'CALL' : 'PUT',
        // Entropy is a property of the digit distribution and says nothing
        // about a direction count, so this reading is not gated on it. Passing
        // the threshold keeps the single `qualifies` rule in score() honest
        // rather than growing a second one.
        entropy: MIN_ENTROPY,
        entry: family === 'rise' ? 'RISE' : 'FALL',
        family,
        hits,
        n: moves,
    });
};

/** Reads one market's window for one family. Null when there is nothing to read yet. */
export const readWindow = (family: TGeminiFamily, window: TGeminiWindow): TGeminiReading | null => {
    if (family === 'digits_over' || family === 'digits_under') return bestDigitBarrier(window.digits, family);
    if (family === 'rise' || family === 'fall') return riseFall(window.prices, family);

    const digits = window.digits;
    const n = digits.length;
    if (!n) return null;
    const is_even = family === 'digits_even';
    // Deriv settles 0 as even, which is what DIGITEVEN pays on.
    const hits = digits.filter(digit => (digit % 2 === 0) === is_even).length;
    return score({
        baseline: 50,
        contract_type: is_even ? 'DIGITEVEN' : 'DIGITODD',
        entropy: normalizedEntropy(digits),
        entry: is_even ? 'EVEN' : 'ODD',
        family,
        hits,
        n,
    });
};

export type TGeminiCandidate = {
    name: string;
    reading: TGeminiReading;
    symbol: string;
};

/**
 * Every market read for the chosen family, strongest evidence first.
 *
 * This is the whole of "scans all markets at once": each market is scored on
 * its own window and they are then put in one order, so the market at the top
 * is the one whose window is furthest from uniform right now - and it changes
 * as the windows do, which is what moves Gemini from one market to another.
 */
export const rankMarkets = (
    family: TGeminiFamily,
    windows: { name: string; symbol: string; window: TGeminiWindow }[]
): TGeminiCandidate[] =>
    windows
        .map(({ name, symbol, window }) => {
            const reading = readWindow(family, window);
            return reading ? { name, reading, symbol } : null;
        })
        .filter((item): item is TGeminiCandidate => item !== null)
        .sort((a, b) => b.reading.z - a.reading.z);

/**
 * How much better a new market has to read before Gemini moves to it.
 *
 * Without this the leader swaps on noise - two markets a hair apart trade the
 * lead every few ticks, and Gemini would spend its time announcing moves rather
 * than trading. Expressed in standard errors so it means the same thing at
 * every sample size.
 */
export const SWITCH_MARGIN_Z = 0.5;

/**
 * The market Gemini should be on, given where it already is.
 *
 * Returns null when nothing qualifies - which is a real answer, and the one
 * that keeps it out of a market that is behaving uniformly.
 */
export const chooseMarket = (ranked: TGeminiCandidate[], current_symbol: string | null): TGeminiCandidate | null => {
    const leader = ranked.find(item => item.reading.qualifies) ?? null;
    if (!leader) return null;
    if (!current_symbol || leader.symbol === current_symbol) return leader;

    // Staying put is the default: the market in hand only loses the seat when
    // the challenger is clear of it by the margin, not merely ahead of it.
    const held = ranked.find(item => item.symbol === current_symbol);
    if (held?.reading.qualifies && leader.reading.z - held.reading.z < SWITCH_MARGIN_Z) return held;
    return leader;
};
