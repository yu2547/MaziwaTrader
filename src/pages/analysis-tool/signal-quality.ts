/**
 * The maths behind the Signals scanner's GOOD MARKET verdict, kept apart from
 * the component so it can be tested without a DOM, a feed or a socket.
 *
 * What this file is NOT: a prediction of the next tick, a probability of
 * winning, or a measure of profitability. Every number here describes the
 * window of ticks that has already happened.
 */

export type TStrategy = 'matches_differs' | 'even_odd' | 'over_under' | 'rise_fall';

export type TSide = {
    /** The rate this side runs at when digits are uniform: 50 for EVEN, 10 for a single digit. */
    baseline: number;
    label: string;
    /** Observed rate over the window, in percent. */
    pct: number;
};

export type TScoredSide = TSide & {
    /** Observed minus expected, in percentage points. */
    edge: number;
    /** Standard error of the baseline proportion at this sample size, in percentage points. */
    se: number;
    /** edge / se. How many standard errors the window sits from uniform. */
    z: number;
};

/**
 * Below this the normal approximation is being asked to do too much and, more
 * practically, the window is still filling: it is seeded from tick history, so
 * a sample this short only happens in the moments after a market change, when a
 * verdict would be premature anyway. n(1-p)p is 45 at the tightest baseline
 * here, comfortably inside where the approximation behaves.
 *
 * This is a floor, not a calibrated figure.
 */
export const MIN_SAMPLE = 500;

/**
 * Normalised Shannon entropy of the ten digit frequencies, H / ln(10), so a
 * perfectly uniform window scores 1 and a window with one repeated digit
 * scores 0.
 *
 * This is a data-integrity guard rather than a signal filter. Real digit
 * markets sit at 0.998 and above; the threshold sits far below anything a
 * legitimate signal produces, and exists to reject windows that are not
 * behaving like a ten-outcome digit process at all - a market quoted to fewer
 * decimals than assumed, a stuck feed, a quantised instrument.
 *
 * 0.98 corresponds to roughly a 20% share for a single digit with the rest
 * uniform. For reference: 25% share scores 0.960, 20% scores 0.981, 18% scores
 * 0.987, and the 88%-one-digit case that motivated this scores 0.274. A
 * genuine leading digit at 13.4% scores about 0.9985.
 */
export const MIN_ENTROPY = 0.98;

/**
 * The family-wise one-sided false-positive rate the evidence bar is set to -
 * the rate a plain z = 3 test would give. Chosen to be strict; it is a chosen
 * target, not a derived one.
 */
export const FAMILY_ALPHA = 0.00135;

/**
 * How many candidate sides the window was searched over before one was picked.
 *
 * This is the rank-selection correction. For Even/Odd and Over/Under the sides
 * are fixed in advance and only the larger of two is taken. For Matches &
 * Differs the digit itself comes from the data - the highest of ten frequencies
 * and the lowest of ten - so twenty candidates were examined, and the naive
 * p-value for "the biggest of twenty" is not the p-value for one chosen in
 * advance.
 */
export const CANDIDATES: Record<TStrategy, number> = {
    even_odd: 2,
    matches_differs: 20,
    over_under: 2,
    // Rise and Fall are fixed in advance like Even/Odd - two sides, the larger
    // taken - so the same correction applies.
    rise_fall: 2,
};

/**
 * A tie-break, and labelled as such: it asks that the leading reading be at
 * least one standard error clear of the alternative one, so a window where both
 * readings are equally good does not get reported as though one of them won.
 * It is a heuristic, not a calibrated quantity.
 */
export const MIN_SEPARATION_Z = 1;

/** erfc via Abramowitz & Stegun 7.1.26. Absolute error below 1.5e-7, which resolves z to about ±0.005 in the tail this uses. */
const erfc = (x: number): number => {
    const t = 1 / (1 + 0.3275911 * x);
    const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    return poly * Math.exp(-x * x);
};

