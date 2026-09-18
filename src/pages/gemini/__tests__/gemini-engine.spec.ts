import { chooseMarket, rankMarkets, readWindow, SWITCH_MARGIN_Z, TGeminiCandidate } from '../gemini-engine';

/**
 * Gemini buys on what these functions decide, so each case below pins a
 * decision rather than a number: which barrier is picked, when a reading is
 * good enough to act on, and when it is worth moving markets.
 */

/** A window with an exact digit composition, so every case here is deterministic. */
const digitsFrom = (shares: Partial<Record<number, number>>, n: number): number[] => {
    const digits: number[] = [];
    Object.entries(shares).forEach(([digit, share]) => {
        for (let i = 0; i < Math.round((share as number) * n); i++) digits.push(Number(digit));
    });
    // Topped up with a digit that is already represented, so a rounding
    // shortfall cannot quietly change the distribution being tested.
    while (digits.length < n) digits.push(digits[digits.length - 1] ?? 0);
    return digits.slice(0, n);
};

/** Ten digits in equal measure - the distribution every reading is judged against. */
const uniform = (n: number) =>
    digitsFrom({ 0: 0.1, 1: 0.1, 2: 0.1, 3: 0.1, 4: 0.1, 5: 0.1, 6: 0.1, 7: 0.1, 8: 0.1, 9: 0.1 }, n);

/**
 * A window where the evens take `share` between them and the odds the rest,
 * every digit still appearing.
 *
 * Spread across all ten deliberately. A window made of three or four digits
 * would be strongly "even" and still be rejected - correctly - by the entropy
 * guard, which exists to throw out feeds that are not behaving like a
 * ten-outcome digit process at all. Testing the evidence rule needs a window
 * that gets past that guard, which is to say a realistic one.
 */
const evenSkew = (share: number, n: number) => {
    const even = share / 5;
    const odd = (1 - share) / 5;
    return digitsFrom({ 0: even, 1: odd, 2: even, 3: odd, 4: even, 5: odd, 6: even, 7: odd, 8: even, 9: odd }, n);
};

const windowOf = (digits: number[]) => ({ digits, prices: [] });

describe('readWindow', () => {
    it('does not qualify a uniform window, whatever the family', () => {
        const window = windowOf(uniform(1000));
        (['digits_over', 'digits_under', 'digits_even', 'digits_odd'] as const).forEach(family => {
            expect(readWindow(family, window)?.qualifies).toBe(false);
        });
    });

    it('does not qualify a window shorter than the minimum sample', () => {
        // The composition is the same one that qualifies below; only the sample
        // is too small.
        const reading = readWindow('digits_even', windowOf(evenSkew(0.6, 100)));
        expect(reading?.n).toBe(100);
        expect(reading?.pct).toBeCloseTo(60, 5);
        expect(reading?.qualifies).toBe(false);
    });

    it('rejects a window that is not behaving like a ten-digit process', () => {
        // Strongly even, and built from four digits. The evidence is
        // overwhelming and the reading is still refused, because a feed like
        // this is a quoting fault rather than a signal.
        const reading = readWindow('digits_even', windowOf(digitsFrom({ 0: 0.3, 2: 0.3, 4: 0.1, 1: 0.3 }, 1000)));
        expect(reading?.pct).toBeCloseTo(70, 5);
        expect(reading?.z).toBeGreaterThan(10);
        expect(reading?.qualifies).toBe(false);
    });

    it('reads an even-skewed window as EVEN, and qualifies it', () => {
        const reading = readWindow('digits_even', windowOf(evenSkew(0.6, 1000)));
        expect(reading?.entry).toBe('EVEN');
        expect(reading?.contract_type).toBe('DIGITEVEN');
        expect(reading?.pct).toBeCloseTo(60, 5);
        expect(reading?.qualifies).toBe(true);
    });

    it('reads the same window as ODD without qualifying it', () => {
        // The mirror of the case above: the rate is real but on the wrong side
        // of uniform, so there is no evidence for ODD and Gemini must not act.
        const reading = readWindow('digits_odd', windowOf(evenSkew(0.6, 1000)));
        expect(reading?.pct).toBeCloseTo(40, 5);
        expect(reading?.z).toBeLessThan(0);
        expect(reading?.qualifies).toBe(false);
    });

    /**
     * The barrier is the part that is easy to get wrong. Picking the highest
     * observed rate would always return OVER 0, because ~90% of digits clear it
     * on any window at all. What decides it is distance from where a uniform
     * market would sit.
     */
    it('picks the Over barrier by evidence, not by the highest rate', () => {
        // Digits 7, 8 and 9 carry 45% between them against an expected 30%, so
        // the surplus sits above 6 - and OVER 0 still has the larger raw rate.
        const window = windowOf(
            digitsFrom(
                { 0: 0.08, 1: 0.07, 2: 0.07, 3: 0.08, 4: 0.07, 5: 0.09, 6: 0.09, 7: 0.15, 8: 0.15, 9: 0.15 },
                1000
            )
        );
        const reading = readWindow('digits_over', window);
        expect(reading?.entry).toBe('OVER 6');
        expect(reading?.barrier).toBe(6);
        expect(reading?.contract_type).toBe('DIGITOVER');

        // The rate OVER 0 would have reported, for the comparison the choice is
        // actually making: bigger, and chosen against.
        const over_0_rate = 100 - 8;
        expect(over_0_rate).toBeGreaterThan(reading?.pct ?? 0);
    });

    it('mirrors that for Under', () => {
        const window = windowOf(
            digitsFrom(
                { 0: 0.15, 1: 0.15, 2: 0.15, 3: 0.09, 4: 0.09, 5: 0.07, 6: 0.08, 7: 0.07, 8: 0.07, 9: 0.08 },
                1000
            )
        );
        const reading = readWindow('digits_under', window);
        expect(reading?.entry).toBe('UNDER 3');
        expect(reading?.contract_type).toBe('DIGITUNDER');
    });

    it('returns nothing for a market with no ticks yet', () => {
        expect(readWindow('digits_over', windowOf([]))).toBeNull();
        expect(readWindow('rise', { digits: [], prices: [10] })).toBeNull();
    });
});

