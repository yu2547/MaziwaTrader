/**
 * The 0-9 strip Deriv shows under the chart and inside the ticket for the
 * digit contracts.
 *
 * The percentages are counted over the tick window this page already holds -
 * they describe the ticks that have been, and say nothing about the next one.
 */

type TDigitCirclesProps = {
    /** How often each digit came up, as a percentage of the window. */
    distribution: number[];
    /** The digit the latest tick ended on, marked the way Deriv marks it. */
    latest: number | null;
    onSelect?: (digit: number) => void;
    selected?: number;
};

const DigitCircles = ({ distribution, latest, onSelect, selected }: TDigitCirclesProps) => (
    <div className={`mw-dt__digits${onSelect ? ' mw-dt__digits--pick' : ''}`}>
        {distribution.map((pct, digit) => {
            const classes = [
                'mw-dt__digit',
                digit === selected ? 'mw-dt__digit--on' : '',
                digit === latest ? 'mw-dt__digit--latest' : '',
            ]
                .filter(Boolean)
                .join(' ');

            if (!onSelect) {
                return (
                    <span key={digit} className={classes}>
                        <b>{digit}</b>
                        <i>{pct.toFixed(1)}%</i>
                    </span>
                );
            }
            return (
                <button
                    key={digit}
                    type='button'
                    className={classes}
                    aria-pressed={digit === selected}
                    onClick={() => onSelect(digit)}
                >
                    <b>{digit}</b>
                    <i>{pct.toFixed(1)}%</i>
                </button>
            );
        })}
    </div>
);

export default DigitCircles;
