import { localize } from '@deriv-com/translations';

/**
 * The options inside a market dropdown, split into headed groups.
 *
 * Four of these tools - D-Circles, DP Tools, Signals and the Tick Analyser -
 * each rendered the same flat list of every volatility index, which runs to
 * thirteen entries with the 1s and non-1s variants interleaved by whatever
 * order active_symbols happened to return. The reference separates them under
 * headings, so finding "Volatility 75 (1s)" is a matter of looking in the 1s
 * group rather than reading the whole list.
 *
 * Shared rather than repeated four times, which is what the flat version had
 * become - the same six lines of option markup in four files.
 */

export type TMarketSymbol = {
    underlying_symbol: string;
    underlying_symbol_name: string;
};

type TMarketOptionsProps = {
    symbols: TMarketSymbol[];
};

const MarketOptions = ({ symbols }: TMarketOptionsProps) => {
    const pick = (test: RegExp) => symbols.filter(item => test.test(item.underlying_symbol));

    // Jump is listed because the reference lists it, and costs nothing when
    // the caller's symbol list holds none - the group drops out below. Note
    // that simply widening those callers' filters to let Jump through would
    // not only fill this group: in Signals and the Tick Analyser the same list
    // feeds a scanner that sweeps every market in it, so that is a decision
    // about what gets scanned, not just about what this dropdown shows.
    const groups = [
        { items: pick(/^1HZ\d+V$/), label: localize('Volatility (1s)') },
        { items: pick(/^R_\d+$/), label: localize('Volatility') },
        { items: pick(/^JD\d+$/), label: localize('Jump') },
    ].filter(group => group.items.length > 0);

    // Anything the groups do not describe is still listed, loose, after them.
    // A market that cannot be selected because nobody wrote a pattern for it
    // is a worse failure than one sitting outside a heading.
    const grouped_symbols = new Set(groups.flatMap(group => group.items.map(item => item.underlying_symbol)));
    const ungrouped = symbols.filter(item => !grouped_symbols.has(item.underlying_symbol));

    const toOption = (item: TMarketSymbol) => (
        <option key={item.underlying_symbol} value={item.underlying_symbol}>
            {item.underlying_symbol_name}
        </option>
    );

    return (
        <>
            {groups.map(group => (
                <optgroup key={group.label} label={group.label}>
                    {group.items.map(toOption)}
                </optgroup>
            ))}
            {ungrouped.map(toOption)}
        </>
    );
};

export default MarketOptions;