describe('readWindow for Rise and Fall', () => {
    /** Builds quotes from a run of moves: 1 up, -1 down, 0 unchanged. */
    const pricesFrom = (moves: number[]) => {
        const prices = [100];
        moves.forEach(move => prices.push(prices[prices.length - 1] + move));
        return prices;
    };

    it('counts direction rather than digits', () => {
        const reading = readWindow('rise', { digits: [], prices: pricesFrom([1, 1, 1, -1]) });
        expect(reading?.contract_type).toBe('CALL');
        expect(reading?.entry).toBe('RISE');
        expect(reading?.n).toBe(4);
        expect(reading?.pct).toBeCloseTo(75, 5);
    });

    it('drops unchanged ticks instead of counting them as either side', () => {
        // Three moves, two of them up. The four flat ticks must not dilute that
        // to 2/7 - a repeated quote is not a fall.
        const reading = readWindow('rise', { digits: [], prices: pricesFrom([1, 0, 0, 1, 0, 0, -1]) });
        expect(reading?.n).toBe(3);
        expect(reading?.pct).toBeCloseTo((2 / 3) * 100, 5);
    });

    it('reads PUT for Fall', () => {
        const reading = readWindow('fall', { digits: [], prices: pricesFrom([-1, -1, 1]) });
        expect(reading?.contract_type).toBe('PUT');
        expect(reading?.entry).toBe('FALL');
        expect(reading?.pct).toBeCloseTo((2 / 3) * 100, 5);
    });
});

describe('rankMarkets', () => {
    it('puts the market furthest from uniform first', () => {
        const ranked = rankMarkets('digits_even', [
            { name: 'Flat', symbol: 'FLAT', window: windowOf(uniform(1000)) },
            { name: 'Skewed', symbol: 'SKEW', window: windowOf(evenSkew(0.62, 1000)) },
            { name: 'Slight', symbol: 'SLIGHT', window: windowOf(evenSkew(0.54, 1000)) },
        ]);
        expect(ranked.map(item => item.symbol)).toEqual(['SKEW', 'SLIGHT', 'FLAT']);
    });

    it('leaves out a market with nothing to read', () => {
        const ranked = rankMarkets('digits_even', [
            { name: 'Empty', symbol: 'EMPTY', window: windowOf([]) },
            { name: 'Real', symbol: 'REAL', window: windowOf(uniform(1000)) },
        ]);
        expect(ranked.map(item => item.symbol)).toEqual(['REAL']);
    });
});

describe('chooseMarket', () => {
    const candidate = (symbol: string, z: number, qualifies: boolean): TGeminiCandidate => ({
        name: symbol,
        reading: {
            contract_type: 'DIGITEVEN',
            edge: z,
            entry: 'EVEN',
            entropy: 1,
            n: 1000,
            pct: 50 + z,
            qualifies,
            z,
        },
        symbol,
    });

    it('stays out of the market entirely when nothing qualifies', () => {
        expect(chooseMarket([candidate('A', 2, false), candidate('B', 1, false)], null)).toBeNull();
    });

    it('takes the leading qualifying market when it is not already on one', () => {
        expect(chooseMarket([candidate('A', 5, true), candidate('B', 4, true)], null)?.symbol).toBe('A');
    });

    it('skips a market that leads on evidence but has not qualified', () => {
        expect(chooseMarket([candidate('A', 9, false), candidate('B', 4, true)], null)?.symbol).toBe('B');
    });

    it('holds the market it is on when the challenger is ahead by less than the margin', () => {
        const held = candidate('HELD', 5, true);
        const challenger = candidate('NEW', 5 + SWITCH_MARGIN_Z / 2, true);
        expect(chooseMarket([challenger, held], 'HELD')?.symbol).toBe('HELD');
    });

    it('moves once the challenger is clear of it by the margin', () => {
        const held = candidate('HELD', 5, true);
        const challenger = candidate('NEW', 5 + SWITCH_MARGIN_Z * 2, true);
        expect(chooseMarket([challenger, held], 'HELD')?.symbol).toBe('NEW');
    });

    it('moves when the market it is on stops qualifying, however small the gap', () => {
        const held = candidate('HELD', 5, false);
        const challenger = candidate('NEW', 5.01, true);
        expect(chooseMarket([challenger, held], 'HELD')?.symbol).toBe('NEW');
    });
});