/** One-sided upper tail of the standard normal. */
export const normalSf = (z: number): number => (z < 0 ? 1 - normalSf(-z) : 0.5 * erfc(z / Math.SQRT2));

/** The z whose upper tail equals p, by bisection - no closed form needed and the bounds are known. */
export const zForTailProbability = (p: number): number => {
    let lo = 0;
    let hi = 10;
    for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        if (normalSf(mid) > p) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
};

/**
 * Šidák: to hold a family-wise rate of `family_alpha` across `candidates`
 * independent looks, each look must clear 1 - (1 - alpha)^(1/m).
 *
 * The looks here are not fully independent - the ten digit frequencies in one
 * window are negatively correlated, and MATCHES and DIFFERS are read from the
 * same distribution - so Šidák is conservative in the direction that matters:
 * it asks for more evidence than strict independence would require, not less.
 */
export const sidakZ = (family_alpha: number, candidates: number): number =>
    zForTailProbability(1 - (1 - family_alpha) ** (1 / candidates));

/** The standardized edge each strategy's leading side has to clear. */
export const requiredZ = (strategy: TStrategy): number => sidakZ(FAMILY_ALPHA, CANDIDATES[strategy]);

/**
 * H / ln(10) over the ten digits, where H is Shannon entropy in nats.
 * 1 is a perfectly even spread, 0 is a window of one repeated digit.
 */
export const normalizedEntropy = (digits: number[]): number => {
    if (!digits.length) return 0;
    const counts = new Array(10).fill(0);
    digits.forEach(digit => {
        if (digit >= 0 && digit <= 9) counts[digit] += 1;
    });
    let entropy = 0;
    counts.forEach(count => {
        if (count > 0) {
            const p = count / digits.length;
            entropy -= p * Math.log(p);
        }
    });
    return entropy / Math.log(10);
};

/**
 * Standard error of the side's BASELINE proportion at this sample size, in
 * percentage points - deliberately the expected p, not the observed one, so
 * the yardstick does not stretch to fit whatever was measured.
 */
export const standardError = (baseline: number, n: number): number => {
    if (n <= 0) return 0;
    const p = baseline / 100;
    return Math.sqrt((p * (1 - p)) / n) * 100;
};

/** Sides scored and ranked by evidence rather than by raw point gap. */
export const scoreSides = (sides: TSide[], n: number): TScoredSide[] =>
    sides
        .map(side => {
            const se = standardError(side.baseline, n);
            const edge = side.pct - side.baseline;
            return { ...side, edge, se, z: se > 0 ? edge / se : 0 };
        })
        .sort((a, b) => b.z - a.z);

export type TEvaluation = {
    entropy: number;
    leader: TScoredSide | null;
    /** True only when every gate below has passed. */
    qualifies: boolean;
    required_z: number;
    runner_up: TScoredSide | null;
    scored: TScoredSide[];
    separation_z: number;
};

/**
 * The whole verdict in one pure function, in the order the pipeline runs:
 * sufficient sample, then distribution quality, then evidence for the leading
 * side, then that it is clear of the alternative.
 *
 * `has_feed` is passed in rather than assumed so the caller's connection state
 * is part of the same decision instead of a separate one made elsewhere.
 */
export const evaluateWindow = ({
    digits,
    has_feed,
    sides,
    strategy,
}: {
    digits: number[];
    has_feed: boolean;
    sides: TSide[];
    strategy: TStrategy;
}): TEvaluation => {
    const n = digits.length;
    const scored = scoreSides(sides, n);
    const leader = scored[0] ?? null;
    const runner_up = scored[1] ?? null;
    const entropy = normalizedEntropy(digits);
    const required_z = requiredZ(strategy);
    const separation_z = leader && runner_up ? leader.z - runner_up.z : 0;

    const qualifies =
        has_feed &&
        n >= MIN_SAMPLE &&
        entropy >= MIN_ENTROPY &&
        !!leader &&
        leader.z >= required_z &&
        separation_z >= MIN_SEPARATION_Z;

    return { entropy, leader, qualifies, required_z, runner_up, scored, separation_z };
};
