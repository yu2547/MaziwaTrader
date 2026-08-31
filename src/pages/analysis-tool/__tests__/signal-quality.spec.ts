import {
    CANDIDATES,
    evaluateWindow,
    MIN_ENTROPY,
    MIN_SAMPLE,
    normalizedEntropy,
    normalSf,
    requiredZ,
    scoreSides,
    sidakZ,
    standardError,
    TSide,
} from '../signal-quality';

/** Builds a window with an exact digit composition, so every case below is deterministic. */
const buildWindow = (shares: Partial<Record<number, number>>, n: number): number[] => {
    const digits: number[] = [];
    Object.entries(shares).forEach(([digit, share]) => {
        const count = Math.round((share as number) * n);
        for (let i = 0; i < count; i++) digits.push(Number(digit));
    });
    return digits;
};

/** Spreads a window evenly across all ten digits, then applies overrides. */
const uniformWindow = (n: number, overrides: Partial<Record<number, number>> = {}): number[] => {
    const shares: Record<number, number> = {};
    const overridden = Object.keys(overrides).map(Number);
    const remaining = 1 - overridden.reduce((sum, digit) => sum + (overrides[digit] as number), 0);
    const others = 10 - overridden.length;
    for (let digit = 0; digit <= 9; digit++) {
        shares[digit] = overridden.includes(digit) ? (overrides[digit] as number) : remaining / others;
    }
    return buildWindow(shares, n);
};

const matchesDiffersSides = (digits: number[]): TSide[] => {
    const counts = new Array(10).fill(0);
    digits.forEach(digit => (counts[digit] += 1));
    const pct = counts.map(count => (count / digits.length) * 100);
    const ranked = pct.map((value, digit) => ({ digit, value })).sort((a, b) => b.value - a.value);
    const top = ranked[0];
    const bottom = ranked[ranked.length - 1];
    return [
        { baseline: 10, label: `MATCHES ${top.digit}`, pct: top.value },
        { baseline: 90, label: `DIFFERS from ${bottom.digit}`, pct: 100 - bottom.value },
    ];
};

const evenOddSides = (digits: number[]): TSide[] => {
    const even = (digits.filter(digit => digit % 2 === 0).length / digits.length) * 100;
    return [
        { baseline: 50, label: 'EVEN', pct: even },
        { baseline: 50, label: 'ODD', pct: 100 - even },
    ];
};

describe('signal-quality: the statistics', () => {
    it('standard error uses the baseline, not the observed rate', () => {
        // p = 0.10 at n = 1000 -> sqrt(0.09/1000) * 100
        expect(standardError(10, 1000)).toBeCloseTo(0.9487, 3);
        expect(standardError(50, 1000)).toBeCloseTo(1.5811, 3);
        expect(standardError(90, 1000)).toBeCloseTo(0.9487, 3);
        expect(standardError(40, 1000)).toBeCloseTo(1.5492, 3);
        // Same baseline, quarter the sample -> twice the standard error.
        expect(standardError(10, 250)).toBeCloseTo(standardError(10, 1000) * 2, 3);
    });

    it('normal tail approximation is accurate enough for the bar it sets', () => {
        expect(normalSf(0)).toBeCloseTo(0.5, 4);
        expect(normalSf(1.96)).toBeCloseTo(0.025, 4);
        expect(normalSf(3)).toBeCloseTo(0.00135, 4);
    });

    it('rank selection raises the bar: twenty candidates need more evidence than two', () => {
        const two = sidakZ(0.00135, 2);
        const twenty = sidakZ(0.00135, 20);
        // A single pre-chosen look is the plain z = 3 test.
        expect(sidakZ(0.00135, 1)).toBeCloseTo(3, 2);
        expect(two).toBeGreaterThan(3);
        expect(twenty).toBeGreaterThan(two);
        expect(requiredZ('even_odd')).toBeCloseTo(two, 6);
        expect(requiredZ('matches_differs')).toBeCloseTo(twenty, 6);
        expect(CANDIDATES.matches_differs).toBe(20);
    });

    it('entropy scores a flat window at 1 and a single repeated digit at 0', () => {
        expect(normalizedEntropy(uniformWindow(1000))).toBeCloseTo(1, 4);
        expect(normalizedEntropy(new Array(1000).fill(7))).toBe(0);
        expect(normalizedEntropy([])).toBe(0);
    });

    it('ranks sides by evidence rather than by raw point gap', () => {
        // Over/Under have different baselines, so the bigger edge is not
        // automatically the stronger reading.
        // OVER sits on a 40% baseline and so has the tighter standard error:
        // 2.95 points there is stronger evidence than 3.00 points on UNDER's
        // 50% baseline, and ranking by raw edge would have got this backwards.
        const scored = scoreSides(
            [
                { baseline: 50, label: 'UNDER 5', pct: 53.0 },
                { baseline: 40, label: 'OVER 5', pct: 42.95 },
            ],
            1000
        );
        expect(scored[0].label).toBe('OVER 5');
        expect(scored[0].edge).toBeLessThan(scored[1].edge);
        expect(scored[0].z).toBeGreaterThan(scored[1].z);
    });
});

