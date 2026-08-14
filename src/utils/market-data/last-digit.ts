/**
 * Last-digit maths shared by every digit-analysis surface (Bulk Trader,
 * Dcircles). One copy, because the pip_size trap below is subtle enough that
 * a second implementation would eventually get it wrong.
 *
 * `pip_size` means two different things on this API and nothing marks the
 * difference: a `tick` reports it as a count of decimal places (R_100 -> 2),
 * while an `active_symbols` entry reports it as the pip's value (R_100 ->
 * 0.01). Feeding the second straight into toFixed() rounds the argument to 0,
 * which formats every quote as a bare integer and makes the "last digit" the
 * units digit - collapsing the whole distribution onto one or two digits.
 */
export const toDecimalPlaces = (pip_size: number | undefined | null): number | undefined => {
    if (pip_size === undefined || pip_size === null || Number.isNaN(pip_size)) return undefined;
    if (pip_size >= 1) return Math.round(pip_size);
    if (pip_size <= 0) return undefined;
    return Math.round(-Math.log10(pip_size));
};

/**
 * Deriv's own definition of "last digit": the final character of the quote
 * once formatted to the symbol's real precision, not a rounded float - e.g.
 * 640.72 at 2 decimals has last digit 2, not floor(0.72*100)%10, which can
 * disagree after floating point error.
 */
export const getLastDigit = (quote: number, decimals: number): number => {
    const fixed = quote.toFixed(decimals);
    return Number(fixed[fixed.length - 1]);
};

/** Percentage share of each digit 0-9 across the given sample. */
export const getDigitDistribution = (digits: number[]): number[] => {
    const counts = new Array(10).fill(0);
    digits.forEach(digit => {
        if (digit >= 0 && digit <= 9) counts[digit] += 1;
    });
    const total = digits.length || 1;
    return counts.map(count => (count / total) * 100);
};