describe('signal-quality: the pathological cases', () => {
    // CASE A - a nearly uniform window is not a signal.
    it('CASE A: a near-uniform window stays NO SIGNAL', () => {
        const digits = uniformWindow(1000, { 7: 0.104 });
        const result = evaluateWindow({
            digits,
            has_feed: true,
            sides: matchesDiffersSides(digits),
            strategy: 'matches_differs',
        });
        expect(result.entropy).toBeGreaterThan(MIN_ENTROPY);
        expect(result.leader?.z).toBeLessThan(result.required_z);
        expect(result.qualifies).toBe(false);
    });

    // CASE B - the 88% case that motivated the guard.
    it('CASE B: one digit at 88% is rejected as near-degenerate despite overwhelming edge', () => {
        const digits = uniformWindow(1000, { 0: 0.88 });
        const result = evaluateWindow({
            digits,
            has_feed: true,
            sides: matchesDiffersSides(digits),
            strategy: 'matches_differs',
        });
        // The edge is enormous and the evidence bar is cleared many times over -
        // and it is still rejected, because the window is not a digit process.
        expect(result.leader?.z).toBeGreaterThan(result.required_z);
        expect(result.entropy).toBeLessThan(MIN_ENTROPY);
        expect(result.qualifies).toBe(false);
    });

    it('CASE B2: a fully degenerate window (one repeated digit) is rejected', () => {
        const digits = new Array(1000).fill(0);
        const result = evaluateWindow({
            digits,
            has_feed: true,
            sides: matchesDiffersSides(digits),
            strategy: 'matches_differs',
        });
        expect(result.entropy).toBe(0);
        expect(result.qualifies).toBe(false);
    });

    // CASE C - the same share is far weaker evidence on a short window.
    it('CASE C: a spike that qualifies at n=1000 does not qualify on a short window', () => {
        const shares = { 7: 0.134 };
        const long_window = uniformWindow(1000, shares);
        const short_window = uniformWindow(300, shares);

        const long_result = evaluateWindow({
            digits: long_window,
            has_feed: true,
            sides: matchesDiffersSides(long_window),
            strategy: 'matches_differs',
        });
        const short_result = evaluateWindow({
            digits: short_window,
            has_feed: true,
            sides: matchesDiffersSides(short_window),
            strategy: 'matches_differs',
        });

        // Near-identical edge in points (the integer counts round slightly
        // differently at each n), very different evidence.
        expect(Math.abs(short_result.leader!.edge - long_result.leader!.edge)).toBeLessThan(0.25);
        expect(short_result.leader!.z).toBeLessThan(long_result.leader!.z);
        // And below the sample floor it cannot qualify at all.
        expect(short_window.length).toBeLessThan(MIN_SAMPLE);
        expect(short_result.qualifies).toBe(false);
    });

    it('CASE C2: the sample floor is enforced even when the evidence is otherwise sufficient', () => {
        const digits = uniformWindow(400, { 7: 0.2 });
        const result = evaluateWindow({
            digits,
            has_feed: true,
            sides: matchesDiffersSides(digits),
            strategy: 'matches_differs',
        });
        expect(digits.length).toBeLessThan(MIN_SAMPLE);
        expect(result.qualifies).toBe(false);
    });

    // CASE D - a real deviation, with enough of a window behind it.
    it('CASE D: a moderate deviation on a full window does qualify', () => {
        const digits = uniformWindow(1000, { 7: 0.145 });
        const sides = matchesDiffersSides(digits);
        const result = evaluateWindow({ digits, has_feed: true, sides, strategy: 'matches_differs' });

        expect(result.leader?.label).toBe('MATCHES 7');
        expect(result.entropy).toBeGreaterThan(MIN_ENTROPY);
        expect(result.leader!.z).toBeGreaterThanOrEqual(result.required_z);
        expect(result.separation_z).toBeGreaterThanOrEqual(1);
        expect(result.qualifies).toBe(true);
    });

    it('a dead feed cannot qualify however good the window looks', () => {
        const digits = uniformWindow(1000, { 7: 0.145 });
        const result = evaluateWindow({
            digits,
            has_feed: false,
            sides: matchesDiffersSides(digits),
            strategy: 'matches_differs',
        });
        expect(result.qualifies).toBe(false);
    });

    it('an even/odd window needs the lower bar but still needs real evidence', () => {
        // 51.6% even at n=1000 is about 1.0 standard errors - the case the audit
        // used as its NO SIGNAL example.
        const weak = uniformWindow(1000, { 0: 0.116, 1: 0.084 });
        const weak_result = evaluateWindow({
            digits: weak,
            has_feed: true,
            sides: evenOddSides(weak),
            strategy: 'even_odd',
        });
        expect(weak_result.leader!.z).toBeLessThan(weak_result.required_z);
        expect(weak_result.qualifies).toBe(false);

        // Even/Odd is judged against two candidates rather than twenty, so its
        // bar is lower - but it is still a bar.
        expect(requiredZ('even_odd')).toBeLessThan(requiredZ('matches_differs'));
    });
});
